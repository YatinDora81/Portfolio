-- =============================================================================
-- cluster 30-skills  --  Skill: show -> showInGrid, name UNIQUE, lower(name) UNIQUE
-- target: the Neon child branch (copy-on-write clone of production). NOT production.
-- =============================================================================
--
-- WHAT THIS DOES
--   1. Renames "Skill"."show" to "Skill"."showInGrid".
--      The old name was the whole defect: the flag does not mean "show this skill",
--      it means "show this skill in the #skills grid". Experience and project chip
--      lists ignore it entirely, and it is also the denominator of the hero's
--      "+N more" chip. (packages/db/schema-v2.md, "Skill")
--   2. Adds "Skill_name_key", the UNIQUE index Prisma emits for `name String @unique`.
--   3. Adds "Skill_name_lower_key", a raw UNIQUE index on lower("name").
--      This one cannot be declared in the Prisma schema -- Prisma has no functional
--      index -- so it lives only here and in the CHECK/index inventory in
--      schema-v2.md. It is the constraint that actually stops 'Go' + 'go' from both
--      existing, which matters because the hero badge -> Skill match and the grid
--      alias table both join on a lowercased name.
--
-- WHY BOTH INDEXES. Deliberate redundancy, documented in schema-v2.md: a
-- `prisma db push` drops the functional index (it is not representable in the
-- schema) and would silently lose case-insensitive skill identity. The declared
-- "Skill_name_key" survives a push, so exact-match identity is never lost. Prefer
-- `migrate deploy` on this branch; if anyone ever pushes, re-run statement 3 alone.
--
-- EXPECTED DRIFT, THE ONE IN THIS CLUSTER. After this file runs, a
-- `prisma migrate diff --from-url <branch> --to-schema-datamodel schema.prisma`
-- is expected to come back with EXACTLY ONE statement and no more:
--     DROP INDEX "Skill_name_lower_key";
-- That is not a mistake in this file and it must not be applied. The diff engine
-- compares SQL schema to SQL schema, and the target side is rendered from the
-- datamodel, which cannot express a functional index -- so the engine sees an index
-- with no counterpart and proposes dropping it. This is the same mechanism that
-- makes `db push` drop it. Statements 1 and 2 leave the diff genuinely empty.
-- If the diff proposes anything else at all, this cluster is wrong.
--
-- WHAT THIS DOES NOT DO
--   - The implicit m2m tables "_ExperienceToSkill" / "_ProjectToSkill" -> the explicit
--     "ExperienceSkill" / "ProjectSkill" join models. Separate cluster.
--   - "HeroSkillBadge".name/.iconKey -> skillId + label override. Separate cluster,
--     and it must run AFTER this one (see ORDERING).
--   - Skill already has createdAt (DEFAULT CURRENT_TIMESTAMP) and updatedAt, both
--     NOT NULL, from 20260307195336_init. No timestamp work here.
--
-- ORDERING
--   Depends on nothing. Safe to run at any point after the migration-history repair.
--   Must run BEFORE the HeroSkillBadge cluster: that cluster resolves 14 badges to
--   skills by lower(name), and "Skill_name_lower_key" is what proves that join can
--   never be ambiguous. Running it after would leave the badge backfill trusting an
--   uniqueness property nothing enforced yet.
--
-- TRANSACTIONS
--   Every statement here is transactional. Wrap the whole file in one
--   BEGIN / COMMIT. Nothing needs CREATE INDEX CONCURRENTLY: "Skill" is 47 rows and
--   the branch serves no traffic, so the brief ACCESS EXCLUSIVE lock is free.
--   The DO block in statement 1 executes inside the caller's transaction; it opens
--   no subtransaction of its own. The DO block in V5 does open one (it has an
--   EXCEPTION handler) but rolls it back itself and leaves no row behind.
--
-- DATA LOSS
--   None. This is a rename plus two indexes. Every byte in the table survives; the
--   column keeps its type, its NOT NULL and its DEFAULT true across the rename.
--
-- ROLLBACK (exact inverse, no data loss, safe to run standalone)
--   BEGIN;
--     DROP INDEX IF EXISTS "Skill_name_lower_key";
--     DROP INDEX IF EXISTS "Skill_name_key";
--     ALTER TABLE "Skill" RENAME COLUMN "showInGrid" TO "show";
--   COMMIT;
--
-- COUPLED WITH A CODE CHANGE. The rename breaks four live call sites the moment it
-- lands, so the branch is only coherent once the matching commit ships:
--   apps/web/app/lib/data.ts:181                 where: { show: true }
--   apps/docs/app/lib/actions/staging.ts:535,663,666   skill create + update branches
--   apps/docs/app/(dashboard)/skills/page.tsx:34,36    s.show
--   apps/docs/app/(dashboard)/skills/table.tsx         skill.show, x8
-- The staging layer also needs a readable uniqueness error: after statement 2 an
-- operator retyping an existing skill name gets a raw P2002 that rolls back their
-- whole staged batch, because staging.ts's skill create branch does no pre-check.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PREFLIGHT
-- Run these first and read them. Every expected result below is grounded in
-- /tmp/v2/data-facts.txt (47 Skill names, "lower() duplicates: none",
-- "show=false: ['React.js', 'WebSocket']") and in the DDL from
-- prisma/migrations/20260307195336_init/migration.sql, which is the only migration
-- that ever touched "Skill": it created the table with "show" and Skill_pkey, and
-- nothing since has added a unique index on name.
-- -----------------------------------------------------------------------------

-- P1. The table is in the state this cluster expects: "show" present, "showInGrid" absent.
-- expected: exactly 1 row -> (has_show = true, has_show_in_grid = false)
SELECT
  count(*) FILTER (WHERE "column_name" = 'show')       = 1 AS "has_show",
  count(*) FILTER (WHERE "column_name" = 'showInGrid') = 1 AS "has_show_in_grid"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name"   = 'Skill';

-- P2. No exact duplicate names. A duplicate would make statement 2 fail.
-- expected: 0 rows
SELECT "name", count(*) AS "n"
FROM "Skill"
GROUP BY "name"
HAVING count(*) > 1;

-- P3. No duplicates under lower(). A duplicate would make statement 3 fail.
-- data-facts says "lower() duplicates: none" for all 47 rows; this proves it here.
-- Watch out for the near-misses that are NOT collisions and must stay distinct:
--   'WebSocket' / 'WebSockets', 'React' / 'React.js', 'Drizzle' / 'Drizzle ORM',
--   'AWS' / 'AWS S3' / 'AWS EC2', 'Cloudflare' / 'Cloudflare R2', 'GitHub' / 'GitHub Actions'.
-- expected: 0 rows
SELECT lower("name") AS "lower_name", count(*) AS "n", array_agg("name" ORDER BY "name") AS "names"
FROM "Skill"
GROUP BY lower("name")
HAVING count(*) > 1;

-- P4. Neither target index name is already taken (by any table, since index names
-- are schema-scoped in Postgres).
-- expected: 0 rows
SELECT "indexname", "tablename"
FROM "pg_indexes"
WHERE "schemaname" = current_schema()
  AND "indexname" IN ('Skill_name_key', 'Skill_name_lower_key');

-- P5. Row-count and visibility baseline, to compare against V4 afterwards.
-- Reads the flag through to_jsonb(row) rather than naming the column, so this
-- statement survives a re-run of the whole file after the rename has already landed:
-- ->> returns NULL for a key that is not there, so the COALESCE picks whichever of
-- the two column names currently exists. Referencing "show" directly here would make
-- the second run abort the transaction on 'column "show" does not exist'.
-- expected: 1 row -> (total = 47, in_grid = 45, hidden = 2)
SELECT
  count(*) AS "total",
  count(*) FILTER (WHERE COALESCE((to_jsonb("s") ->> 'show')::boolean, (to_jsonb("s") ->> 'showInGrid')::boolean))       AS "in_grid",
  count(*) FILTER (WHERE NOT COALESCE((to_jsonb("s") ->> 'show')::boolean, (to_jsonb("s") ->> 'showInGrid')::boolean))   AS "hidden"
FROM "Skill" "s";

-- P6. INFORMATIONAL, NOT A GATE. Names that would collide if identity were ever
-- widened to btrim(lower(name)). The 47 names in data-facts carry no leading or
-- trailing whitespace, so this is expected empty, but nothing in this cluster
-- enforces trimming and a row returned here would not block the migration.
-- expected: 0 rows
SELECT btrim(lower("name")) AS "trimmed", count(*) AS "n", array_agg("name" ORDER BY "name") AS "names"
FROM "Skill"
GROUP BY btrim(lower("name"))
HAVING count(*) > 1;

-- P7. Hard guard. P1-P5 as one statement that aborts the transaction instead of
-- printing a result, so the file is safe to run non-interactively. Raises before any
-- DDL runs. Keep this even though P1-P5 exist: a human skimming output misses a row.
DO $$
DECLARE
  "has_show"        boolean;
  "has_new"         boolean;
  "dup_exact"       bigint;
  "dup_lower"       bigint;
  "idx_taken"       bigint;
  "total"           bigint;
BEGIN
  SELECT
    count(*) FILTER (WHERE "column_name" = 'show')       = 1,
    count(*) FILTER (WHERE "column_name" = 'showInGrid') = 1
  INTO "has_show", "has_new"
  FROM "information_schema"."columns"
  WHERE "table_schema" = current_schema() AND "table_name" = 'Skill';

  IF "has_new" AND NOT "has_show" THEN
    RAISE NOTICE '30-skills: "Skill"."showInGrid" already present, rename already applied';
  ELSIF NOT "has_show" THEN
    RAISE EXCEPTION '30-skills: "Skill" has neither "show" nor "showInGrid" -- unexpected shape, refusing to continue';
  ELSIF "has_show" AND "has_new" THEN
    RAISE EXCEPTION '30-skills: "Skill" has BOTH "show" and "showInGrid" -- a partial run happened, resolve by hand';
  END IF;

  SELECT count(*) INTO "dup_exact" FROM (
    SELECT 1 FROM "Skill" GROUP BY "name" HAVING count(*) > 1
  ) "d";
  IF "dup_exact" > 0 THEN
    RAISE EXCEPTION '30-skills: % duplicate "Skill"."name" value(s); dedupe before adding Skill_name_key', "dup_exact";
  END IF;

  SELECT count(*) INTO "dup_lower" FROM (
    SELECT 1 FROM "Skill" GROUP BY lower("name") HAVING count(*) > 1
  ) "d";
  IF "dup_lower" > 0 THEN
    RAISE EXCEPTION '30-skills: % case-insensitive duplicate "Skill"."name" value(s); dedupe before adding Skill_name_lower_key', "dup_lower";
  END IF;

  SELECT count(*) INTO "idx_taken"
  FROM "pg_indexes"
  WHERE "schemaname" = current_schema()
    AND "indexname" IN ('Skill_name_key', 'Skill_name_lower_key');
  IF "idx_taken" > 0 THEN
    RAISE NOTICE '30-skills: % of the 2 target index names already exist, the IF NOT EXISTS statements below will no-op', "idx_taken";
  END IF;

  SELECT count(*) INTO "total" FROM "Skill";
  IF "total" <> 47 THEN
    RAISE NOTICE '30-skills: "Skill" holds % rows, data-facts recorded 47 -- not fatal, but the V4 expectation below is stale', "total";
  END IF;
END
$$;


-- -----------------------------------------------------------------------------
-- DDL, in dependency order
-- -----------------------------------------------------------------------------

-- 1. show -> showInGrid.
-- Postgres has no ALTER TABLE ... RENAME COLUMN IF EXISTS, so the DO block supplies
-- the idempotency. RENAME COLUMN carries the type, the NOT NULL and the
-- DEFAULT true over untouched, so no follow-up SET DEFAULT / SET NOT NULL is needed,
-- and it rewrites no heap pages: it is a catalogue-only change.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema() AND "table_name" = 'Skill' AND "column_name" = 'show'
  ) AND NOT EXISTS (
    SELECT 1 FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema() AND "table_name" = 'Skill' AND "column_name" = 'showInGrid'
  ) THEN
    EXECUTE 'ALTER TABLE "Skill" RENAME COLUMN "show" TO "showInGrid"';
  END IF;
END
$$;

-- 2. The declared unique. Name and form match exactly what Prisma emits for
-- `name String @unique` on model Skill, so `prisma migrate diff` stays quiet:
-- Table_column_key, a UNIQUE INDEX rather than a UNIQUE CONSTRAINT.
CREATE UNIQUE INDEX IF NOT EXISTS "Skill_name_key" ON "Skill" ("name");

-- 3. The raw functional unique. Not declarable in Prisma; this statement is the only
-- record of it besides the inventory in schema-v2.md. lower(text) is IMMUTABLE, so it
-- is legal in an index expression without any extension.
-- If a future `db push` drops this, re-run this single statement.
CREATE UNIQUE INDEX IF NOT EXISTS "Skill_name_lower_key" ON "Skill" (lower("name"));


-- No DML. Nothing to backfill: the rename preserves every value, and neither index
-- needs a data fix because P2 and P3 proved the table is already conformant.


-- -----------------------------------------------------------------------------
-- VERIFICATION
-- -----------------------------------------------------------------------------

-- V1. The column landed with its type, nullability and default intact, and the old
-- name is gone.
-- expected: exactly 1 row ->
--   ('showInGrid', 'boolean', 'NO', 'true')
SELECT "column_name", "data_type", "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name"   = 'Skill'
  AND "column_name" IN ('show', 'showInGrid');

-- V2. Exactly three indexes on "Skill", with these exact names and definitions.
-- expected: 3 rows, in this order ->
--   Skill_name_key        CREATE UNIQUE INDEX "Skill_name_key" ON public."Skill" USING btree (name)
--   Skill_name_lower_key  CREATE UNIQUE INDEX "Skill_name_lower_key" ON public."Skill" USING btree (lower(name))
--   Skill_pkey            CREATE UNIQUE INDEX "Skill_pkey" ON public."Skill" USING btree (id)
SELECT "indexname", "indexdef"
FROM "pg_indexes"
WHERE "schemaname" = current_schema()
  AND "tablename"  = 'Skill'
ORDER BY "indexname";

-- V3. Both new indexes are UNIQUE, VALID and live (not INVALID from a failed build,
-- not marked !indisready). pg_indexes above shows the DDL text; this shows the state.
-- expected: 2 rows ->
--   ('Skill_name_key',       true, true, true)
--   ('Skill_name_lower_key', true, true, true)
SELECT "c"."relname" AS "index", "i"."indisunique", "i"."indisvalid", "i"."indisready"
FROM "pg_index" "i"
JOIN "pg_class" "c" ON "c"."oid" = "i"."indexrelid"
WHERE "i"."indrelid" = '"Skill"'::regclass
  AND "c"."relname" IN ('Skill_name_key', 'Skill_name_lower_key')
ORDER BY "c"."relname";

-- V4. No row and no value was lost, and visibility is byte-identical to the P5
-- baseline. data-facts: 47 rows, show=false on exactly 'React.js' and 'WebSocket'.
-- expected: 1 row -> (47, 45, 2, {React.js,WebSocket})
SELECT
  count(*)                                        AS "total",
  count(*) FILTER (WHERE "showInGrid")            AS "in_grid",
  count(*) FILTER (WHERE NOT "showInGrid")        AS "hidden",
  array_agg("name" ORDER BY "name") FILTER (WHERE NOT "showInGrid") AS "hidden_names"
FROM "Skill";

-- V5. The functional index actually fires. Inserting 'go' must collide with the
-- existing 'Go' even though no exact duplicate exists, which is the one behaviour
-- "Skill_name_key" alone cannot give. The EXCEPTION handler opens a subtransaction
-- that is rolled back on the violation, so the probe row never lands and the outer
-- transaction stays clean.
-- Note: "Skill_name_key" has no equivalent probe. Any exact-duplicate name is also a
-- lower() duplicate, so it cannot be tested in isolation; V2 and V3 cover it.
-- expected: NOTICE '30-skills: ok, Skill_name_lower_key rejected a case-variant insert'
--           and 0 rows added (see V6)
DO $$
BEGIN
  BEGIN
    INSERT INTO "Skill" ("id", "name", "iconKey", "showInGrid", "sortOrder", "createdAt", "updatedAt")
    VALUES ('00000000-0000-0000-0000-0000000030f1', 'go', 'Go', true, 999999, now(), now());
    RAISE EXCEPTION '30-skills: FAILED -- lower-case duplicate ''go'' was accepted, Skill_name_lower_key is not enforcing';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE '30-skills: ok, Skill_name_lower_key rejected a case-variant insert';
  END;
END
$$;

-- V6. The V5 probe left nothing behind.
-- expected: 1 row -> (0)
SELECT count(*) AS "probe_rows"
FROM "Skill"
WHERE "id" = '00000000-0000-0000-0000-0000000030f1' OR "name" = 'go';

-- V7. Uniqueness now holds in both forms, which is the invariant the HeroSkillBadge
-- cluster's lower(name) join relies on.
-- expected: 1 row -> (47, 47, 47)
SELECT
  count(*)                        AS "rows",
  count(DISTINCT "name")          AS "distinct_names",
  count(DISTINCT lower("name"))   AS "distinct_lower_names"
FROM "Skill";
