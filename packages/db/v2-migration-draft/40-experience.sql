-- =====================================================================
-- cluster 40-experience
-- target: the Neon child branch only. NOT production.
-- =====================================================================
--
-- WHAT THIS DOES
--
-- "Experience" stops describing a tenure with three free-text-ish columns
-- ("startDate" TEXT, "endDate" TEXT, "isCurrent" BOOLEAN) and starts
-- describing it with two real dates:
--
--     "startedOn" DATE  NOT NULL   -- always day 01 of the start month
--     "endedOn"   DATE  NULL       -- NULL *is* "current role"
--
-- The three old columns are then dropped. "isCurrent" has no new home and
-- needs none: "endedOn" IS NULL says the same thing and, unlike a separate
-- boolean, cannot contradict the dates (schema-v2.md, "columns that go
-- away").
--
-- The backfill rule, from schema-v2.md:
--
--     "startedOn" = parse("startDate")
--     "endedOn"   = CASE WHEN "isCurrent" THEN NULL
--                        ELSE parse("endDate") END
--
-- The CASE ordering is the whole point. A row can be isCurrent = true AND
-- carry a parseable "endDate" (the public card renders both the end date and
-- the live pill today), so isCurrent must win. It also means the literal
-- string 'Present' is never handed to to_date() -- the only row holding it is
-- the isCurrent row, whose ELSE branch is not evaluated. No parser special
-- case for 'Present' is needed, and none is written here.
--
-- Also in this cluster:
--   * "logoAssetId" TEXT NULL beside the surviving "logoUrl", with a
--     SetNull FK to "MediaAsset" and an at-most-one-of CHECK.
--   * "createdAt" / "updatedAt".
--   * three CHECKs: date ordering, both dates on day 01, logo exclusivity.
--   * the new "Experience_logoAssetId_idx"; and a defensive drop of a
--     sortOrder index (see preflight P8 -- there almost certainly isn't one).
--
-- REAL DATA THIS IS WRITTEN AGAINST (/tmp/v2/data-facts.txt, "Experience
-- date strings"). Two rows, and that is the entire table:
--
--   company='Wiingy' startDate='July 2025'    endDate='Present'   isCurrent=t
--   company='Nykaa'  startDate='January 2025' endDate='July 2025' isCurrent=f
--
-- so the expected outcome is exactly:
--
--   Wiingy  startedOn=2025-07-01  endedOn=NULL
--   Nykaa   startedOn=2025-01-01  endedOn=2025-07-01
--
-- Both logoUrl values are site-relative ('/logos/wiingy.png',
-- '/logos/nykaa.png') and neither matches either of the two "MediaAsset"
-- keys, so "logoAssetId" is NULL on both rows after this runs. Nothing to
-- backfill into it; the at-most-one CHECK is satisfied trivially.
--
-- TRANSACTIONALITY
--
-- Every statement in this file is transactional. There is no CREATE INDEX
-- CONCURRENTLY, no ALTER TYPE ... ADD VALUE, no VACUUM. Run the whole file
-- inside the single BEGIN/COMMIT below. Nothing here requires superuser:
-- no session_replication_role, no DISABLE TRIGGER, no CREATE EXTENSION.
--
-- One caveat for whatever runs this: step 3 contains a dollar-quoted DO
-- block. Feed the file to psql, or to a splitter that understands $$, not to
-- a naive split-on-semicolon.
--
-- Re-running the file after a successful commit is safe but is not a no-op
-- all the way through: it stops at step 2 with
--   ERROR: column "startDate" does not exist
-- which aborts the transaction before any destructive statement, so the
-- database is unchanged. Everything that can cheaply carry IF EXISTS /
-- IF NOT EXISTS does.
--
-- ROLLBACK
--
-- The branch is a copy-on-write clone, so the cheap and correct rollback is
-- to reset or delete the Neon branch and re-clone from production. Use that
-- if anything here surprises you.
--
-- A logical rollback is also available and is lossless *for these two rows*,
-- because both strings are already in the canonical 'FMMonth YYYY' form that
-- to_char reproduces exactly, and because 'Present' is recoverable from
-- "endedOn" IS NULL:
--
--   BEGIN;
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_day01_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_order_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logo_source_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logoAssetId_fkey";
--   DROP INDEX IF EXISTS "Experience_logoAssetId_idx";
--   ALTER TABLE "Experience"
--     ADD COLUMN IF NOT EXISTS "startDate" TEXT,
--     ADD COLUMN IF NOT EXISTS "endDate"   TEXT,
--     ADD COLUMN IF NOT EXISTS "isCurrent" BOOLEAN NOT NULL DEFAULT false;
--   UPDATE "Experience" SET
--     "startDate" = to_char("startedOn", 'FMMonth YYYY'),
--     "endDate"   = COALESCE(to_char("endedOn", 'FMMonth YYYY'), 'Present'),
--     "isCurrent" = ("endedOn" IS NULL);
--   ALTER TABLE "Experience"
--     ALTER COLUMN "startDate" SET NOT NULL,
--     ALTER COLUMN "endDate"   SET NOT NULL;
--   ALTER TABLE "Experience"
--     DROP COLUMN IF EXISTS "startedOn",
--     DROP COLUMN IF EXISTS "endedOn",
--     DROP COLUMN IF EXISTS "logoAssetId",
--     DROP COLUMN IF EXISTS "createdAt",
--     DROP COLUMN IF EXISTS "updatedAt";
--   COMMIT;
--
-- Two caveats on the logical rollback. It reinstates isCurrent = true for
-- any row whose end really was unknown rather than ongoing (there is no such
-- row today). And it cannot resurrect a discarded "endDate" string from an
-- isCurrent row -- see preflight P5, which proves no such string exists.
--
-- CODE HALF (not this file's job, but this cluster breaks it)
--
-- Dropping the three columns breaks every reader in the same deploy. The
-- sites must ship the startedOn/endedOn rewrite together with this
-- migration:
--   apps/web/app/lib/data.ts:199-201
--   apps/web/app/components/landing/Experience.tsx  (the live parser, plus a
--     React key at :268 built from exp.startDate)
--   apps/docs/app/components/preview/experience.tsx
--   apps/docs/app/lib/actions/experiences.ts:35-37, :60-62
--   packages/db/seed.ts:170-172, :210-212
-- Tenure is inclusive (to - from + 1); verification V3 below pins that down
-- so the rewrite cannot quietly shorten every role by a month.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PREFLIGHT. Read these before letting the DDL run. Each says what it
-- must return against the branch as cloned.
-- ---------------------------------------------------------------------

-- P1: the table is the size the facts file says it is.
-- expected: 2
SELECT count(*) AS experience_rows FROM "Experience";

-- P2: the exact rows, so the backfill can be eyeballed against the facts.
-- expected: 2 rows ->
--   Wiingy | July 2025    | Present   | t | /logos/wiingy.png
--   Nykaa  | January 2025 | July 2025 | f | /logos/nykaa.png
SELECT "sortOrder", "company", "startDate", "endDate", "isCurrent", "logoUrl"
FROM "Experience"
ORDER BY "sortOrder";

-- P3: every "startDate" is a parseable 'Month YYYY'. "startedOn" is NOT NULL
-- in the new schema, so a miss here has nowhere to go and must abort.
--
-- The pattern spells the twelve month names out rather than using [a-z]+ on
-- purpose. to_date(..., 'Month YYYY') wants the FULL English name: it accepts
-- 'July' and rejects 'Jul', and a lazy [a-z]+ would wave 'Jul 2025' through
-- to a mid-migration ERROR instead of catching it here.
-- expected: 0
SELECT count(*) AS unparseable_start
FROM "Experience"
WHERE btrim("startDate") !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P4: every "endDate" on a NON-current row is parseable. A miss here would
-- silently become "endedOn" IS NULL, i.e. "this role is current", which is a
-- lie. Must abort.
-- expected: 0
SELECT count(*) AS unparseable_end
FROM "Experience"
WHERE NOT "isCurrent"
  AND btrim("endDate") !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P5: no current row carries a parseable "endDate". This is NOT an abort
-- gate -- isCurrent wins by design -- it is the proof that the CASE discards
-- nothing. If this ever returns rows, those "endDate" strings are being
-- thrown away and belong in the data-loss note.
-- expected: 0 rows
SELECT "id", "company", "endDate"
FROM "Experience"
WHERE "isCurrent"
  AND btrim("endDate") ~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P6: the FK target exists. "MediaAsset" was created by
-- 20260822130000_add_links_rollup_media, so this is already true on the
-- clone and this cluster has no ordering dependency on the media work.
-- expected: t
SELECT to_regclass('"MediaAsset"') IS NOT NULL AS media_asset_present;

-- P7: no existing "logoUrl" will collide with the new exclusivity CHECK,
-- because nothing populates "logoAssetId" here. Both rows keep their
-- string.
-- expected: logo_url_rows = 2
SELECT count(*) FILTER (WHERE "logoUrl" IS NOT NULL) AS logo_url_rows
FROM "Experience";

-- P8: the current index inventory. Neither 20260307195336_init nor any
-- later migration, nor the pre-v2 schema.prisma, declares an index on
-- "Experience", so this should list the primary key alone. The DROP INDEX
-- IF EXISTS in step 8 is insurance against a sortOrder index some earlier
-- `db push` may have left behind.
-- expected: exactly one row -> Experience_pkey
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'Experience'
ORDER BY indexname;

-- P9: nothing references the columns about to be dropped. "ExperienceBullet"
-- and _ExperienceToSkill both point at "Experience"."id", which is untouched.
-- expected: 0 rows
SELECT c.conname, c.conrelid::regclass AS from_table, a.attname AS referenced_column
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.confrelid
 AND a.attnum = ANY (c.confkey)
WHERE c.confrelid = '"Experience"'::regclass
  AND c.contype = 'f'
  AND a.attname IN ('startDate', 'endDate', 'isCurrent');

-- ---------------------------------------------------------------------
-- 1. The new date columns, nullable for now so the backfill has somewhere
--    to land. "startedOn" is tightened to NOT NULL in step 4, after it has
--    been proven full.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  ADD COLUMN IF NOT EXISTS "startedOn" DATE,
  ADD COLUMN IF NOT EXISTS "endedOn"   DATE;

-- ---------------------------------------------------------------------
-- 2. Backfill.
--
--    to_date(..., 'Month YYYY') is case-insensitive, accepts a full English
--    month name of any length, and yields day 01 on its own -- which is
--    exactly the granularity the source strings carry and exactly what the
--    day-01 CHECK in step 9 wants. No day is invented beyond the 01 that the
--    absence of a day in 'July 2025' already implies.
--
--    The ELSE branch is deliberately an unguarded to_date. If P4 was
--    skipped and an unparseable non-current "endDate" exists, this raises
--    and the transaction rolls back. That is the failure mode we want: a
--    regex guard here would convert a bad string into NULL, and NULL means
--    "still working there".
--
--    'Present' never reaches to_date: it lives only on the isCurrent row,
--    whose CASE takes the THEN branch, and Postgres does not evaluate the
--    unused arm of a scalar CASE.
-- ---------------------------------------------------------------------

UPDATE "Experience" SET
  "startedOn" = to_date(btrim("startDate"), 'Month YYYY'),
  "endedOn"   = CASE
                  WHEN "isCurrent" THEN NULL
                  ELSE to_date(btrim("endDate"), 'Month YYYY')
                END;

-- ---------------------------------------------------------------------
-- 3. Prove the backfill resolved every row before the old columns are
--    dropped. Belt (the SELECT, for the operator) and braces (the DO block,
--    which aborts even in an unattended run).
-- ---------------------------------------------------------------------

-- expected: 0
SELECT count(*) AS unresolved_startedOn
FROM "Experience"
WHERE "startedOn" IS NULL;

DO $$
DECLARE
  missing int;
BEGIN
  SELECT count(*) INTO missing FROM "Experience" WHERE "startedOn" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION
      'Experience.startedOn unresolved on % row(s); refusing to drop startDate/endDate/isCurrent',
      missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. "startedOn" is required in the new schema.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience" ALTER COLUMN "startedOn" SET NOT NULL;

-- ---------------------------------------------------------------------
-- 5. The media reference, beside "logoUrl" rather than instead of it.
--    Left NULL on both rows: neither '/logos/wiingy.png' nor
--    '/logos/nykaa.png' matches either "MediaAsset"."key", so there is no
--    honest value to put here. Adoption of those two files into the library
--    is the media cluster's job, and it can set this column later without
--    touching this file.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  ADD COLUMN IF NOT EXISTS "logoAssetId" TEXT;

-- ---------------------------------------------------------------------
-- 6. Timestamps.
--
--    "createdAt" keeps DEFAULT CURRENT_TIMESTAMP, because the new schema
--    says @default(now()) and Prisma will diff against that default.
--
--    "updatedAt" is @updatedAt, which Prisma emits as a bare
--    TIMESTAMP(3) NOT NULL with no default -- the client writes it. So it
--    gets a default only long enough to fill the two existing rows, then
--    the default is dropped. Leaving it on would show up as drift.
--
--    Both rows get the migration's clock. "Experience" has never had a
--    timestamp of any kind, so there is no earlier stamp to derive from.
--    See the data-loss note.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Experience" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------
-- 7. The foreign key. SetNull, not Restrict: deleting a media object must
--    not be blocked by, nor cascade into, a job on the timeline.
--    ON UPDATE CASCADE is Prisma's default for a relation that names only
--    onDelete, so it is spelled out here to keep `migrate diff` quiet.
--
--    Drop-then-add rather than a pg_constraint existence probe: Postgres has
--    no ADD CONSTRAINT IF NOT EXISTS, and on a two-row table the rewrite
--    cost of the idiom is zero.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logoAssetId_fkey";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_logoAssetId_fkey"
  FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- 8. Indexes. The new schema declares exactly one, @@index([logoAssetId]),
--    carried for the SetNull sweep on media delete rather than for any
--    reader. No [sortOrder] index: two rows, seq-scanned either way, and
--    sortOrder is append-only with no reorder UI.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "Experience_logoAssetId_idx"
  ON "Experience" ("logoAssetId");

-- Defensive. P8 should have shown no such index; if a stray `db push` ever
-- created one under either plausible name, it would be drift.
DROP INDEX IF EXISTS "Experience_sortOrder_idx";
DROP INDEX IF EXISTS "Experience_sortOrder_key";

-- ---------------------------------------------------------------------
-- 9. The CHECKs. Prisma cannot express any of these, so they live here and
--    a `db push` will never recreate them -- prefer `migrate deploy`.
--
--    Added VALID immediately, not NOT VALID + VALIDATE. The NOT VALID dance
--    in schema-v2.md is for busy tables; this one has two rows and takes an
--    ACCESS EXCLUSIVE lock for microseconds.
--
--    "Experience_dates_order_check" -- "endedOn" >= "startedOn", NULL-exempt
--      because NULL is the current role, not a missing value.
--    "Experience_dates_day01_check" -- both dates land on day 01. The source
--      data only ever knew month precision; this keeps a future writer from
--      storing a spurious day and making tenure arithmetic lopsided.
--      EXTRACT(DAY FROM date) is immutable, so it is legal in a CHECK.
--    "Experience_logo_source_check" -- at most one logo source. Not
--      exactly-one: a role with no logo at all is legitimate.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_order_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_dates_order_check"
  CHECK ("endedOn" IS NULL OR "endedOn" >= "startedOn");

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_day01_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_dates_day01_check"
  CHECK (
    EXTRACT(DAY FROM "startedOn") = 1
    AND ("endedOn" IS NULL OR EXTRACT(DAY FROM "endedOn") = 1)
  );

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logo_source_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_logo_source_check"
  CHECK ("logoAssetId" IS NULL OR "logoUrl" IS NULL);

-- ---------------------------------------------------------------------
-- 10. Contract. The old columns go.
--
--     "isCurrent" is not migrated anywhere: it is now derivable, exactly,
--     as ("endedOn" IS NULL). The two strings are reconstructible from the
--     dates (see the rollback block), so nothing is destroyed that the new
--     schema cannot re-render.
--
--     On the branch this is safe to do in the same transaction as the
--     backfill -- no traffic, so no expand/contract window is needed. On
--     production it would have to wait for the code half.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  DROP COLUMN IF EXISTS "startDate",
  DROP COLUMN IF EXISTS "endDate",
  DROP COLUMN IF EXISTS "isCurrent";

-- ---------------------------------------------------------------------
-- VERIFICATION. Run these before COMMIT; every one is a read.
-- ---------------------------------------------------------------------

-- V1: the shape of the table.
-- expected: 13 rows, and specifically ->
--   company        | text                        | NO  | (null)
--   createdAt      | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   endedOn        | date                        | YES | (null)
--   id             | text                        | NO  | (null)
--   location       | text                        | NO  | (null)
--   logoAssetId    | text                        | YES | (null)
--   logoUrl        | text                        | YES | (null)
--   position       | text                        | NO  | (null)
--   sortOrder      | integer                     | NO  | (null)
--   startedOn      | date                        | NO  | (null)
--   updatedAt      | timestamp without time zone | NO  | (null)
--   visibleBullets | integer                     | NO  | 4
--   website        | text                        | YES | (null)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'Experience'
ORDER BY column_name;

-- V2: the backfilled values, the whole point of the cluster.
-- expected: 2 rows ->
--   Wiingy | 2025-07-01 | (null)
--   Nykaa  | 2025-01-01 | 2025-07-01
SELECT "sortOrder", "company", "startedOn", "endedOn"
FROM "Experience"
ORDER BY "sortOrder";

-- V3: tenure is INCLUSIVE (to - from + 1). Pinned here because the render
-- rewrite is the easiest place in this migration to lose a month: a plain
-- date subtraction gives Nykaa 6, and the card has always said 7.
-- expected: 2 rows ->
--   Wiingy | (null)  -- open-ended, computed against today at render time
--   Nykaa  | 7
SELECT
  "company",
  CASE WHEN "endedOn" IS NULL THEN NULL
       ELSE (EXTRACT(YEAR FROM "endedOn") * 12 + EXTRACT(MONTH FROM "endedOn"))
          - (EXTRACT(YEAR FROM "startedOn") * 12 + EXTRACT(MONTH FROM "startedOn"))
          + 1
  END AS inclusive_months
FROM "Experience"
ORDER BY "sortOrder";

-- V4: exactly one row is open-ended, and it is the one that was isCurrent.
-- expected: open_ended = 1, closed = 1
SELECT
  count(*) FILTER (WHERE "endedOn" IS NULL)     AS open_ended,
  count(*) FILTER (WHERE "endedOn" IS NOT NULL) AS closed
FROM "Experience";

-- V5: the old columns are gone.
-- expected: 0
SELECT count(*) AS legacy_columns_left
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'Experience'
  AND column_name IN ('startDate', 'endDate', 'isCurrent');

-- V6: constraint inventory.
-- expected: exactly 5 rows, these names in this order ->
--   Experience_dates_day01_check
--   Experience_dates_order_check
--   Experience_logoAssetId_fkey   | FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"(id) ON UPDATE CASCADE ON DELETE SET NULL
--   Experience_logo_source_check  | CHECK ((("logoAssetId" IS NULL) OR ("logoUrl" IS NULL)))
--   Experience_pkey               | PRIMARY KEY (id)
-- The two date CHECK bodies come back re-spelled by Postgres's own
-- normalisation (on PG17, EXTRACT renders with a numeric literal cast), so
-- match on the names and the semantics, not on the exact string. All three
-- CHECKs must report convalidated = t.
SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
FROM pg_constraint
WHERE conrelid = '"Experience"'::regclass
ORDER BY conname;

-- V7: index inventory matches @@index([logoAssetId]) and nothing else.
-- expected: exactly 2 rows -> Experience_logoAssetId_idx, Experience_pkey
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'Experience'
ORDER BY indexname;

-- V8: "updatedAt" carries no default, so `prisma migrate diff` stays empty.
-- expected: 1 row -> updatedAt | (null)
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'Experience'
  AND column_name = 'updatedAt';

-- V9: the CHECKs actually bite. Both of these must ERROR; run them in a
-- throwaway SAVEPOINT, outside the migration transaction, or skip them.
--   SAVEPOINT chk;
--     UPDATE "Experience" SET "endedOn" = "startedOn" - 1;          -- expect: violates Experience_dates_order_check
--   ROLLBACK TO SAVEPOINT chk;
--   SAVEPOINT chk;
--     UPDATE "Experience" SET "startedOn" = "startedOn" + 5;        -- expect: violates Experience_dates_day01_check
--   ROLLBACK TO SAVEPOINT chk;
--   SAVEPOINT chk;
--     UPDATE "Experience" SET "logoAssetId" = (SELECT "id" FROM "MediaAsset" LIMIT 1);
--                                                                  -- expect: violates Experience_logo_source_check
--   ROLLBACK TO SAVEPOINT chk;

-- V10: the child rows survived untouched (nothing here cascades, but cheap
-- to prove).
-- expected: 8
SELECT count(*) AS bullets FROM "ExperienceBullet";

COMMIT;
