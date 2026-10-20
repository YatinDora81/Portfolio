import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { Client } from "pg";

config({ path: new URL("../.env", import.meta.url).pathname });

type Dump = {
  generatedAt: string;
  source: { host: string; database: string };
  tables: { name: string; columns: { name: string; udt: string }[]; rows: Record<string, unknown>[] }[];
};

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [k, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(k!, rest.join("=") || "true");
}

const file = args.get("file");
if (!file) {
  console.error("pass --file=backups/<dump>.json");
  process.exit(1);
}

const toVar = args.get("to");
if (!toVar) {
  console.error("pass --to=<ENV_VAR> naming the target, e.g. --to=SCRATCH_DATABASE_URL");
  console.error("there is no default: this script truncates every table it restores");
  process.exit(1);
}

const url = process.env[toVar];
if (!url) {
  console.error(`${toVar} is not set`);
  process.exit(1);
}

const hostOf = (u: string) => new URL(u.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
const endpointOf = (u: string) => hostOf(u).split(".")[0]!.replace(/-pooler$/, "");
const target = hostOf(url);
const targetEndpoint = endpointOf(url);
const apply = args.get("apply") === "true";
const protectedEndpoints = [process.env.PROD_DATABASE_URL, process.env.PROTECTED_DATABASE_URL]
  .filter(Boolean)
  .map((u) => endpointOf(u as string));

if (!protectedEndpoints.length) {
  console.error(
    "refusing: neither PROD_DATABASE_URL nor PROTECTED_DATABASE_URL is loaded, so the target cannot be proven not to be production",
  );
  process.exit(1);
}

if (protectedEndpoints.includes(targetEndpoint)) {
  console.error(
    `refusing: ${toVar} resolves to endpoint ${targetEndpoint}, which PROD_DATABASE_URL protects`,
  );
  process.exit(1);
}

const dump = JSON.parse(readFileSync(file, "utf8")) as Dump;
const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  console.log(`source ${dump.source.host}/${dump.source.database} @ ${dump.generatedAt}`);
  console.log(`target ${target}\n`);

  const { rows: present } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const live = new Set(present.map((r) => r.table_name));

  const { rows: liveColumns } = await client.query<{
    table_name: string;
    column_name: string;
    udt_name: string;
  }>(
    `select table_name, column_name, udt_name from information_schema.columns
     where table_schema = 'public'`,
  );
  const liveColsByTable = new Map<string, Map<string, string>>();
  for (const c of liveColumns) {
    const m = liveColsByTable.get(c.table_name) ?? new Map<string, string>();
    m.set(c.column_name, c.udt_name);
    liveColsByTable.set(c.table_name, m);
  }

  const { rows: fks } = await client.query<{ child: string; parent: string }>(
    `select c.relname as child, p.relname as parent
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     join pg_class p on p.oid = k.confrelid
     where k.contype = 'f' and c.relnamespace = 'public'::regnamespace`,
  );

  const restorable = dump.tables.filter((t) => live.has(t.name));
  const skipped = dump.tables.filter((t) => !live.has(t.name)).map((t) => t.name);
  const names = new Set(restorable.map((t) => t.name));

  const deps = new Map<string, Set<string>>();
  for (const t of restorable) deps.set(t.name, new Set());
  for (const { child, parent } of fks) {
    if (child === parent) continue;
    if (names.has(child) && names.has(parent)) deps.get(child)!.add(parent);
  }

  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < restorable.length) {
    const next = restorable
      .map((t) => t.name)
      .filter((n) => !done.has(n) && [...deps.get(n)!].every((d) => done.has(d)));
    if (next.length === 0) {
      const left = restorable.map((t) => t.name).filter((n) => !done.has(n));
      console.error(`cycle between: ${left.join(", ")}`);
      process.exit(1);
    }
    for (const n of next) {
      order.push(n);
      done.add(n);
    }
  }

  const selfRef = new Set(fks.filter((f) => f.child === f.parent).map((f) => f.child));
  const selfRefCols = new Map<string, string>();
  if (selfRef.size) {
    const { rows } = await client.query<{ child: string; col: string }>(
      `select c.relname as child, a.attname as col
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join unnest(k.conkey) as ck(attnum) on true
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = ck.attnum
       where k.contype = 'f' and k.conrelid = k.confrelid
         and c.relnamespace = 'public'::regnamespace`,
    );
    for (const r of rows) selfRefCols.set(r.child, r.col);
  }

  if (!apply) {
    console.log("dry run, nothing written. insert order:");
    for (const name of order) {
      if (name === "_prisma_migrations") continue;
      const t = restorable.find((x) => x.name === name)!;
      const liveCols = liveColsByTable.get(name)!;
      const dropped = t.columns.map((c) => c.name).filter((c) => !liveCols.has(c));
      const added = [...liveCols.keys()].filter((c) => !t.columns.some((x) => x.name === c));
      const notes = [
        dropped.length ? `ignores ${dropped.join(", ")}` : "",
        added.length ? `leaves ${added.join(", ")} at default` : "",
      ].filter(Boolean);
      console.log(`  ${name.padEnd(24)} ${String(t.rows.length).padStart(5)}${notes.length ? `  (${notes.join("; ")})` : ""}`);
    }
    if (skipped.length) console.log(`\nin dump but not in target: ${skipped.join(", ")}`);
    console.log(`\nwould TRUNCATE ${order.length - 1} tables on ${target} then insert the above.`);
    console.log("re-run with --apply=true to do it.");
    return;
  }

  await client.query("begin");

  const truncatable = order.filter((n) => n !== "_prisma_migrations");
  if (truncatable.length) {
    await client.query(`truncate ${truncatable.map((n) => `"${n}"`).join(", ")} cascade`);
  }

  let written = 0;
  for (const name of order) {
    if (name === "_prisma_migrations") continue;
    const table = restorable.find((t) => t.name === name)!;
    if (table.rows.length === 0) continue;

    const liveCols = liveColsByTable.get(name)!;
    const cols = table.columns.map((c) => c.name).filter((c) => liveCols.has(c));
    const dropped = table.columns.map((c) => c.name).filter((c) => !liveCols.has(c));
    if (dropped.length) console.log(`${name}: ignoring ${dropped.join(", ")}`);

    const encode = (row: Record<string, unknown>) =>
      cols.map((c) => {
        const v = row[c];
        if (v === undefined) return null;
        const udt = liveCols.get(c)!;
        if (v !== null && (udt === "json" || udt === "jsonb")) return JSON.stringify(v);
        return v;
      });

    const insert = async (batch: Record<string, unknown>[]) => {
      const values: unknown[] = [];
      const tuples = batch.map((row) => {
        const encoded = encode(row);
        const slots = encoded.map((v) => {
          values.push(v);
          return `$${values.length}`;
        });
        return `(${slots.join(", ")})`;
      });
      const sql = `insert into "${name}" (${cols.map((c) => `"${c}"`).join(", ")}) values ${tuples.join(", ")}`;
      await client.query(sql, values);
    };

    const chunk = <T>(list: T[], size: number) => {
      const out: T[][] = [];
      for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
      return out;
    };
    const perRow = Math.max(1, cols.length);
    const size = Math.max(1, Math.floor(30000 / perRow));

    const selfCol = selfRefCols.get(name);
    if (!selfCol) {
      for (const batch of chunk(table.rows, size)) await insert(batch);
    } else {
      const pkCol = cols.includes("id") ? "id" : cols[0]!;
      const placed = new Set<unknown>();
      let pending = [...table.rows];
      while (pending.length) {
        const ready = pending.filter((r) => {
          const parent = r[selfCol];
          return parent === null || parent === undefined || placed.has(parent);
        });
        if (ready.length === 0) {
          console.error(`${name}: ${pending.length} rows unreachable via ${selfCol}`);
          process.exit(1);
        }
        for (const batch of chunk(ready, size)) await insert(batch);
        for (const r of ready) placed.add(r[pkCol]);
        const readySet = new Set(ready);
        pending = pending.filter((r) => !readySet.has(r));
      }
    }

    written += table.rows.length;
    console.log(`${name.padEnd(24)} ${table.rows.length}`);
  }

  for (const name of order) {
    const { rows } = await client.query<{ col: string; seq: string }>(
      `select a.attname as col, pg_get_serial_sequence($1, a.attname) as seq
       from pg_attribute a
       where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
         and pg_get_serial_sequence($1, a.attname) is not null`,
      [`"${name}"`],
    );
    for (const { col, seq } of rows) {
      await client.query(
        `select setval($1, coalesce((select max("${col}") from "${name}"), 0) + 1, false)`,
        [seq],
      );
    }
  }

  await client.query("commit");

  console.log(`\n${written} rows into ${order.length - 1} tables on ${target}`);
  if (skipped.length) console.log(`tables in dump but not in target: ${skipped.join(", ")}`);
}

main()
  .catch(async (err) => {
    await client.query("rollback").catch(() => undefined);
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
