-- =============================================================================
-- cluster 45-about-education-quotes
-- target: the Neon child branch (copy-on-write clone of production, no traffic)
-- Postgres 17, role is database owner and NOT superuser.
-- =============================================================================
--
-- WHAT THIS CLUSTER DOES
--
--   1. Education.startYear  TEXT NOT NULL -> INTEGER NOT NULL   (in-place retype)
--      Education.endYear    TEXT NOT NULL -> INTEGER NULL       (in-place retype
--                                                                + DROP NOT NULL)
--      plus the three year CHECKs from the schema-v2.md inventory:
--        both years BETWEEN 1950 AND 2200, and endYear >= startYear.
--      The whole table is ONE row today: startYear = '2021', endYear = '2025'
--      (/tmp/v2/data-facts.txt, "Education year strings"). Both parse, both sit
--      inside the range, and 2025 >= 2021, so every CHECK can be added VALID
--      immediately rather than NOT VALID + VALIDATE: this is not a busy table.
--      Education keeps its column NAMES, so this is a retype and not the
--      rename-based expand/contract that Experience uses. NULL endYear is the
--      new encoding for "still enrolled"; no row uses it yet.
--
--   2. createdAt / updatedAt on AboutParagraph, Education and ContactPurpose.
--      House pattern from 20260822110000_add_inbox_workflow: ADD COLUMN NOT NULL
--      DEFAULT CURRENT_TIMESTAMP, then DROP DEFAULT on the columns the new schema
--      does not declare a default for.
--        createdAt            -> @default(now())            -> DEFAULT KEPT
--        updatedAt            -> @updatedAt                 -> DEFAULT DROPPED
--        ContactPurpose.updatedAt -> @default(now()) @updatedAt -> DEFAULT KEPT
--      That last one is deliberate and is the one column in this cluster that
--      must NOT get a DROP DEFAULT: it matches ContactMessage.updatedAt, which
--      has carried DEFAULT CURRENT_TIMESTAMP since 20260822110000.
--
--   3. Quote gains sortOrder INTEGER NOT NULL (no default, matching the new
--      schema) backfilled with row_number() OVER (ORDER BY "id") - 1, plus
--      createdAt / updatedAt. 28 rows. Both readers order by id asc today
--      (apps/web/app/lib/data.ts:362 and apps/docs .../quotes/page.tsx:21), so
--      seeding sortOrder from that exact sequence means no quote moves on
--      migration day when the readers switch to [{sortOrder},{id}].
--      Zero-based because that is what the admin already assumes: reorderRows
--      uses ids.entries() and maxSortOrder returns -1 for an empty table
--      (apps/docs/app/lib/actions/staging.ts:439, :763).
--
-- DELIBERATELY NOT DONE HERE (all three reverse an earlier draft; schema-v2.md
-- and the new schema.prisma are the authority):
--   * NO Quote.active column. Nothing in the codebase can write it.
--   * NO index on Quote. The new schema declares none; adding one is drift.
--   * NO UNIQUE on ContactPurpose.label. Prisma's immediate unique constraint
--     breaks two legitimate staged edits (replacing a purpose, swapping two
--     labels) and rolls back the whole batch. The check lives in preflight
--     instead. A verification query below asserts the absence.
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional. Run the whole file inside a
--   single BEGIN / COMMIT. There is no CREATE INDEX CONCURRENTLY, no ALTER TYPE
--   ... ADD VALUE, no VACUUM. The two ALTER COLUMN ... TYPE statements take an
--   ACCESS EXCLUSIVE lock and rewrite the table; on a one-row table that is
--   instantaneous.
--
-- IDEMPOTENCY
--   The nine ADD COLUMNs use IF NOT EXISTS, the backfills are guarded on IS NULL,
--   the CHECKs are guarded on pg_constraint, and the two retypes are guarded on
--   the column's current data_type. Re-running the file is a no-op. The retype
--   guard is load-bearing: btrim() on an already-integer column raises
--   "function btrim(integer) does not exist", so an unguarded second run aborts.
--
-- ROLLBACK
--   ROLLBACK the transaction if it has not committed. After commit:
--
--     ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_year_order_check";
--     ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_endYear_check";
--     ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_startYear_check";
--     ALTER TABLE "Education" ALTER COLUMN "startYear" TYPE TEXT USING "startYear"::text;
--     ALTER TABLE "Education" ALTER COLUMN "endYear"   TYPE TEXT USING "endYear"::text;
--     UPDATE "Education" SET "endYear" = 'Present' WHERE "endYear" IS NULL;
--     ALTER TABLE "Education" ALTER COLUMN "endYear" SET NOT NULL;
--     ALTER TABLE "Quote"          DROP COLUMN IF EXISTS "sortOrder";
--     ALTER TABLE "AboutParagraph" DROP COLUMN IF EXISTS "createdAt", DROP COLUMN IF EXISTS "updatedAt";
--     ALTER TABLE "Education"      DROP COLUMN IF EXISTS "createdAt", DROP COLUMN IF EXISTS "updatedAt";
--     ALTER TABLE "ContactPurpose" DROP COLUMN IF EXISTS "createdAt", DROP COLUMN IF EXISTS "updatedAt";
--     ALTER TABLE "Quote"          DROP COLUMN IF EXISTS "createdAt", DROP COLUMN IF EXISTS "updatedAt";
--
--   The year round-trip is exact for today's data, because '2021' and '2025' are
--   unpadded four-digit strings that survive TEXT -> INTEGER -> TEXT unchanged.
--   It is NOT exact in general: the rollback has to invent a string for a NULL
--   endYear, and 'Present' is a guess. There are no NULL endYears today, so the
--   UPDATE above is a no-op against the current data.
--   The dropped columns are unrecoverable by DDL; createdAt/updatedAt held no
--   information that existed before this cluster ran, and Quote.sortOrder is
--   reproducible at any time from row_number() over id order until the first
--   operator reorder.
--
-- =============================================================================


-- =============================================================================
-- PREFLIGHT. Every one of these must return the stated result BEFORE any DDL.
-- Run them all, read them all, then run the DDL. They open no locks.
-- =============================================================================

-- P1. Row counts, for the record. Nothing here is destructive, but every count
--     below is re-asserted in verification, so a surprise now is worth stopping
--     for.
--     EXPECTED: Education 1, ContactPurpose 5, Quote 28.
--     AboutParagraph is expected to be 2 per schema-v2.md; /tmp/v2/data-facts.txt
--     does NOT carry an AboutParagraph count, so that one number is unverified
--     and is reported rather than asserted.
SELECT
  (SELECT count(*) FROM "AboutParagraph") AS "aboutParagraphs",
  (SELECT count(*) FROM "Education")      AS "educationRows",
  (SELECT count(*) FROM "ContactPurpose") AS "contactPurposes",
  (SELECT count(*) FROM "Quote")          AS "quotes";

-- P2. ABORT RULE on startYear: it must be exactly four digits. schema-v2.md is
--     explicit that a non-four-digit startYear aborts the migration rather than
--     being coerced, because there is no honest fallback for it.
--     EXPECTED: 0 rows.
SELECT "id", "institution", "startYear"
FROM "Education"
WHERE btrim("startYear") !~ '^[0-9]{4}$';

-- P3. endYear inventory. The rule is: four digits become the integer, a
--     recognised open-ended marker becomes NULL, and anything else aborts. This
--     query is both the abort gate for "anything else" AND the required
--     "print every id it nulled" report, because after an in-place retype the
--     original strings no longer exist to be reported on.
--     EXPECTED: 0 rows. Today's single row holds '2025'.
SELECT "id", "institution", "endYear",
       CASE WHEN lower(btrim("endYear")) IN ('present', 'ongoing', 'current', '')
            THEN 'would become NULL'
            ELSE 'UNRECOGNISED - ABORT' END AS "disposition"
FROM "Education"
WHERE btrim("endYear") !~ '^[0-9]{4}$';

-- P4. The CHECKs must hold BEFORE they are added, or the ADD CONSTRAINT aborts.
--     Range check on both years.
--     EXPECTED: 0 rows.
SELECT "id", "startYear", "endYear"
FROM "Education"
WHERE btrim("startYear")::integer NOT BETWEEN 1950 AND 2200
   OR (btrim("endYear") ~ '^[0-9]{4}$' AND btrim("endYear")::integer NOT BETWEEN 1950 AND 2200);

-- P5. Ordering check on the year pair.
--     EXPECTED: 0 rows.
SELECT "id", "startYear", "endYear"
FROM "Education"
WHERE btrim("endYear") ~ '^[0-9]{4}$'
  AND btrim("endYear")::integer < btrim("startYear")::integer;

-- P6. The nine columns this cluster adds must not already exist. If a sibling
--     cluster already added the timestamps, the ADD COLUMN IF NOT EXISTS calls
--     below are harmless no-ops, but the DROP DEFAULT statements would then be
--     re-applied to columns another cluster owns. Worth knowing which.
--     EXPECTED: 0 rows on a first run.
SELECT "table_name", "column_name", "data_type"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND ("table_name", "column_name") IN (
    ('AboutParagraph', 'createdAt'), ('AboutParagraph', 'updatedAt'),
    ('Education',      'createdAt'), ('Education',      'updatedAt'),
    ('ContactPurpose', 'createdAt'), ('ContactPurpose', 'updatedAt'),
    ('Quote',          'createdAt'), ('Quote',          'updatedAt'),
    ('Quote',          'sortOrder')
  )
ORDER BY "table_name", "column_name";

-- P7. Education's two year columns must still be TEXT, i.e. this cluster has
--     not already run and no sibling cluster has retyped them.
--     EXPECTED: exactly 2 rows, both data_type 'text', endYear is_nullable 'NO'.
SELECT "column_name", "data_type", "is_nullable"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'Education'
  AND "column_name" IN ('startYear', 'endYear')
ORDER BY "column_name";

-- P8. ContactPurpose.label duplicates. This cluster deliberately does NOT add a
--     UNIQUE constraint, so this is not a gate on the DDL. It is recorded here
--     because schema-v2.md moves the uniqueness check out of the database and
--     into preflight, which makes this query the load-bearing one rather than
--     defence in depth. The five labels today are Freelance, Job Opportunity,
--     Collaboration, Consultation, Just Saying Hi.
--     EXPECTED: 0 rows.
SELECT lower(btrim("label")) AS "normalisedLabel", count(*) AS "n"
FROM "ContactPurpose"
GROUP BY 1
HAVING count(*) > 1;

-- P9. Quote ids must be non-null and distinct or the row_number() backfill is
--     not a stable sequence. The primary key already guarantees this; asserted
--     because the backfill's correctness rests on it.
--     EXPECTED: 28, 28, 0.
SELECT count(*) AS "rows",
       count(DISTINCT "id") AS "distinctIds",
       count(*) FILTER (WHERE "id" IS NULL) AS "nullIds"
FROM "Quote";


-- =============================================================================
-- DDL / DML. Dependency order: Education retype first (it is the only statement
-- that can fail on data), then the timestamp columns, then Quote.sortOrder.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Education: free-text years become integers.
-- -----------------------------------------------------------------------------

-- DROP NOT NULL comes before the retype so that the endYear USING expression is
-- free to produce NULL for an open-ended degree. schema-v2.md calls out that
-- this DROP NOT NULL has to be in the same transaction as the retype; it is.
ALTER TABLE "Education" ALTER COLUMN "endYear" DROP NOT NULL;

-- Guarded on data_type so a second run is a no-op instead of an error: btrim()
-- has no integer overload, so an unguarded re-run would abort the transaction.
DO $$
BEGIN
  IF (
    SELECT "data_type"
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'Education'
      AND "column_name" = 'startYear'
  ) = 'text' THEN
    ALTER TABLE "Education"
      ALTER COLUMN "startYear" TYPE INTEGER USING btrim("startYear")::integer;
  END IF;

  IF (
    SELECT "data_type"
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'Education'
      AND "column_name" = 'endYear'
  ) = 'text' THEN
    -- A four-digit string becomes the integer. A recognised open-ended marker
    -- becomes NULL, which is the new "still enrolled" encoding. Preflight P3
    -- has already proven no row takes the second branch today, and has already
    -- printed any id that would, so the ELSE arm is a guard rather than a
    -- silent coercion.
    ALTER TABLE "Education"
      ALTER COLUMN "endYear" TYPE INTEGER
      USING CASE
              WHEN btrim("endYear") ~ '^[0-9]{4}$' THEN btrim("endYear")::integer
              ELSE NULL
            END;
  END IF;
END
$$;

-- The three year CHECKs. Prisma cannot model a CHECK, so these live only here
-- and a `db push` will never recreate them. Named Table_column_check, matching
-- the house style set by HeroTitle_version_check / GithubYear_days_check.
-- Added VALID, not NOT VALID: one row, already proven conforming by P4 and P5.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"Education"'::regclass AND "conname" = 'Education_startYear_check'
  ) THEN
    ALTER TABLE "Education"
      ADD CONSTRAINT "Education_startYear_check" CHECK ("startYear" BETWEEN 1950 AND 2200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"Education"'::regclass AND "conname" = 'Education_endYear_check'
  ) THEN
    -- IS NULL spelled out rather than leaning on three-valued logic, so the
    -- constraint reads as the intent: NULL means still enrolled and is allowed.
    ALTER TABLE "Education"
      ADD CONSTRAINT "Education_endYear_check"
      CHECK ("endYear" IS NULL OR "endYear" BETWEEN 1950 AND 2200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"Education"'::regclass AND "conname" = 'Education_year_order_check'
  ) THEN
    -- The one that actually earns its keep: both inputs were free text with no
    -- min or max, so endYear = 99999 on a 2021 start passed the old world and
    -- rendered. The range check alone would not catch a reversed pair.
    ALTER TABLE "Education"
      ADD CONSTRAINT "Education_year_order_check"
      CHECK ("endYear" IS NULL OR "endYear" >= "startYear");
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Timestamps on AboutParagraph, Education, ContactPurpose, Quote.
--    Neither table has any date column today, so CURRENT_TIMESTAMP is the only
--    available stamp. It is a migration-time stamp, not a real creation time;
--    see the data-loss note at the end of this file.
-- -----------------------------------------------------------------------------

ALTER TABLE "AboutParagraph"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Education"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ContactPurpose"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- createdAt keeps DEFAULT CURRENT_TIMESTAMP everywhere: the new schema declares
-- @default(now()) on all four. Only updatedAt loses its default, and only on
-- three of the four tables.
ALTER TABLE "AboutParagraph" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Education"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Quote"          ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ContactPurpose.updatedAt is the exception and MUST NOT get a DROP DEFAULT.
-- The new schema declares @default(now()) @updatedAt on it, deliberately, to
-- match ContactMessage.updatedAt which has carried DEFAULT CURRENT_TIMESTAMP
-- since 20260822110000_add_inbox_workflow. Emitting DROP DEFAULT here is the
-- single easiest way to make `prisma migrate diff` come back non-empty for this
-- cluster. It is left alone on purpose. Do not "tidy" this.

-- -----------------------------------------------------------------------------
-- 3. Quote.sortOrder.
-- -----------------------------------------------------------------------------

-- Added nullable first: the new schema gives sortOrder no default, and 28 rows
-- already exist, so NOT NULL cannot be declared until the backfill has run.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER;

-- row_number() over the CURRENT id order, minus one. Both readers order by id
-- asc today, so the sequence this writes is exactly the order the site and the
-- admin are already showing: nothing moves on migration day.
--
-- Two things about ORDER BY "id" that matter:
--   * No COLLATE clause, on purpose. "id" is TEXT holding a uuid, and Prisma's
--     `orderBy: { id: "asc" }` sorts under the column's own collation. Forcing
--     COLLATE "C" here would sort by raw bytes instead and could disagree with
--     the live order for hyphenated uuids, which is the exact thing this
--     backfill exists to avoid.
--   * Zero-based, because the admin is: reorderRows writes ids.entries()
--     indexes and maxSortOrder returns -1 for an empty table, so the first row
--     any other staged list ever gets is 0.
--
-- Guarded on IS NULL so a re-run cannot renumber quotes an operator has since
-- reordered.
UPDATE "Quote" AS "q"
SET "sortOrder" = "r"."rn"
FROM (
  SELECT "id", (row_number() OVER (ORDER BY "id"))::integer - 1 AS "rn"
  FROM "Quote"
) AS "r"
WHERE "q"."id" = "r"."id"
  AND "q"."sortOrder" IS NULL;

ALTER TABLE "Quote" ALTER COLUMN "sortOrder" SET NOT NULL;

-- No index on Quote and no DEFAULT on sortOrder. The new schema declares
-- neither. sortOrder being required with no default is the coupling in this
-- cluster: `quote` is excluded from the sortable-entity machinery in
-- apps/docs/app/lib/actions/staging.ts, so its create branch writes no
-- sortOrder at all and would fail against this column. The code half has to
-- land with it.


-- =============================================================================
-- VERIFICATION. Run after COMMIT.
-- =============================================================================

-- V1. Every column this cluster touches, with its type, nullability and default.
--     EXPECTED: exactly these 11 rows, in this order.
--       AboutParagraph createdAt  | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       AboutParagraph updatedAt  | timestamp without time zone | NO  | (null)
--       ContactPurpose createdAt  | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       ContactPurpose updatedAt  | timestamp without time zone | NO  | CURRENT_TIMESTAMP   <-- kept
--       Education      createdAt  | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       Education      endYear    | integer                     | YES | (null)
--       Education      startYear  | integer                     | NO  | (null)
--       Education      updatedAt  | timestamp without time zone | NO  | (null)
--       Quote          createdAt  | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       Quote          sortOrder  | integer                     | NO  | (null)
--       Quote          updatedAt  | timestamp without time zone | NO  | (null)
--     datetime_precision must be 3 on every timestamp row: Prisma maps DateTime
--     to timestamp(3), and a precision of 6 is drift even though the type name
--     looks right.
--     What is being asserted about column_default is present vs absent, not its
--     exact spelling; Postgres may render the coerced expression with a cast.
--     Compare against Skill.createdAt, which has carried the same default since
--     20260307195336_init.
SELECT "table_name", "column_name", "data_type", "datetime_precision",
       "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND ("table_name", "column_name") IN (
    ('AboutParagraph', 'createdAt'), ('AboutParagraph', 'updatedAt'),
    ('Education',      'createdAt'), ('Education',      'updatedAt'),
    ('Education',      'startYear'), ('Education',      'endYear'),
    ('ContactPurpose', 'createdAt'), ('ContactPurpose', 'updatedAt'),
    ('Quote',          'createdAt'), ('Quote',          'updatedAt'),
    ('Quote',          'sortOrder')
  )
ORDER BY "table_name", "column_name";

-- V2. The one Education row survived the retype with its real values.
--     EXPECTED: 1 row, startYear 2021, endYear 2025, nulledEndYears 0.
SELECT "id", "institution", "startYear", "endYear",
       (SELECT count(*) FROM "Education" WHERE "endYear" IS NULL) AS "nulledEndYears"
FROM "Education";

-- V3. The three Education CHECKs exist, are VALID, and read as intended.
--     EXPECTED: 3 rows, all convalidated = true.
--       Education_endYear_check      | CHECK ((("endYear" IS NULL) OR (("endYear" >= 1950) AND ("endYear" <= 2200))))
--       Education_startYear_check    | CHECK ((("startYear" >= 1950) AND ("startYear" <= 2200)))
--       Education_year_order_check   | CHECK ((("endYear" IS NULL) OR ("endYear" >= "startYear")))
SELECT "conname", "convalidated", pg_get_constraintdef("oid") AS "definition"
FROM "pg_constraint"
WHERE "conrelid" = '"Education"'::regclass AND "contype" = 'c'
ORDER BY "conname";

-- V4. Quote.sortOrder is a dense zero-based sequence over all 28 rows.
--     EXPECTED: 28, 0, 27, 28, 0.
SELECT count(*) AS "rows",
       min("sortOrder") AS "minSort",
       max("sortOrder") AS "maxSort",
       count(DISTINCT "sortOrder") AS "distinctSort",
       count(*) FILTER (WHERE "sortOrder" IS NULL) AS "nullSort"
FROM "Quote";

-- V5. The sequence agrees with the pre-migration id order, quote by quote. This
--     is the actual promise of this cluster: no quote moves on migration day.
--     EXPECTED: 0.
SELECT count(*) AS "misordered"
FROM (
  SELECT "sortOrder", (row_number() OVER (ORDER BY "id"))::integer - 1 AS "expected"
  FROM "Quote"
) AS "t"
WHERE "sortOrder" <> "expected";

-- V6. Quote gained no index and no 'active' column. Both were in an earlier
--     draft and both are rejected; either one present is drift against the new
--     schema.
--     EXPECTED: 0 rows.
SELECT 'stray index' AS "finding", "i"."relname"::text AS "name"
FROM "pg_index" AS "x"
JOIN "pg_class" AS "i" ON "i"."oid" = "x"."indexrelid"
WHERE "x"."indrelid" = '"Quote"'::regclass
  AND "i"."relname" <> 'Quote_pkey'
UNION ALL
SELECT 'stray column' AS "finding", "column_name"::text AS "name"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'Quote'
  AND "column_name" = 'active';

-- V7. ContactPurpose.label did NOT become unique, and no unique index other
--     than the primary key exists on the table.
--     EXPECTED: 0 rows.
SELECT "i"."relname" AS "unexpectedUniqueIndex"
FROM "pg_index" AS "x"
JOIN "pg_class" AS "i" ON "i"."oid" = "x"."indexrelid"
WHERE "x"."indrelid" = '"ContactPurpose"'::regclass
  AND "x"."indisunique"
  AND "i"."relname" <> 'ContactPurpose_pkey';

-- V8. Nothing else grew an index or constraint. The four tables in this cluster
--     should carry exactly their four primary keys plus the three new Education
--     CHECKs, and nothing more. contype is filtered to p/c/u/f because Postgres
--     18 catalogues NOT NULL constraints as contype 'n' and Postgres 17 does
--     not; the filter makes the expected row count the same on both.
--     EXPECTED: 7 rows.
--       AboutParagraph | AboutParagraph_pkey        | p
--       ContactPurpose | ContactPurpose_pkey        | p
--       Education      | Education_endYear_check    | c
--       Education      | Education_pkey             | p
--       Education      | Education_startYear_check  | c
--       Education      | Education_year_order_check | c
--       Quote          | Quote_pkey                 | p
SELECT "c"."relname" AS "table", "n"."conname", "n"."contype"
FROM "pg_constraint" AS "n"
JOIN "pg_class" AS "c" ON "c"."oid" = "n"."conrelid"
WHERE "n"."conrelid" IN (
  '"AboutParagraph"'::regclass, '"Education"'::regclass,
  '"ContactPurpose"'::regclass, '"Quote"'::regclass
)
  AND "n"."contype" IN ('p', 'c', 'u', 'f')
ORDER BY "c"."relname", "n"."conname";

-- V9. Row counts unchanged. No statement in this cluster inserts or deletes.
--     EXPECTED: identical to preflight P1 (Education 1, ContactPurpose 5,
--     Quote 28, AboutParagraph whatever P1 reported).
SELECT
  (SELECT count(*) FROM "AboutParagraph") AS "aboutParagraphs",
  (SELECT count(*) FROM "Education")      AS "educationRows",
  (SELECT count(*) FROM "ContactPurpose") AS "contactPurposes",
  (SELECT count(*) FROM "Quote")          AS "quotes";


-- =============================================================================
-- DATA LOSS LEDGER
--
--   1. Education.startYear / endYear lose their TEXT representation. For the one
--      row that exists, '2021' and '2025', nothing is lost: the integers 2021
--      and 2025 reproduce those strings exactly. In general a TEXT year could
--      carry padding, a range, or a word, and that spelling has nowhere to live
--      in the new schema. Preflight P2 aborts on a startYear that is not four
--      digits and P3 prints every endYear that would be nulled, so the loss can
--      never be silent.
--
--   2. Education.endYear loses its NOT NULL guarantee. That is the point of the
--      change (NULL means still enrolled) but it is a one-way door: any code
--      still rendering {startYear} — {endYear} with no null branch will print a
--      dangling em dash the moment someone saves a row with no end year. The
--      renders and the admin form have to move in the same deploy. No data is
--      destroyed.
--
--   3. createdAt is not a real creation time. These four tables never recorded
--      one, so every row gets the migration's CURRENT_TIMESTAMP. That fabricates
--      a value rather than destroying one, and the new schema has no reader for
--      these stamps (stale detection is extended to Project, not here), but any
--      future "oldest paragraph" query will be wrong about history and there is
--      no source anywhere to repair it from.
--
--   4. Quote.sortOrder is derived, not recovered. There was never an operator
--      intent to preserve; the sequence is id order frozen into a column. That
--      is a deliberate upgrade from uuid order to an operator-visible one, and
--      it does NOT stabilise which quote shows on a given day: the landing page
--      indexes with `dayOfYear % quotes.length`, so adding a 29th quote
--      reshuffles every day regardless of sort order.
-- =============================================================================
