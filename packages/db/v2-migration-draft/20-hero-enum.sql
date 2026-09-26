-- ============================================================================
-- Cluster 20-hero-enum
-- Branch migration for the v2 schema. Runs against the Neon child branch only.
-- ============================================================================
--
-- WHAT THIS DOES
--
-- Creates the "SiteVersion" enum ('v1','v2' — lowercase labels, no @map, because
-- eleven files compare and print the raw string "v1"/"v2" and two admin <Select>
-- controls silently fall back to their first option when the stored value does
-- not match) and retypes the four version columns that are TEXT + CHECK today:
--
--   "HeroContent"."version"     NOT NULL, UNIQUE, no default
--   "HeroTitle"."version"       NOT NULL, DEFAULT 'v2'
--   "HeroSkillBadge"."version"  NOT NULL, DEFAULT 'v2'
--   "SocialLink"."version"      NULLABLE, no default (NULL means "every hero")
--
-- FOUR CHECK constraints are retired, not three. Three came from
-- 20260728120000_add_hero_version ("HeroTitle_version_check",
-- "HeroSkillBadge_version_check", "SocialLink_version_check"); the fourth,
-- "HeroContent_version_check", came from 20260728140000_add_hero_content and is
-- the one that gets missed. All four constrain the column being retyped, so all
-- four must go: the enum is now the guard. "HeroContent_live_check" is a
-- different constraint on a different column and is deliberately left alone.
--
-- "HeroTitle" and "HeroSkillBadge" carry DEFAULT 'v2' as TEXT. Postgres will not
-- cast a default expression across a type change (text has no assignment cast to
-- an enum), so each needs DROP DEFAULT, then the retype, then SET DEFAULT again.
-- "HeroContent"."version" has no default and needs only its CHECK dropped first.
--
-- Also adds "createdAt"/"updatedAt" to "HeroContent", "HeroTitle" and
-- "SocialLink" — the three tables in this cluster that gain timestamps in the v2
-- schema. House style, matching 20260822100000 and 20260822110000: both columns
-- are added NOT NULL DEFAULT CURRENT_TIMESTAMP so existing rows get a value, and
-- then "updatedAt" DROPs its default, because Prisma's @updatedAt writes that
-- column client-side and a lingering DB default would show up as drift.
-- "createdAt" KEEPS its default; that is Prisma's @default(now()).
--
-- "HeroSkillBadge" also gains timestamps in the v2 schema, but not here: that
-- table is rebuilt by the badges-become-a-relation cluster (name/iconKey ->
-- skillId, label, @@unique([version, skillId])) and its timestamps belong in the
-- same statement as that rebuild. See open_problems.
--
-- DATA. Nothing is rewritten. Per /tmp/v2/data-facts.txt the stored values are
-- already exactly the enum labels: "HeroContent"."version" and
-- "HeroTitle"."version" and "HeroSkillBadge"."version" hold only 'v1' and 'v2',
-- and "SocialLink"."version" is NULL on all 6 rows — the 'v1' that
-- 20260728120000 stamped on 'LeetCode 2' is no longer there. So no USING CASE,
-- no coercion, no row loses information. "HeroContent"."live" is untouched:
-- 'live' on the v2 row, NULL on the v1 row.
--
-- TRANSACTIONALITY. Every statement below is transactional and the whole file is
-- meant to run inside ONE transaction (BEGIN; \i this file; COMMIT;). There is
-- no CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD VALUE and no VACUUM here.
-- The usual enum trap does not apply: the "cannot use a newly added enum value
-- in the same transaction" rule is about ALTER TYPE ... ADD VALUE on a
-- pre-existing type. "SiteVersion" is CREATEd in this transaction, so its labels
-- are usable immediately, including in the USING casts and the SET DEFAULTs.
-- Each ALTER COLUMN TYPE takes ACCESS EXCLUSIVE and rewrites the table plus its
-- indexes; the tables are 2, ~6, 14 and 6 rows, so that is instantaneous.
-- Owner-level DDL only: no session_replication_role, no DISABLE TRIGGER ALL, no
-- CREATE EXTENSION.
--
-- ROLLBACK. If the transaction is still open, ROLLBACK. After COMMIT, this
-- reverses it exactly (run in one transaction, in this order):
--
--   ALTER TABLE "HeroTitle"      ALTER COLUMN "version" DROP DEFAULT;
--   ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" DROP DEFAULT;
--   ALTER TABLE "HeroContent"    ALTER COLUMN "version" TYPE TEXT USING "version"::text;
--   ALTER TABLE "HeroTitle"      ALTER COLUMN "version" TYPE TEXT USING "version"::text;
--   ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" TYPE TEXT USING "version"::text;
--   ALTER TABLE "SocialLink"     ALTER COLUMN "version" TYPE TEXT USING "version"::text;
--   ALTER TABLE "HeroTitle"      ALTER COLUMN "version" SET DEFAULT 'v2';
--   ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" SET DEFAULT 'v2';
--   ALTER TABLE "HeroContent"    ADD CONSTRAINT "HeroContent_version_check"    CHECK ("version" IN ('v1','v2'));
--   ALTER TABLE "HeroTitle"      ADD CONSTRAINT "HeroTitle_version_check"      CHECK ("version" IN ('v1','v2'));
--   ALTER TABLE "HeroSkillBadge" ADD CONSTRAINT "HeroSkillBadge_version_check" CHECK ("version" IN ('v1','v2'));
--   ALTER TABLE "SocialLink"     ADD CONSTRAINT "SocialLink_version_check"     CHECK ("version" IS NULL OR "version" IN ('v1','v2'));
--   ALTER TABLE "HeroContent" DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
--   ALTER TABLE "HeroTitle"   DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
--   ALTER TABLE "SocialLink"  DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
--   DROP TYPE "SiteVersion";
--
-- The DROP TYPE only succeeds once nothing references it, so it must come last —
-- and it will fail if the SiteSettings cluster has already typed
-- "projectsVersion"/"backgroundVersion" with it. Roll that cluster back first.
-- Rolling back loses the timestamp values, which were migration-time stamps
-- rather than real creation times to begin with.
--
-- ============================================================================


-- ============================================================================
-- PREFLIGHT
-- Read these before letting the DDL run. Every one of them is a plain SELECT and
-- touches nothing. The casts are written "version"::text so each assertion is
-- still runnable after the retype.
-- ============================================================================

-- P1. No stored value is outside the enum. NULL is legal only on "SocialLink".
--     data-facts.txt: HeroContent/HeroTitle/HeroSkillBadge hold only v1 and v2;
--     SocialLink."version" is NULL on all 6 rows.
--     EXPECTED: 0 rows. Any row here means the USING cast below would fail, and
--     the value is information — investigate it, do not CASE it away.
SELECT 'HeroContent' AS "table", "id", "version"::text AS "value"
  FROM "HeroContent"
 WHERE "version" IS NULL OR "version"::text NOT IN ('v1', 'v2')
UNION ALL
SELECT 'HeroTitle', "id", "version"::text
  FROM "HeroTitle"
 WHERE "version" IS NULL OR "version"::text NOT IN ('v1', 'v2')
UNION ALL
SELECT 'HeroSkillBadge', "id", "version"::text
  FROM "HeroSkillBadge"
 WHERE "version" IS NULL OR "version"::text NOT IN ('v1', 'v2')
UNION ALL
SELECT 'SocialLink', "id", "version"::text
  FROM "SocialLink"
 WHERE "version" IS NOT NULL AND "version"::text NOT IN ('v1', 'v2');

-- P2. All four CHECK constraints are present, and the only other CHECK on these
--     four tables is "HeroContent_live_check", which must survive.
--     EXPECTED: 5 rows —
--       HeroContent    | HeroContent_live_check         | CHECK (("live" IS NULL) OR ("live" = 'live'::text))
--       HeroContent    | HeroContent_version_check      | CHECK ("version" = ANY (ARRAY['v1'::text, 'v2'::text]))
--       HeroSkillBadge | HeroSkillBadge_version_check   | CHECK ("version" = ANY (ARRAY['v1'::text, 'v2'::text]))
--       HeroTitle      | HeroTitle_version_check        | CHECK ("version" = ANY (ARRAY['v1'::text, 'v2'::text]))
--       SocialLink     | SocialLink_version_check       | CHECK (("version" IS NULL) OR ("version" = ANY (...)))
--     On a re-run only the "live" row remains; the drops below are IF EXISTS.
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"HeroContent"'::regclass,
                        '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass,
                        '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- P3. The four columns are still TEXT, and the defaults are where we expect.
--     EXPECTED: 4 rows —
--       HeroContent    | version | text | NO  | (null)
--       HeroSkillBadge | version | text | NO  | 'v2'::text
--       HeroTitle      | version | text | NO  | 'v2'::text
--       SocialLink     | version | text | YES | (null)
--     If a default has moved or a column is already USER-DEFINED, stop: the
--     DROP DEFAULT / SET DEFAULT pairing below is written against this exact
--     starting state.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND "column_name"::text = 'version'
   AND "table_name"::text IN ('HeroContent', 'HeroTitle', 'HeroSkillBadge', 'SocialLink')
 ORDER BY 1;

-- P4. The enum does not exist yet.
--     EXPECTED: 0 rows on a first run. On a re-run: exactly v1 then v2, in that
--     order. Any other label set means somebody created a different type under
--     this name and the CREATE below will silently accept it.
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM pg_type t
  JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'SiteVersion'
   AND n."nspname" = current_schema()
 ORDER BY e."enumsortorder";

-- P5. None of the six timestamp columns exist yet.
--     EXPECTED: 0 rows. Every ADD COLUMN below is IF NOT EXISTS, so a re-run is
--     harmless, but a pre-existing "updatedAt" WITH a default would survive the
--     re-run untouched and show up later as drift.
SELECT "table_name", "column_name", "data_type", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name"::text IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name"::text IN ('createdAt', 'updatedAt')
 ORDER BY 1, 2;

-- P6. The live-hero pointer is sane before we touch the table it sits on.
--     data-facts.txt: two rows, "live" = 'live' on v2 and NULL on v1.
--     EXPECTED: 1 row — 2 | 1 | v2
SELECT count(*) AS "rows",
       count("live") AS "liveRows",
       (SELECT "version"::text FROM "HeroContent" WHERE "live" IS NOT NULL) AS "liveVersion"
  FROM "HeroContent";

-- P7. Row-count snapshot, so the verification at the bottom can prove nothing
--     was lost without hard-coding a number data-facts.txt does not state
--     ("HeroTitle"'s row count is not in it; schema-v2.md says five v1 titles
--     and one v2, which is design intent, not a measurement).
--     "versioned" is count("version"), i.e. the non-NULL version count: it is 0
--     for "SocialLink" before and must still be 0 after, which is how we prove
--     the NULLs were not coerced into a label.
--     EXPECTED: 4 rows — HeroContent 2|2, HeroSkillBadge 14|14, SocialLink 6|0,
--     HeroTitle <n>|<n>.
DROP TABLE IF EXISTS "_pre20_hero_counts";
CREATE TEMP TABLE "_pre20_hero_counts" AS
SELECT 'HeroContent' AS "table", count(*) AS "rows", count("version") AS "versioned" FROM "HeroContent"
UNION ALL
SELECT 'HeroTitle',      count(*), count("version") FROM "HeroTitle"
UNION ALL
SELECT 'HeroSkillBadge', count(*), count("version") FROM "HeroSkillBadge"
UNION ALL
SELECT 'SocialLink',     count(*), count("version") FROM "SocialLink";

SELECT * FROM "_pre20_hero_counts" ORDER BY "table";

-- P8. Fail-closed guard. Optional, and only here because running the whole file
--     in one transaction means nobody gets to read P1's output before the DDL
--     executes. It re-asserts P1 and aborts the transaction instead of letting
--     the USING cast fail with a less informative message. Delete it if the
--     preflight is being run by hand as a separate step.
DO $$
DECLARE
  "bad" bigint;
BEGIN
  SELECT count(*) INTO "bad" FROM (
    SELECT 1 FROM "HeroContent"    WHERE "version" IS NULL OR "version"::text NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "HeroTitle"      WHERE "version" IS NULL OR "version"::text NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "HeroSkillBadge" WHERE "version" IS NULL OR "version"::text NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "SocialLink"     WHERE "version" IS NOT NULL AND "version"::text NOT IN ('v1','v2')
  ) "offenders";

  IF "bad" > 0 THEN
    RAISE EXCEPTION
      '20-hero-enum: % version value(s) outside (v1, v2). Run preflight P1 and resolve them; do not coerce.', "bad";
  END IF;
END $$;


-- ============================================================================
-- DDL, in dependency order
-- ============================================================================

-- 1. The type. Postgres has no CREATE TYPE ... IF NOT EXISTS, hence the guard.
--    Label order matters: it is the schema's declaration order, and it is what
--    ORDER BY "version" will mean from now on (v1 sorts before v2, which is also
--    what the old TEXT column did, so no read changes meaning).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'SiteVersion'
       AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "SiteVersion" AS ENUM ('v1', 'v2');
  END IF;
END $$;

-- 2. Retire the four CHECKs. These MUST precede the retypes: a CHECK against
--    text literals cannot survive its column becoming an enum, and Postgres
--    would reject the ALTER rather than rewrite the constraint.
--    "HeroContent_live_check" is NOT in this list, on purpose.
ALTER TABLE "HeroContent"    DROP CONSTRAINT IF EXISTS "HeroContent_version_check";
ALTER TABLE "HeroTitle"      DROP CONSTRAINT IF EXISTS "HeroTitle_version_check";
ALTER TABLE "HeroSkillBadge" DROP CONSTRAINT IF EXISTS "HeroSkillBadge_version_check";
ALTER TABLE "SocialLink"     DROP CONSTRAINT IF EXISTS "SocialLink_version_check";

-- 3. "HeroContent"."version" — no default to juggle. The USING cast is
--    text -> enum by label, and it is written ::text::"SiteVersion" so the
--    statement is re-runnable after the column is already an enum.
--    "HeroContent_version_key" (UNIQUE) is rebuilt by this ALTER and keeps its
--    name; so does "HeroContent_pkey". "live" and "HeroContent_live_key" are not
--    involved.
ALTER TABLE "HeroContent"
  ALTER COLUMN "version" TYPE "SiteVersion" USING "version"::text::"SiteVersion";

-- 4. "HeroTitle"."version" — DROP DEFAULT, retype, SET DEFAULT. Without the drop
--    the ALTER fails with "default for column "version" cannot be cast
--    automatically to type SiteVersion". The restored default is the same value
--    it has held since 20260728120000, now as an enum literal, which is what
--    @default(v2) in the schema compiles to.
--    "HeroTitle_version_sortOrder_idx" is rebuilt in place, name preserved.
ALTER TABLE "HeroTitle" ALTER COLUMN "version" DROP DEFAULT;
ALTER TABLE "HeroTitle"
  ALTER COLUMN "version" TYPE "SiteVersion" USING "version"::text::"SiteVersion";
ALTER TABLE "HeroTitle" ALTER COLUMN "version" SET DEFAULT 'v2'::"SiteVersion";

-- 5. "HeroSkillBadge"."version" — same three steps, same reason. This cluster
--    touches nothing else on this table: "name", "iconKey", the new "skillId"
--    FK, "label" and this table's own timestamps belong to the badges-become-a-
--    relation cluster, and neither order of the two clusters breaks the other.
--    "HeroSkillBadge_version_sortOrder_idx" is rebuilt in place.
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" DROP DEFAULT;
ALTER TABLE "HeroSkillBadge"
  ALTER COLUMN "version" TYPE "SiteVersion" USING "version"::text::"SiteVersion";
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" SET DEFAULT 'v2'::"SiteVersion";

-- 6. "SocialLink"."version" — stays NULLABLE with no default, because NULL is a
--    real, meaningful value here: "shown in every hero version". All 6 rows are
--    NULL today and all 6 stay NULL; the cast never sees a non-NULL input.
--    "SocialLink_version_sortOrder_idx" is rebuilt in place.
ALTER TABLE "SocialLink"
  ALTER COLUMN "version" TYPE "SiteVersion" USING "version"::text::"SiteVersion";

-- 7. Timestamps. Added with a default so the existing rows get a value, then
--    "updatedAt" drops it: Prisma's @updatedAt supplies that column on every
--    write and expects no database default, while @default(now()) on "createdAt"
--    is exactly the default that stays. TIMESTAMP(3) is what Prisma's DateTime
--    maps to on Postgres, matching every other table here.
--    These tables carry no pre-existing timestamp of any kind, so the backfilled
--    value is the migration's clock, not the row's real birthday. See data_loss.
ALTER TABLE "HeroContent"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HeroContent" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "HeroTitle"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HeroTitle" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "SocialLink"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SocialLink" ALTER COLUMN "updatedAt" DROP DEFAULT;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- V1. The type exists with exactly two labels, in schema order.
--     EXPECTED: 2 rows — v1 | 1 , v2 | 2
SELECT e."enumlabel", e."enumsortorder"
  FROM pg_type t
  JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'SiteVersion'
   AND n."nspname" = current_schema()
 ORDER BY e."enumsortorder";

-- V2. All four columns are the enum, nullability unchanged, defaults exactly
--     where the schema puts them.
--     EXPECTED: 4 rows —
--       HeroContent    | version | USER-DEFINED | SiteVersion | NO  | (null)
--       HeroSkillBadge | version | USER-DEFINED | SiteVersion | NO  | 'v2'::"SiteVersion"
--       HeroTitle      | version | USER-DEFINED | SiteVersion | NO  | 'v2'::"SiteVersion"
--       SocialLink     | version | USER-DEFINED | SiteVersion | YES | (null)
SELECT "table_name", "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND "column_name"::text = 'version'
   AND "table_name"::text IN ('HeroContent', 'HeroTitle', 'HeroSkillBadge', 'SocialLink')
 ORDER BY 1;

-- V3. Exactly one CHECK survives on these four tables, and it is the live
--     sentinel, byte-identical to what 20260728140000 created.
--     EXPECTED: 1 row —
--       HeroContent | HeroContent_live_check | CHECK ((("live" IS NULL) OR ("live" = 'live'::text)))
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"HeroContent"'::regclass,
                        '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass,
                        '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- V4. Nothing was lost and no NULL was coerced. Compares against P7's snapshot.
--     EXPECTED: 0 rows.
WITH "post" AS (
  SELECT 'HeroContent' AS "table", count(*) AS "rows", count("version") AS "versioned" FROM "HeroContent"
  UNION ALL
  SELECT 'HeroTitle',      count(*), count("version") FROM "HeroTitle"
  UNION ALL
  SELECT 'HeroSkillBadge', count(*), count("version") FROM "HeroSkillBadge"
  UNION ALL
  SELECT 'SocialLink',     count(*), count("version") FROM "SocialLink"
)
SELECT b."table",
       b."rows" AS "rowsBefore",      p."rows" AS "rowsAfter",
       b."versioned" AS "versionedBefore", p."versioned" AS "versionedAfter"
  FROM "_pre20_hero_counts" b
  JOIN "post" p ON p."table" = b."table"
 WHERE b."rows" <> p."rows"
    OR b."versioned" <> p."versioned";

-- V5. The distribution, read back through the enum.
--     EXPECTED: HeroContent v1|1 and v2|1; HeroSkillBadge v1|7 and v2|7
--     (14 rows total, per data-facts.txt); SocialLink (null)|6; HeroTitle split
--     unchanged from P7 — schema-v2.md says five v1 and one v2, which
--     data-facts.txt does not confirm, so V4 is the assertion that binds.
SELECT 'HeroContent' AS "table", "version"::text AS "version", count(*) AS "rows"
  FROM "HeroContent" GROUP BY 2
UNION ALL
SELECT 'HeroTitle', "version"::text, count(*) FROM "HeroTitle" GROUP BY 2
UNION ALL
SELECT 'HeroSkillBadge', "version"::text, count(*) FROM "HeroSkillBadge" GROUP BY 2
UNION ALL
SELECT 'SocialLink', "version"::text, count(*) FROM "SocialLink" GROUP BY 2
 ORDER BY 1, 2;

-- V6. The live pointer came through untouched.
--     EXPECTED: 2 rows — v1 | (null) and v2 | live
SELECT "version"::text AS "version", "live"
  FROM "HeroContent"
 ORDER BY "version";

-- V7. Every index survived the rewrites with its name, uniqueness and validity.
--     EXPECTED: 9 rows, all indisvalid = t —
--       "HeroContent_live_key"                  unique
--       "HeroContent_pkey"                      unique
--       "HeroContent_version_key"               unique
--       "HeroSkillBadge_pkey"                   unique
--       "HeroSkillBadge_version_sortOrder_idx"  not unique
--       "HeroTitle_pkey"                        unique
--       "HeroTitle_version_sortOrder_idx"       not unique
--       "SocialLink_pkey"                       unique
--       "SocialLink_version_sortOrder_idx"      not unique
--     11 rows if the badges-become-a-relation cluster has already run, adding
--     "HeroSkillBadge_version_skillId_key" and "HeroSkillBadge_skillId_idx".
SELECT i."indrelid"::regclass::text AS "table",
       i."indexrelid"::regclass::text AS "index",
       i."indisunique",
       i."indisvalid"
  FROM pg_index i
 WHERE i."indrelid" IN ('"HeroContent"'::regclass,
                        '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass,
                        '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- V8. The six timestamp columns: NOT NULL, TIMESTAMP(3), "createdAt" keeps its
--     default and "updatedAt" has none.
--     EXPECTED: 6 rows, one pair per table —
--       <table> | createdAt | timestamp without time zone | 3 | NO | CURRENT_TIMESTAMP
--       <table> | updatedAt | timestamp without time zone | 3 | NO | (null)
SELECT "table_name", "column_name", "data_type", "datetime_precision", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name"::text IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name"::text IN ('createdAt', 'updatedAt')
 ORDER BY 1, 2;

-- V9. No row came out of the backfill without both stamps.
--     EXPECTED: 0 rows.
SELECT 'HeroContent' AS "table", "id" FROM "HeroContent" WHERE "createdAt" IS NULL OR "updatedAt" IS NULL
UNION ALL
SELECT 'HeroTitle',  "id" FROM "HeroTitle"  WHERE "createdAt" IS NULL OR "updatedAt" IS NULL
UNION ALL
SELECT 'SocialLink', "id" FROM "SocialLink" WHERE "createdAt" IS NULL OR "updatedAt" IS NULL;

-- Tidy up the snapshot. It is a TEMP table, so it also dies with the session.
DROP TABLE IF EXISTS "_pre20_hero_counts";
