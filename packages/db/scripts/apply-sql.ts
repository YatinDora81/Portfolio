import { config } from "dotenv";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Client } from "pg";

config({ path: new URL("../.env", import.meta.url).pathname });

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

const toVar = args.get("to");
if (!toVar) {
  console.error("pass --to=<ENV_VAR> naming the target, e.g. --to=DATABASE_URL");
  console.error("there is no default: this script applies DDL to whatever it is pointed at");
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

const database = new URL(url.replace(/^postgres(ql)?:\/\//, "https://")).pathname.replace(/^\//, "");
const isProtected = protectedEndpoints.includes(targetEndpoint);
const confirmed = args.get("i-am-sure") === targetEndpoint;

if (isProtected && !confirmed) {
  console.error(
    `refusing: ${toVar} resolves to endpoint ${targetEndpoint}, which PROD_DATABASE_URL protects`,
  );
  console.error(`to run against it deliberately, pass --i-am-sure=<endpoint-id>`);
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const bare = sql.replace(/--[^\n]*\n/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
const ownsTransaction = /^begin\b/i.test(bare);

function split(input: string) {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let quote: string | null = null;
  while (i < input.length) {
    const rest = input.slice(i);
    if (!quote) {
      if (rest.startsWith("--")) {
        const end = input.indexOf("\n", i);
        const stop = end === -1 ? input.length : end + 1;
        buf += input.slice(i, stop);
        i = stop;
        continue;
      }
      if (rest.startsWith("/*")) {
        const end = input.indexOf("*/", i);
        const stop = end === -1 ? input.length : end + 2;
        buf += input.slice(i, stop);
        i = stop;
        continue;
      }
      const dollar = rest.match(/^\$[A-Za-z_]*\$/);
      if (dollar) {
        quote = dollar[0];
        buf += quote;
        i += quote.length;
        continue;
      }
      if (input[i] === "'") {
        quote = "'";
        buf += "'";
        i += 1;
        continue;
      }
      if (input[i] === ";") {
        if (buf.trim()) out.push(buf.trim());
        buf = "";
        i += 1;
        continue;
      }
    } else if (quote === "'") {
      if (input[i] === "'") quote = null;
    } else if (rest.startsWith(quote)) {
      buf += quote;
      i += quote.length;
      quote = null;
      continue;
    }
    buf += input[i];
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const NON_TRANSACTIONAL = /^\s*(?:create\s+(?:unique\s+)?index\s+concurrently|drop\s+index\s+concurrently|reindex\s+\w*\s*concurrently|vacuum|alter\s+system)\b/i;
const pieces = split(sql).filter((s) => !/^\s*(?:--|\/\*)/.test(s) || s.replace(/--[^\n]*\n?/g, "").trim());
const nonTx = pieces.filter((s) => NON_TRANSACTIONAL.test(s.replace(/--[^\n]*\n/g, "")));
const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const statements = pieces.length;
  console.log(`${isProtected ? "PRODUCTION " : ""}target ${target}/${database}`);
  console.log(`tables now ${rows[0]!.n}`);
  console.log(`file ${file}`);
  if (nonTx.length) {
    console.log(`${statements} statements, ${nonTx.length} of them cannot run in a transaction:`);
    for (const s of nonTx) console.log(`  ${s.replace(/--[^\n]*\n/g, " ").replace(/\s+/g, " ").slice(0, 90)}`);
    console.log("those run bare; everything around them stays batched and atomic");
  } else {
    console.log(`${statements} statements, transaction ${ownsTransaction ? "in the file" : "added by this runner"}`);
  }

  if (!apply) {
    console.log("\ndry run, nothing executed. re-run with --apply=true");
    return;
  }

  const started = new Date().toISOString();
  if (args.get("per-statement") === "true") {
    await client.query("begin");
    for (let n = 0; n < pieces.length; n += 1) {
      try {
        await client.query(pieces[n]!);
      } catch (err) {
        console.error(`\nstatement ${n + 1}/${pieces.length} failed:`);
        console.error(pieces[n]!.slice(0, 600));
        throw err;
      }
    }
    await client.query("commit");
    console.log(`\napplied ${pieces.length} statements one at a time`);
    return;
  }
  if (!nonTx.length) {
    if (!ownsTransaction) await client.query("begin");
    await client.query(sql);
    if (!ownsTransaction) await client.query("commit");
  } else {
    let batch: string[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await client.query(`begin; ${batch.join(";\n")}; commit;`);
      batch = [];
    };
    for (const stmt of pieces) {
      if (NON_TRANSACTIONAL.test(stmt.replace(/--[^\n]*\n/g, ""))) {
        await flush();
        await client.query(stmt);
      } else {
        batch.push(stmt);
      }
    }
    await flush();
  }

  const { rows: after } = await client.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  console.log(`\napplied. tables now ${after[0]!.n}`);

  const dir = `${import.meta.dir}/../v2-production/applied`;
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    `${dir}/${started.slice(0, 10)}.log`,
    `${started} ${target}/${database} ${basename(file as string)} ${statements} statements tables ${rows[0]!.n}->${after[0]!.n}\n`,
  );
}

main()
  .catch(async (err) => {
    await client.query("rollback").catch(() => undefined);
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
