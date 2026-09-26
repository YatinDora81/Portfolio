-- ============================================================================
-- PRODUCTION EXPAND — cluster: hero
--   "SiteVersion" enum over four version columns, four *_version_check
--   constraints retired, createdAt/updatedAt added to HeroContent, HeroTitle
--   and SocialLink.
--
-- Runs against the LIVE production database with the v1 code still deployed and
-- serving. Nothing here is a DROP of anything the deployed code reads.
--
-- RUN AS: two separate short transactions, T1 then T2. NOT as one file inside a
-- multi-cluster transaction. Reason: T2 takes ACCESS EXCLUSIVE on the four hero
-- tables, and every public request that misses the ISR cache blocks behind it
-- (apps/web/app/lib/data.ts:132-146 in HEAD reads all four on a home-page
-- regeneration). At 2 / n / 14 / 6 rows T2 commits in milliseconds; bundled into
-- a minutes-long multi-cluster transaction the same lock becomes a public
-- outage.
--
-- ORDERING IS NOT OPTIONAL: T2 MUST run BEFORE the v2 deploy, not after.
-- The v2 client emits, for every hero read and write:
--     WHERE "version" = CAST($1::text AS "public"."SiteVersion")
--     VALUES (CAST($2::text AS "public"."SiteVersion"))
-- (captured from the real generated client, no guessing). If the type does not
-- exist yet -> 42704 type "public.SiteVersion" does not exist. If the type
-- exists but the column is still TEXT -> 42883 operator does not exist:
-- text = "SiteVersion" on every read and 42804 column "version" is of type text
-- but expression is of type SiteVersion on every write. So there is no
-- "retype it in CONTRACT" option: the home page and /hero would 500 from the
-- first cache miss after the deploy.
--
-- ----------------------------------------------------------------------------
-- "HEAD" IN THIS FILE MEANS COMMIT 0050cc9. IT NO LONGER MEANS `git HEAD`.
-- ----------------------------------------------------------------------------
-- Every v1 citation in this file was written when 0050cc9 was the tip. The v2
-- work has since been committed, so `git HEAD` is f760425 and `git show
-- HEAD:<path>` returns the v2 file — and for this file that inverts the argument
-- completely, because the v2 client is the one that DOES emit
-- CAST($1::text AS "SiteVersion"). Read every v1 claim with
--     git show 0050cc9:<path>
-- and nothing else. 0050cc9 is what Vercel is serving while T2 runs.
-- Working-tree/v2 paths are cited bare, with no prefix.
--
-- ----------------------------------------------------------------------------
-- V1 EVIDENCE RE-VERIFIED AT 0050cc9        (spot check 2 of 5, 2026-09-27)
--
-- WHY THIS FILE IS ONE OF THE FIVE, and arguably the riskiest statement in the
-- whole EXPAND: T2 RETYPES four columns that the deployed code reads and writes,
-- on tables the PUBLIC home page reads on every ISR regeneration. Every other
-- EXPAND file either adds something the old client never mentions or relaxes
-- something. This one changes the type of a live column under a live client, and
-- its safety rests entirely on a claim about what @prisma/adapter-pg puts on the
-- wire. If that claim is wrong, the home page 500s from the first cache miss.
--
-- RE-CHECKED WITH `git show 0050cc9:<path>`, NOT by reading the working tree.
-- Every line number below was confirmed to be exactly where this header already
-- said it was; none needed moving.
--
--  1. THE FOUR COLUMNS ARE PLAIN `String` IN THE DEPLOYED DATAMODEL, which is
--     what makes a raw enum label an acceptable read value.
--       0050cc9:packages/db/prisma/schema.prisma:12   version String  @unique
--       0050cc9:packages/db/prisma/schema.prisma:22   version String  @default("v2")
--       0050cc9:packages/db/prisma/schema.prisma:32   version String  @default("v2")
--       0050cc9:packages/db/prisma/schema.prisma:44   version String?
--     Note :12's @unique — the retype rebuilds that unique index in place. And
--     :44's nullability is why the home-page read has to be an OR over NULL (see
--     item 3). The three `@@index([version, sortOrder])` at :24, :34 and :46 are
--     likewise rebuilt, keeping their names.
--
--  2. NO v1 WRITE CAN PRODUCE A LABEL OUTSIDE ('v1','v2'). CONFIRMED, and this is
--     the claim that licenses dropping the four *_version_check constraints:
--       0050cc9:apps/docs/app/lib/actions/staging.ts:362  function versionReq(...)
--         -> `if (v !== "v1" && v !== "v2") fail(...)` before Prisma is called
--       0050cc9:apps/docs/app/lib/actions/staging.ts:368  function versionOpt(...)
--         -> same, plus undefined/null/"" -> null
--     The three v1 creates that omit "updatedAt" and are the reason the draft's
--     DROP DEFAULT must not run here are also exactly where this header says:
--       0050cc9:apps/docs/app/lib/actions/staging.ts:482  tx.heroTitle.create
--       0050cc9:apps/docs/app/lib/actions/staging.ts:493  tx.heroSkillBadge.create
--       0050cc9:apps/docs/app/lib/actions/staging.ts:561  tx.socialLink.create
--       0050cc9:apps/docs/app/lib/actions/social-links.ts:21  socialLink.create
--
--  3. THE PUBLIC READ PATH IS REAL AND IT IS UNCAUGHT. This is why T2 gets its
--     own short transaction rather than riding in a multi-cluster one.
--       0050cc9:apps/web/app/lib/data.ts:135  where: { version }
--       0050cc9:apps/web/app/lib/data.ts:139  where: { version }
--       0050cc9:apps/web/app/lib/data.ts:143  where: { OR: [{ version }, { version: null }] }
--       0050cc9:apps/web/app/lib/data.ts:76-77 `c.version === "v2"` / `=== "v1"`
--     :76-77 is the one that matters most for the READ direction: it is a
--     JavaScript string comparison against the value the driver hands back. It
--     keeps working only because adapter-pg reports every user enum OID as
--     ColumnTypeEnum.Text, so the value arrives as the raw label "v1"/"v2" and
--     not as an object. `getHeroData` is NOT unstable_cache'd, so it hits the
--     database on every regeneration — there is no cache to hide a mistake here.
--
--  4. ORDER BY "version" KEEPS ITS MEANING. CONFIRMED at the cited line, and the
--     second v1 reader that depends on label order was also confirmed:
--       0050cc9:apps/docs/app/(dashboard)/hero/page.tsx:14
--         heroContent.findMany({ orderBy: { version: "asc" } })
--       0050cc9:apps/docs/app/(dashboard)/dashboard/page.tsx:17-18
--         heroContent.findFirst({ where: { live: "live" }, select: { version: true } })
--         then `row?.version === "v1" ? "v1" : "v2"`
--     Enum sort order is DECLARATION order, not collation order, so this is only
--     safe because "SiteVersion" is declared ('v1','v2') — the same order the
--     text collation produced. Declaring it ('v2','v1') would silently reverse
--     the admin's version list while every other statement in this file still
--     passed. Read the CREATE TYPE below with that in mind.
--
--  5. THE WIRE-FORMAT CLAIM was re-checked in node_modules, not taken on trust:
--     pg-protocol serializer does `const types = query.types || emptyArray` then
--     `addInt16(types.length)`, and @prisma/adapter-pg passes
--     `types: { getTypeParser }` — an object with no `.length` — so
--     `addInt16(undefined)` writes two zero bytes. Zero parameter type OIDs, so
--     every $n is resolved from its use site exactly like a bare literal. This is
--     version-sensitive in a way the rest of this file is not: it is a property of
--     pg 8.20 + adapter-pg as vendored in `bun.lock`, and `bun.lock` is tracked
--     and unchanged by this cutover. If either is ever upgraded, re-derive this
--     before running anything of this shape again.
--
-- VERDICT: T2 is safe against the code actually deployed at 0050cc9. Nothing in
-- the argument needed correcting; only the `HEAD` label did.
-- ----------------------------------------------------------------------------
--
-- WHY T2 IS STILL SAFE FOR THE DEPLOYED v1 CODE (this is the whole question):
--   * v1 emits NO casts and never names a type. Captured from the v1 client
--     generated from git HEAD's schema:
--       SELECT "public"."HeroTitle"."id", ..., "public"."HeroTitle"."version"
--         FROM "public"."HeroTitle" WHERE "public"."HeroTitle"."version" = $1
--       INSERT INTO "public"."HeroTitle" ("id","title","sortOrder","version")
--         VALUES ($1,$2,$3,$4)
--   * @prisma/adapter-pg hands those to node-postgres, which sends Parse with
--     ZERO parameter type OIDs (pg-protocol serializer: `types.length` on the
--     adapter's parser-registry object is undefined -> addInt16(undefined) -> 0).
--     Every $n is therefore type-unspecified and Postgres resolves it from
--     context, exactly like a bare literal: 'v1' becomes SiteVersion in a
--     comparison against the column and in an INSERT target list. v1 writes
--     keep working.
--   * Reading back: the adapter maps any OID >= 16384 to ColumnType.Text
--     (adapter-pg dist/index.js:291-295) and pg has no parser registered for a
--     user enum, so the row value arrives as the raw label string "v1"/"v2" —
--     precisely what the v1 datamodel's `version String` expects. v1 reads keep
--     working, including apps/web/app/lib/data.ts:76-77 (`c.version === "v2"`)
--     and apps/docs/app/(dashboard)/dashboard/page.tsx:17-18.
--   * Also: node-postgres uses the UNNAMED prepared statement (query.name is
--     undefined), re-Parsed on every call, so there is no server-side cached
--     plan to invalidate. The classic "cached plan must not change result type"
--     (0A000) hazard of retyping a live column does not apply to this stack.
--   * ORDER BY "version" keeps its meaning: enum sort order is declaration
--     order v1 < v2, identical to the text collation result. That is the only
--     ordering read, apps/docs/app/(dashboard)/hero/page.tsx:14.
--   * No v1 write can produce a label outside the enum: staging.ts:362-373
--     (versionReq / versionOpt) rejects anything that is not "v1", "v2" or blank
--     before Prisma is called. Dropping the four CHECKs therefore loses nothing
--     that was actually enforcing anything at runtime, and the enum enforces the
--     same set from T2 onwards.
--
-- DELIBERATE DEVIATION FROM THE DRAFT (20-hero-enum.sql step 7): the draft
-- follows each ADD COLUMN with
--     ALTER TABLE ... ALTER COLUMN "updatedAt" DROP DEFAULT;
-- That statement MUST NOT run here. v1 INSERTs omit "updatedAt" entirely —
--   staging.ts:482 heroTitle.create, :493 heroSkillBadge.create,
--   :561 socialLink.create, actions/social-links.ts:21 socialLink.create,
--   plus packages/db/seed.ts and scripts/install-hero-v2.ts if the operator runs
--   them — so a NOT NULL column with no default fails every one of them with
--   23502 null value in column "updatedAt" violates not-null constraint. The
--   admin's whole staged batch rolls back and the operator sees a raw P2010.
--   The DROP DEFAULT moves to hero-contract.sql.
--
-- NOT IN THIS FILE, on purpose:
--   * HeroSkillBadge's own createdAt/updatedAt and the name/iconKey -> skillId
--     rebuild. Cluster 25 (badges). Only that table's "version" retype is here.
--     Cross-cluster warning for whoever writes 25's expand: v1 inserts badges
--     with name + iconKey and no skillId (staging.ts:493), so `skillId TEXT NOT
--     NULL` with no default breaks that path the same way.
--   * SiteSettings."projectsVersion"/"backgroundVersion", which are also typed
--     "SiteVersion" in the v2 schema. They belong to cluster 10, which depends
--     on the CREATE TYPE below. Run this file first, or rely on the IF NOT
--     EXISTS guard in whichever runs second.
-- ============================================================================


-- ============================================================================
-- PREFLIGHT — read-only. Run these first, read the answers, then run T1/T2.
-- ============================================================================

-- X1. Current state of the four columns.
--     EXPECTED, 4 rows:
--       HeroContent    | version | text | NO  | (null)
--       HeroSkillBadge | version | text | NO  | 'v2'::text
--       HeroTitle      | version | text | NO  | 'v2'::text
--       SocialLink     | version | text | YES | (null)
--     If any already reads USER-DEFINED, T2 has already run; stop and re-read.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public'
   AND "column_name" = 'version'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'HeroSkillBadge', 'SocialLink')
 ORDER BY 1;

-- X2. Every stored value is a legal label. NULL is legal only on SocialLink.
--     EXPECTED: 0 rows. (data-facts.txt: HeroContent/HeroTitle/HeroSkillBadge
--     hold only 'v1'/'v2'; SocialLink."version" is NULL on all 6 rows.)
--     Anything here is information, not noise — investigate, do not CASE it away.
SELECT 'HeroContent' AS "table", "id", "version" FROM "HeroContent"
 WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
UNION ALL
SELECT 'HeroTitle', "id", "version" FROM "HeroTitle"
 WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
UNION ALL
SELECT 'HeroSkillBadge', "id", "version" FROM "HeroSkillBadge"
 WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
UNION ALL
SELECT 'SocialLink', "id", "version" FROM "SocialLink"
 WHERE "version" IS NOT NULL AND "version" NOT IN ('v1','v2');

-- X3. The five CHECKs. Four go, "HeroContent_live_check" must survive.
--     EXPECTED: 5 rows.
SELECT c."conrelid"::regclass::text AS "table", c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"HeroContent"'::regclass, '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass, '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- X4. Nothing outside those CHECKs and the indexes depends on the four columns.
--     The draft does not check this. A view, a trigger, a rule, a generated
--     column or an index expression over "version" would make ALTER COLUMN TYPE
--     fail mid-transaction (or silently need rebuilding).
--     EXPECTED: 0 rows.
SELECT DISTINCT d."classid"::regclass::text AS "dependent_catalog",
       d."objid", d."refobjid"::regclass::text AS "on_table"
  FROM pg_depend d
  JOIN pg_attribute a ON a."attrelid" = d."refobjid" AND a."attnum" = d."refobjsubid"
 WHERE d."refobjid" IN ('"HeroContent"'::regclass, '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass, '"SocialLink"'::regclass)
   AND a."attname" = 'version'
   AND d."classid" NOT IN ('pg_constraint'::regclass, 'pg_index'::regclass,
                           'pg_class'::regclass, 'pg_type'::regclass);

-- X5. The type does not exist yet, and neither do the six timestamp columns.
--     EXPECTED: 0 rows from each.
SELECT t."typname", e."enumlabel"
  FROM pg_type t JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'SiteVersion' AND n."nspname" = 'public'
 ORDER BY e."enumsortorder";

SELECT "table_name", "column_name", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name" IN ('createdAt', 'updatedAt')
 ORDER BY 1, 2;

-- X6. Row-count and version-distribution snapshot to compare against after.
--     EXPECTED: HeroContent 2 rows / 2 versioned, HeroSkillBadge 14 / 14,
--     SocialLink 6 / 0 (all NULL — that 0 is how we prove no NULL got coerced),
--     HeroTitle n / n.
SELECT 'HeroContent' AS "table", count(*) AS "rows", count("version") AS "versioned" FROM "HeroContent"
UNION ALL SELECT 'HeroTitle',      count(*), count("version") FROM "HeroTitle"
UNION ALL SELECT 'HeroSkillBadge', count(*), count("version") FROM "HeroSkillBadge"
UNION ALL SELECT 'SocialLink',     count(*), count("version") FROM "SocialLink"
 ORDER BY 1;


-- ============================================================================
-- T1 — timestamps. Purely additive. Zero risk to v1, run it whenever.
-- ============================================================================
-- Why v1 cannot see these columns: Prisma never emits SELECT * — every read is
-- an explicit column list built from the v1 datamodel, e.g.
--   SELECT "HeroTitle"."id", "HeroTitle"."title", "HeroTitle"."sortOrder",
--          "HeroTitle"."version" FROM "public"."HeroTitle"
-- and every v1 INSERT lists only the columns it sets. New columns with defaults
-- are invisible to it in both directions.
--
-- CURRENT_TIMESTAMP is STABLE, so ADD COLUMN takes the fast path: no table
-- rewrite, one timestamp evaluated once and stored as the missing value for all
-- existing rows. It also matches target-ddl.sql:94/106/134 byte for byte, which
-- is what keeps `prisma migrate diff` quiet later.
--
-- SET TIME ZONE 'UTC' first because CURRENT_TIMESTAMP is timestamptz being
-- assigned to timestamp(3): the session zone decides what gets stored, and
-- Prisma treats these columns as UTC. Neon's server default is already UTC; this
-- makes it independent of whatever the operator's psql inherited.

SET TIME ZONE 'UTC';
SET lock_timeout = '3s';
SET statement_timeout = '30s';

BEGIN;

ALTER TABLE "HeroContent"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "HeroTitle"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SocialLink"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- NOTE: "updatedAt" KEEPS its default until hero-contract.sql. See the header.

COMMIT;


-- ============================================================================
-- T2 — the enum flip. Additive in the sense that matters (nothing the deployed
-- v1 code reads or writes stops working), but it is a RETYPE, not an addition:
-- a column has exactly one type, so there is no version of this that leaves the
-- old TEXT column in place. Run it close to the deploy.
-- ============================================================================

SET lock_timeout = '3s';
SET statement_timeout = '30s';

BEGIN;

-- T2.0 Fail closed. Re-asserts X2 inside the transaction, because in a single
--      run nobody gets to read X2's output before the casts execute. Aborts with
--      a readable message instead of a bare 22P02.
DO $$
DECLARE "bad" bigint;
BEGIN
  SELECT count(*) INTO "bad" FROM (
    SELECT 1 FROM "HeroContent"    WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "HeroTitle"      WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "HeroSkillBadge" WHERE "version" IS NULL OR "version" NOT IN ('v1','v2')
    UNION ALL
    SELECT 1 FROM "SocialLink"     WHERE "version" IS NOT NULL AND "version" NOT IN ('v1','v2')
  ) "offenders";
  IF "bad" > 0 THEN
    RAISE EXCEPTION
      'hero-expand T2: % version value(s) outside (v1, v2). Resolve them; do not coerce.', "bad";
  END IF;
END $$;

-- T2.1 The type. Explicitly in "public": the v2 client emits the schema-
--      qualified CAST($1::text AS "public"."SiteVersion"), so a type created in
--      any other schema would fail with 42704 after the deploy even though the
--      columns look right. Label order is declaration order and is what
--      ORDER BY "version" will mean: v1 < v2, same as the text ordering it
--      replaces.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'SiteVersion' AND n."nspname" = 'public'
  ) THEN
    CREATE TYPE "public"."SiteVersion" AS ENUM ('v1', 'v2');
  END IF;
END $$;

-- T2.2 Retire the four CHECKs. They MUST go before the retypes: after the type
--      change the stored expression would need an operator
--      "SiteVersion" = text, which does not exist, so the ALTER would fail
--      rather than rewrite the constraint. Four, not three —
--      "HeroContent_version_check" came from 20260728140000 and is the one that
--      gets forgotten. "HeroContent_live_check" is on a different column and is
--      NOT in this list.
--      Safe for v1: staging.ts:362-373 already rejects any version that is not
--      v1/v2/blank before it reaches the database, so the constraint was not the
--      thing keeping the column clean.
ALTER TABLE "HeroContent"    DROP CONSTRAINT IF EXISTS "HeroContent_version_check";
ALTER TABLE "HeroTitle"      DROP CONSTRAINT IF EXISTS "HeroTitle_version_check";
ALTER TABLE "HeroSkillBadge" DROP CONSTRAINT IF EXISTS "HeroSkillBadge_version_check";
ALTER TABLE "SocialLink"     DROP CONSTRAINT IF EXISTS "SocialLink_version_check";

-- T2.3 HeroContent."version" — NOT NULL, UNIQUE, no default. The UNIQUE index
--      "HeroContent_version_key" and the pkey are rebuilt by the ALTER and keep
--      their names. "live" and "HeroContent_live_key" are not involved.
--      Written ::text::"SiteVersion" so the statement is re-runnable after the
--      column is already an enum.
ALTER TABLE "HeroContent"
  ALTER COLUMN "version" TYPE "public"."SiteVersion" USING "version"::text::"public"."SiteVersion";

-- T2.4 HeroTitle."version" — carries DEFAULT 'v2' as TEXT. Postgres will not
--      cast a default expression across a type change (no assignment cast from
--      text to an enum), so: DROP DEFAULT, retype, SET DEFAULT as an enum
--      literal, which is what @default(v2) compiles to.
--      "HeroTitle_version_sortOrder_idx" is rebuilt in place, name preserved.
ALTER TABLE "HeroTitle" ALTER COLUMN "version" DROP DEFAULT;
ALTER TABLE "HeroTitle"
  ALTER COLUMN "version" TYPE "public"."SiteVersion" USING "version"::text::"public"."SiteVersion";
ALTER TABLE "HeroTitle" ALTER COLUMN "version" SET DEFAULT 'v2'::"public"."SiteVersion";

-- T2.5 HeroSkillBadge."version" — same three steps, same reason. Only the
--      version column of this table is touched here; name/iconKey/skillId/label
--      and this table's timestamps belong to cluster 25.
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" DROP DEFAULT;
ALTER TABLE "HeroSkillBadge"
  ALTER COLUMN "version" TYPE "public"."SiteVersion" USING "version"::text::"public"."SiteVersion";
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" SET DEFAULT 'v2'::"public"."SiteVersion";

-- T2.6 SocialLink."version" — stays NULLABLE with no default. NULL is a real
--      value here ("shown in every hero version"); all 6 rows are NULL and stay
--      NULL, so the cast never sees a non-NULL input. v1's read
--      WHERE ("version" = $1 OR "version" IS NULL) is unaffected.
ALTER TABLE "SocialLink"
  ALTER COLUMN "version" TYPE "public"."SiteVersion" USING "version"::text::"public"."SiteVersion";

COMMIT;


-- ============================================================================
-- VERIFICATION — run after T1 and T2, with v1 still deployed.
-- ============================================================================

-- V1. The type exists in public with exactly two labels in schema order.
--     EXPECTED: 2 rows — v1 | 1, v2 | 2.
SELECT e."enumlabel", e."enumsortorder"
  FROM pg_type t JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'SiteVersion' AND n."nspname" = 'public'
 ORDER BY e."enumsortorder";

-- V2. All four columns are the enum; nullability unchanged; defaults exactly
--     where the schema puts them.
--     EXPECTED: 4 rows —
--       HeroContent    | USER-DEFINED | SiteVersion | NO  | (null)
--       HeroSkillBadge | USER-DEFINED | SiteVersion | NO  | 'v2'::"SiteVersion"
--       HeroTitle      | USER-DEFINED | SiteVersion | NO  | 'v2'::"SiteVersion"
--       SocialLink     | USER-DEFINED | SiteVersion | YES | (null)
SELECT "table_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public' AND "column_name" = 'version'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'HeroSkillBadge', 'SocialLink')
 ORDER BY 1;

-- V3. Exactly one CHECK survives on the four tables and it is the live sentinel.
--     EXPECTED: 1 row —
--       HeroContent | HeroContent_live_check | CHECK ((("live" IS NULL) OR ("live" = 'live'::text)))
SELECT c."conrelid"::regclass::text AS "table", c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"HeroContent"'::regclass, '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass, '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- V4. Nothing lost, no NULL coerced. Compare to X6 by eye.
--     EXPECTED: identical to X6 — HeroContent 2/2, HeroSkillBadge 14/14,
--     SocialLink 6/0, HeroTitle n/n.
SELECT 'HeroContent' AS "table", count(*) AS "rows", count("version") AS "versioned" FROM "HeroContent"
UNION ALL SELECT 'HeroTitle',      count(*), count("version") FROM "HeroTitle"
UNION ALL SELECT 'HeroSkillBadge', count(*), count("version") FROM "HeroSkillBadge"
UNION ALL SELECT 'SocialLink',     count(*), count("version") FROM "SocialLink"
 ORDER BY 1;

-- V5. The live pointer and the two copies came through untouched.
--     EXPECTED: 2 rows — v1 | (null) and v2 | live.
SELECT "version"::text AS "version", "live" FROM "HeroContent" ORDER BY "version";

-- V6. Every index survived with its name, uniqueness and validity.
--     EXPECTED: 9 rows, all indisvalid = t: HeroContent_pkey / _version_key /
--     _live_key, HeroTitle_pkey / _version_sortOrder_idx, HeroSkillBadge_pkey /
--     _version_sortOrder_idx, SocialLink_pkey / _version_sortOrder_idx.
SELECT i."indrelid"::regclass::text AS "table", i."indexrelid"::regclass::text AS "index",
       i."indisunique", i."indisvalid"
  FROM pg_index i
 WHERE i."indrelid" IN ('"HeroContent"'::regclass, '"HeroTitle"'::regclass,
                        '"HeroSkillBadge"'::regclass, '"SocialLink"'::regclass)
 ORDER BY 1, 2;

-- V7. The six timestamp columns: TIMESTAMP(3), NOT NULL, BOTH still carrying
--     CURRENT_TIMESTAMP. If "updatedAt" shows (null) here, the DROP DEFAULT ran
--     too early and the next v1 create of a hero title or social link will fail
--     with 23502 — put it back with
--       ALTER TABLE "<t>" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--     EXPECTED: 6 rows, every column_default = CURRENT_TIMESTAMP.
SELECT "table_name", "column_name", "data_type", "datetime_precision",
       "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name" IN ('createdAt', 'updatedAt')
 ORDER BY 1, 2;

-- V8. The deployed v1 code can still read and filter. This is the read path the
--     public home page uses, executed through the enum.
--     EXPECTED: the live hero's titles, in sortOrder, same as before EXPAND.
SELECT "id", "title", "sortOrder", "version"::text AS "version"
  FROM "HeroTitle"
 WHERE "version" = (SELECT "version" FROM "HeroContent" WHERE "live" IS NOT NULL)
 ORDER BY "sortOrder" ASC, "id" ASC;

-- V9. Smoke the live site and the admin BEFORE deploying, with the v1 code that
--     is already running:
--       curl -s -o /dev/null -w '%{http_code}\n' https://www.yatindora.in/
--       then, in the admin, open /hero and save one harmless edit
--     A 200 and a successful save prove v1-against-enum end to end. If you want
--     that proof without touching production at all, cut a fresh Neon branch
--     from production, run T1+T2 on the branch, point a `git stash`-clean HEAD
--     checkout at it and load the home page.


-- ============================================================================
-- ROLLBACK of EXPAND — valid ONLY while v1 is still the deployed code.
-- Once v2 is deployed, reversing T2 breaks every hero query instantly (42883 /
-- 42804). Roll the code back first, then this.
-- ============================================================================
-- BEGIN;
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
-- COMMIT;
-- -- then, only if no other cluster is using the type (cluster 10 types
-- -- SiteSettings."projectsVersion"/"backgroundVersion" with it; roll that back first):
-- DROP TYPE "public"."SiteVersion";
-- -- T1 is separately reversible and there is almost never a reason to:
-- ALTER TABLE "HeroContent" DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
-- ALTER TABLE "HeroTitle"   DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
-- ALTER TABLE "SocialLink"  DROP COLUMN "createdAt", DROP COLUMN "updatedAt";
-- -- Reversing T1 loses the timestamps, which were migration-clock stamps for
-- -- pre-existing rows anyway, but are REAL insert times for any row created
-- -- after T1.
