# ============================================================================
# recover-from-dump.jq  ·  the executable path from a JSON dump back into a
# database, ONE TABLE at a time.
#
# WHY THIS EXISTS. Three steps in RUNBOOK.md name the read-only JSON dump as the
# only undo: Step 40 (FeatureFlag.label/.description for an off-registry key),
# Step 43 (HeroSkillBadge.iconKey) and Step 47 (Blog.show per-row values); Step
# 49/56a adds legacy_v1."SiteConfig". `bun run db:restore` cannot serve any of
# them: scripts/restore.ts:37-40 refuses a target that resolves to
# PROD_DATABASE_URL, and it has no per-table mode — scripts/restore.ts:144-147
# TRUNCATEs every dumped table present in the target and :150-216 reloads all of
# them, which would destroy everything written since the dump. This generator is
# the narrow alternative: it reads the dump and emits a plain .sql file that
# touches exactly one table and exactly the columns you name. Nothing here
# connects to anything. Read the output before you apply it.
#
# USAGE
#   jq -r -f recover-from-dump.jq \
#      --arg table HeroSkillBadge \
#      --arg key   id \
#      --arg cols  'iconKey,name' \
#      --arg mode  update \
#      backups/PRE-CUTOVER-<stamp>.json  > /tmp/v2/prod/recover-badge-iconkey.sql
#
#   table   the dumped table name, case-sensitive.
#   key     the column that identifies a row. HeroSkillBadge/Blog/SiteConfig: id.
#           FeatureFlag: key (its primary key is "key", there is no id column).
#   cols    comma-separated columns to restore. In insert mode, omit or pass '*'
#           for every column the dump holds for that table.
#   mode    update  — one UPDATE per dumped row, SET cols WHERE key = <value>.
#                     Guards first that every dumped key still exists.
#           insert  — one INSERT per dumped row, ON CONFLICT (key) DO NOTHING.
#                     For a table that was dropped and recreated (Step 56a).
#
# IT REFUSES TO GENERATE, exit 1 with a one-line reason, when: the table is not
# in the dump; a named column is not in the dump; the key column is not in the
# dump; mode is neither word; the table has ZERO rows in the dump (you almost
# certainly picked the wrong dump, or the table is under its post-rename name —
# see Step 48's UtmTracker__retired_v2); or update mode was given nothing but the
# key column to set, which would emit `UPDATE t SET  WHERE ...` and fail 42601
# halfway through a recovery. Every refusal is at generation time, on your
# laptop, with nothing connected.
#
# QUOTING. Every literal is single-quoted with '' doubling and an explicit
# ::"udt" cast taken from the dump's own column metadata, so enums, timestamps
# and text[] all land as themselves rather than as whatever the target's implicit
# coercion would pick. Backslashes are emitted verbatim, which is correct while
# standard_conforming_strings is on — it is on by default on PG17/Neon and no
# file in this cutover turns it off. If you have any doubt, check with
#   SHOW standard_conforming_strings;   -- must be 'on'
# before applying.
#
# The update-mode guard is dollar-quoted as $recover$, not $$, so a key value
# containing a literal $$ cannot terminate the block early.
#
# SCALE. One statement per dumped row, and the whole file is applied as a single
# multi-statement batch, so the four tables the runbook needs this for are all
# small: SiteConfig 26 rows, FeatureFlag 9-ish, HeroSkillBadge a handful, Blog 10.
# Check the row count in the generated header before you apply it. At a few
# thousand rows (UtmTracker is 1461, AnalyticsSession is unbounded) the file is
# still correct but is no longer something you can read end to end, and "read it
# before you apply it" is the whole safety model here — so for a table that size,
# read the header, spot-check with `head`/`grep`, and say in the run log that you
# did not read every line.
#
# NOT HANDLED, deliberately: multi-dimensional arrays, bytea and composite types.
# None of the 43 tables has one; if a future dump does, this generator will emit
# a wrong literal rather than refuse, so re-read this note before reusing it.
# ============================================================================

def q: tostring | gsub("'"; "''");
def ident: "\"" + . + "\"";

def elem:
  if   . == null       then "NULL"
  elif type == "boolean" then (if . then "true" else "false" end)
  elif type == "number"  then tojson
  else "'" + q + "'"
  end;

def lit($udt):
  if . == null then "NULL"
  elif ($udt | startswith("_")) then
    (if type == "array" then
       (if length == 0 then "'{}'" else "ARRAY[" + ([.[] | elem] | join(", ")) + "]" end)
     else "'" + q + "'" end) + "::" + ($udt | ident)
  elif ($udt == "json" or $udt == "jsonb") then
    "'" + (tojson | gsub("'"; "''")) + "'::" + ($udt | ident)
  elif type == "boolean" then (if . then "true" else "false" end)
  elif type == "number"  then tojson + "::" + ($udt | ident)
  elif type == "object" or type == "array" then
    "'" + (tojson | gsub("'"; "''")) + "'::" + ($udt | ident)
  else "'" + q + "'::" + ($udt | ident)
  end;

def fail($msg): $msg | halt_error(1);

. as $dump
| ($dump.tables | map(select(.name == $table)) | first) as $t
| if $t == null then fail("recover-from-dump: no table named \"\($table)\" in this dump\n") else . end
| ($t.columns | map({ key: .name, value: .udt }) | from_entries) as $udt
| (if ($cols // "*") == "*" then ($t.columns | map(.name))
   else ($cols | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))) end) as $want
| ($want | map(select($udt[.] == null))) as $unknown
| if ($unknown | length) > 0
  then fail("recover-from-dump: \"\($table)\" has no column(s) \($unknown | join(", ")) in this dump\n")
  else . end
| if $udt[$key] == null
  then fail("recover-from-dump: \"\($table)\" has no key column \"\($key)\" in this dump\n")
  else . end
| if ($mode != "update" and $mode != "insert")
  then fail("recover-from-dump: --arg mode must be update or insert, got \"\($mode)\"\n")
  else . end
| ($want | map(select(. != $key))) as $set
| if ($mode == "update" and ($set | length) == 0)
  then fail("recover-from-dump: update mode with nothing to set — --arg cols names only the key column \"\($key)\". Name the columns you want restored, or use mode=insert.\n")
  else . end
| if ($t.rows | length) == 0
  then fail("recover-from-dump: \"\($table)\" has 0 rows in this dump, so there is nothing to restore. Check you picked the dump that predates the drop — after a rename the table may be under a different name (e.g. UtmTracker__retired_v2).\n")
  else . end
| ($t.rows | length) as $n
| ([$key] + $set) as $show
| [
    "-- ============================================================================",
    "-- GENERATED by recover-from-dump.jq. Do not hand-edit; regenerate instead.",
    "-- dump        \($dump.source.host)/\($dump.source.database) @ \($dump.generatedAt)",
    "-- table       \"\($table)\"   (\($n) row(s) in the dump)",
    "-- key         \"\($key)\"",
    "-- columns     \($want | join(", "))",
    "-- mode        \($mode)",
    "--",
    "-- READ THIS FILE BEFORE APPLYING IT. It is a plain .sql file and goes through",
    "-- the same production-apply path as every *-contract.sql in this directory",
    "-- (RUNBOOK.md Stage 1, PASS 2) — no new write path, no guard bypassed.",
    "-- ============================================================================",
    "",
    "BEGIN;",
    "SET LOCAL lock_timeout = '3s';",
    "SET LOCAL statement_timeout = '60s';",
    ""
  ]
  + (if $mode == "update" then
      [ "-- GUARD. Every key in the dump must still exist, so a deleted row is a loud",
        "--        abort rather than a silent `UPDATE 0`. If a row is genuinely meant to",
        "--        be gone, re-generate with a dump you have pruned, or use mode=insert.",
        "DO $recover$",
        "DECLARE \"missing\" text;",
        "BEGIN",
        "  SELECT string_agg(\"k\", ', ') INTO \"missing\"",
        "    FROM unnest(ARRAY[" + ([$t.rows[] | .[$key] | elem] | join(", ")) + "]::text[]) AS \"k\"",
        "   WHERE NOT EXISTS (SELECT 1 FROM \($table | ident) \"t\" WHERE \"t\".\($key | ident)::text = \"k\");",
        "  IF \"missing\" IS NOT NULL THEN",
        "    RAISE EXCEPTION 'recover aborted: \($table) row(s) [%] in the dump no longer exist. Decide what that means before restoring the rest.', \"missing\";",
        "  END IF;",
        "END $recover$;",
        "" ]
     else [] end)
  + [ ($t.rows
       | to_entries
       | map(
           .value as $r
           | if $mode == "update" then
               "UPDATE \($table | ident) SET "
               + ([ $set[] | . as $c | ($c | ident) + " = " + ($r[$c] | lit($udt[$c])) ] | join(", "))
               + " WHERE " + ($key | ident) + " = " + ($r[$key] | lit($udt[$key])) + ";"
             else
               "INSERT INTO \($table | ident) (" + ([$want[] | ident] | join(", ")) + ")"
               + " VALUES (" + ([$want[] | . as $c | $r[$c] | lit($udt[$c])] | join(", ")) + ")"
               + " ON CONFLICT (" + ($key | ident) + ") DO NOTHING;"
             end)
       | join("\n")) ]
  + [ "",
      "-- VERIFICATION, inside the transaction. Read it before you COMMIT. The key",
      "-- column leads, so each row is identifiable against the dump.",
      "SELECT count(*) AS \"rowsNow\" FROM \($table | ident);",
      "SELECT " + ([$show[] | ident] | join(", ")) + " FROM \($table | ident) ORDER BY " + ($key | ident) + ";",
      "",
      "COMMIT;" ]
  | .[]
