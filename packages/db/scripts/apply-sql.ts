import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [k, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(k!, rest.join("=") || "true");
}

const file = args.get("file");
if (!file) {
  console.error("pass --file=<path.sql>");
  process.exit(1);
}

const toVar = args.get("to") ?? "NEW_DATABASE_URL";
const url = process.env[toVar];
if (!url) {
  console.error(`${toVar} is not set`);
  process.exit(1);
}

const hostOf = (u: string) => new URL(u.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
const target = hostOf(url);
const apply = args.get("apply") === "true";
const protectedHosts = [process.env.PROD_DATABASE_URL, process.env.PROTECTED_DATABASE_URL]
  .filter(Boolean)
  .map((u) => hostOf(u as string));

if (protectedHosts.includes(target)) {
  console.error(`refusing: ${toVar} resolves to ${target}, which PROD_DATABASE_URL protects`);
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  console.log(`target ${target}`);
  console.log(`tables now ${rows[0]!.n}`);
  console.log(`file ${file} (${sql.length} chars)`);

  if (!apply) {
    console.log("\ndry run, nothing executed. re-run with --apply=true");
    return;
  }

  await client.query("begin");
  await client.query(sql);
  await client.query("commit");

  const { rows: after } = await client.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  console.log(`\napplied. tables now ${after[0]!.n}`);
}

main()
  .catch(async (err) => {
    await client.query("rollback").catch(() => undefined);
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
