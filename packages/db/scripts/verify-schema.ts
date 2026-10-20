import "dotenv/config";
import { spawnSync } from "node:child_process";

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

const host = new URL(url.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
console.log(`comparing ${host} against prisma/schema.prisma\n`);

const res = spawnSync(
  "bunx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--script",
    "--exit-code",
  ],
  { encoding: "utf8", env: { ...process.env, DATABASE_URL: url } },
);

const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/postgresql:\/\/[^\s"]+/g, "<url>");

const OPCLASS_INDEXES = ["MediaAsset_key_prefix_idx", "NoteNode_path_prefix_idx"];
const statements = out
  .split(/\n\s*\n/)
  .map((s) => s.trim())
  .filter((s) => /^(--|[A-Z])/.test(s) && !s.startsWith("Loaded Prisma config"));

const expected = statements.filter((s) => OPCLASS_INDEXES.some((i) => s.includes(i)));
const real = statements.filter((s) => !OPCLASS_INDEXES.some((i) => s.includes(i)));

if (real.length) {
  console.log("DRIFT:\n");
  for (const s of real) console.log(s, "\n");
} else {
  console.log("no drift");
}

if (expected.length) {
  console.log(
    `\nignored: ${OPCLASS_INDEXES.join(" and ")} always report as pending. prisma db pull cannot see a`,
  );
  console.log("btree operator class, so it reads them without text_pattern_ops and diffs them forever.");
  console.log("the database does carry the opclass; check with pg_indexes, not with migrate diff.");
}

process.exitCode = real.length ? 1 : 0;
