import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "pg";

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [k, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(k!, rest.join("=") || "true");
}

const fromVar = args.get("from") ?? "DATABASE_URL";
const url = process.env[fromVar];
if (!url) {
  console.error(`${fromVar} is not set`);
  process.exit(1);
}

const { hostname, pathname } = new URL(url.replace(/^postgres(ql)?:\/\//, "https://"));
const database = pathname.replace(/^\//, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = args.get("out") ?? `backups/${database}-${hostname.split(".")[0]}-${stamp}.json`;

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  await client.query("begin transaction read only isolation level repeatable read");

  const { rows: tableRows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );

  const { rows: columnRows } = await client.query<{
    table_name: string;
    column_name: string;
    udt_name: string;
  }>(
    `select table_name, column_name, udt_name from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position`,
  );

  const columnsByTable = new Map<string, { name: string; udt: string }[]>();
  for (const c of columnRows) {
    const list = columnsByTable.get(c.table_name) ?? [];
    list.push({ name: c.column_name, udt: c.udt_name });
    columnsByTable.set(c.table_name, list);
  }

  const tables: { name: string; columns: { name: string; udt: string }[]; rows: unknown[] }[] = [];
  let total = 0;

  for (const { table_name } of tableRows) {
    const { rows } = await client.query<{ r: unknown }>(
      `select row_to_json(t) as r from "${table_name}" t`,
    );
    const data = rows.map((r) => r.r);
    tables.push({ name: table_name, columns: columnsByTable.get(table_name) ?? [], rows: data });
    total += data.length;
    console.log(`${table_name.padEnd(24)} ${data.length}`);
  }

  await client.query("commit");

  const payload = {
    generatedAt: new Date().toISOString(),
    source: { host: hostname, database },
    tableCount: tables.length,
    rowCount: total,
    tables,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`\n${tables.length} tables, ${total} rows -> ${out}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
