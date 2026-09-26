-- ============================================================================
-- Cluster 65-audit
-- Branch migration for the v2 schema. Runs against the Neon child branch only.
-- ============================================================================
--
-- WHAT THIS DOES
--
-- The enum pass over the two audit tables. No row is rewritten, no column is
-- added or dropped, no value moves table. Five columns stop being TEXT:
--
--   "AuditEvent"."action"        -> "AuditAction"      (new type) NOT NULL, no default
--   "AuditEvent"."surface"       -> "AuditSurface"     (new type) NOT NULL, no default
--   "AuditEvent"."publishState"  -> "PublishState"     (new type) NOT NULL, DEFAULT 'NONE'
--   "AuditEvent"."actorRole"     -> "AdminRole"        (ALREADY EXISTS) NOT NULL, no default
--   "AuditChange"."kind"         -> "AuditChangeKind"  (new type) NOT NULL, no default
--
-- Four types are CREATEd here. The fifth, "AdminRole", was created by
-- 20260308072119_add_admin_user and already types "AdminUser"."role"; this
-- cluster only points a second column at it. That is why P6 below asserts the
-- type's label set rather than creating it: production carries a SUB_ADMIN label
-- that exists in no migration file (schema-v2.md, AdminUser), so the branch's
-- copy of "AdminRole" is the authority, not the migration history.
--
-- THREE CHECK CONSTRAINTS ARE RETIRED, and exactly three exist. All three came
-- from 20260728150000_add_audit_log:
--
--   "AuditEvent_action_check"        CHECK ("action" IN ('SAVE','SAVE_AND_PUBLISH','PUBLISH'))
--   "AuditEvent_publishState_check"  CHECK ("publishState" IN ('NONE','OK','FAILED'))
--   "AuditChange_kind_check"         CHECK ("kind" IN ('CREATE','UPDATE','DELETE','REORDER'))
--
-- "surface" and "actorRole" NEVER HAD A CHECK. Nothing in any migration
-- constrains either column, which is the whole reason every cast below is
-- preceded by a value assertion and not just the two the original plan asked
-- for: for three of the five columns the database already guaranteed the cast,
-- and for the other two only the dump can. Per /tmp/v2/data-facts.txt the actual
-- stored sets are:
--
--   "action"       ['PUBLISH','SAVE','SAVE_AND_PUBLISH']   all three inside the enum
--   "surface"      ['publish','script','staging']          all three inside the enum
--   "publishState" ['NONE','OK']                           'FAILED' unused but legal
--   "actorRole"    ['OWNER']                               one label, one actor
--   "kind"         ['UPDATE']                              one label; three unused
--
-- "AuditSurface" IS @map'd AND THAT IS THE POINT. Its Postgres labels are the
-- lowercase strings 'staging'/'publish'/'script' the three writers already store
-- (apps/docs/app/lib/actions/staging.ts:55 writes 'staging',
-- apps/docs/app/lib/audit-writer.ts:66 writes 'publish',
-- apps/docs/scripts/update-about-copy.ts:31 writes 'script'), so the cast is a
-- pure relabelling with no USING CASE. SCRIPT is a real member, not a
-- precaution: that script is a wired command and a two-member enum would fail
-- this cast on live rows. Raw SQL and \d output keep showing the lowercase
-- label; only the generated client sees STAGING/PUBLISH/SCRIPT. See
-- open_problems — the three call sites must be updated in the same deploy.
--
-- ONE INDEX IS DROPPED: "AuditChange_entity_rowId_idx", from the same 2026-07-28
-- migration. It is not in the v2 schema, so leaving it behind is drift. No data
-- is lost; a capability is. It is the only index that could answer "show me
-- everything that ever happened to this row", and no query asks that today.
-- Re-adding it is one CREATE INDEX.
--
-- ENUM LABEL ORDER IS DECLARATION ORDER, not alphabetical, so ORDER BY on these
-- five columns changes meaning: 'PUBLISH' used to sort first among the actions
-- and now sorts last. Verified harmless — the only orderBy anywhere near these
-- tables is "AuditChange".seq (apps/docs/app/lib/actions/history.ts:20) and
-- "AuditEvent".createdAt. Recorded so the next person does not have to re-check.
--
-- DATA. Nothing is rewritten, nothing is coerced, no NULL is invented: all five
-- columns are NOT NULL today and stay NOT NULL. Every existing string is already
-- byte-identical to an enum label. The row counts of "AuditEvent" and
-- "AuditChange" are not stated in data-facts.txt, so P8 snapshots them into a
-- temp table instead of this file hard-coding a number it cannot know.
--
-- TRANSACTIONALITY. Every statement is transactional and the whole file is meant
-- to run inside ONE transaction (BEGIN; \i this file; COMMIT;). Nothing here is
-- non-transactional: no CREATE INDEX CONCURRENTLY, no VACUUM, no ALTER TYPE ...
-- ADD VALUE. The "you cannot use a newly added enum label in the same
-- transaction" rule does not bite, because the four new types are CREATEd whole
-- in this transaction (labels usable immediately) and "AdminRole" is untouched.
-- The one case that WOULD need two transactions is if P6 fails, i.e. some
-- "actorRole" value is not an "AdminRole" label: fixing that needs ALTER TYPE
-- "AdminRole" ADD VALUE, and the new label cannot be used by a USING cast in the
-- same transaction. Do not paper over it here — see open_problems.
-- Each ALTER COLUMN TYPE takes ACCESS EXCLUSIVE and rewrites the table and its
-- indexes. Both tables are small (single-digit events, single-digit changes per
-- the entity census), so this is instantaneous. Owner-level DDL only: no
-- session_replication_role, no DISABLE TRIGGER ALL, no CREATE EXTENSION.
--
-- NOT IN THIS CLUSTER. Neither foreign key is touched:
-- "AuditEvent_actorId_fkey" (SET NULL / CASCADE) and "AuditChange_eventId_fkey"
-- (CASCADE / CASCADE) already match the v2 schema exactly, and V7 asserts they
-- came through the two table rewrites unchanged. The four surviving indexes and
-- both primary keys are likewise rebuilt in place by Postgres and keep their
-- names. No column is added or dropped: the v2 column list for both tables is
-- identical to the old one in data-facts.txt.
--
-- ROLLBACK. If the transaction is still open, ROLLBACK. After COMMIT, this
-- reverses it exactly (run in one transaction, in this order):
--
--   ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" DROP DEFAULT;
--   ALTER TABLE "AuditEvent" ALTER COLUMN "action"       TYPE TEXT USING "action"::text;
--   ALTER TABLE "AuditEvent" ALTER COLUMN "surface"      TYPE TEXT USING "surface"::text;
--   ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" TYPE TEXT USING "publishState"::text;
--   ALTER TABLE "AuditEvent" ALTER COLUMN "actorRole"    TYPE TEXT USING "actorRole"::text;
--   ALTER TABLE "AuditChange" ALTER COLUMN "kind"        TYPE TEXT USING "kind"::text;
--   ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" SET DEFAULT 'NONE';
--   ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_action_check"
--     CHECK ("action" IN ('SAVE','SAVE_AND_PUBLISH','PUBLISH'));
--   ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_publishState_check"
--     CHECK ("publishState" IN ('NONE','OK','FAILED'));
--   ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_kind_check"
--     CHECK ("kind" IN ('CREATE','UPDATE','DELETE','REORDER'));
--   CREATE INDEX "AuditChange_entity_rowId_idx" ON "AuditChange"("entity", "rowId");
--   DROP TYPE "AuditAction";
--   DROP TYPE "AuditSurface";
--   DROP TYPE "PublishState";
--   DROP TYPE "AuditChangeKind";
--
-- DO NOT DROP "AdminRole" on rollback: it predates this cluster and still types
-- "AdminUser"."role". The four DROP TYPEs must come last and will fail while any
-- column still references them, which is the safety net. Rolling back loses no
-- data at all — text and enum label are the same string — so this reversal is
-- exact, not approximate.
--
-- ============================================================================


-- ============================================================================
-- PREFLIGHT
-- Read these before letting the DDL run. Every one is a plain SELECT (plus one
-- temp-table snapshot) and changes no user data. Every column reference is
-- written "col"::text so each assertion is still runnable verbatim after the
-- retype, which is what makes P1 and V3 comparable.
-- ============================================================================

-- P1. THE VALUE ASSERTION. One row per stored value that the target enum cannot
--     represent, across all five columns. This is the assertion the plan asks
--     for on "surface", widened to all five because only three of the five have
--     a CHECK backing them today.
--     EXPECTED: 0 rows. A row here means the matching USING cast below would
--     abort the transaction with 22P02 — and the value is information. Find out
--     which writer produced it; do not CASE it away.
SELECT 'AuditEvent.action' AS "column", "id", "action"::text AS "value"
  FROM "AuditEvent"
 WHERE "action"::text NOT IN ('SAVE', 'SAVE_AND_PUBLISH', 'PUBLISH')
UNION ALL
SELECT 'AuditEvent.surface', "id", "surface"::text
  FROM "AuditEvent"
 WHERE "surface"::text NOT IN ('staging', 'publish', 'script')
UNION ALL
SELECT 'AuditEvent.publishState', "id", "publishState"::text
  FROM "AuditEvent"
 WHERE "publishState"::text NOT IN ('NONE', 'OK', 'FAILED')
UNION ALL
SELECT 'AuditEvent.actorRole', "id", "actorRole"::text
  FROM "AuditEvent"
 WHERE "actorRole"::text NOT IN (
         SELECT e."enumlabel"::text
           FROM pg_type t
           JOIN pg_enum e ON e."enumtypid" = t."oid"
           JOIN pg_namespace n ON n."oid" = t."typnamespace"
          WHERE t."typname" = 'AdminRole'
            AND n."nspname" = current_schema()
       )
UNION ALL
SELECT 'AuditChange.kind', "id", "kind"::text
  FROM "AuditChange"
 WHERE "kind"::text NOT IN ('CREATE', 'UPDATE', 'DELETE', 'REORDER')
 ORDER BY 1, 3;

-- P1b. NOT NULL is real on all five, independent of the declared constraint.
--      A NULL would pass P1 (NOT IN yields UNKNOWN) and then fail the retype.
--      EXPECTED: 0 rows.
SELECT 'AuditEvent' AS "table", "id"
  FROM "AuditEvent"
 WHERE "action" IS NULL OR "surface" IS NULL
    OR "publishState" IS NULL OR "actorRole" IS NULL
UNION ALL
SELECT 'AuditChange', "id" FROM "AuditChange" WHERE "kind" IS NULL;

-- P2. The value census, to be read against data-facts.txt before trusting P1's
--     silence. If the branch has drifted from the dump, the difference shows up
--     here as an extra label or a changed count, not as an error.
--     EXPECTED (per data-facts.txt, counts not stated there so read them as
--     information, not as an assertion):
--       action       | PUBLISH, SAVE, SAVE_AND_PUBLISH
--       surface      | publish, script, staging
--       publishState | NONE, OK
--       actorRole    | OWNER
--       kind         | UPDATE
SELECT 'action' AS "column", "action"::text AS "value", count(*) AS "rows"
  FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'surface', "surface"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'publishState', "publishState"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'actorRole', "actorRole"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'kind', "kind"::text, count(*) FROM "AuditChange" GROUP BY 2
 ORDER BY 1, 2;

-- P3. The five columns are still TEXT, and "publishState" is the only one with a
--     default. That default is why step 5 below is a DROP/retype/SET sandwich
--     and the other four casts are a single statement.
--     EXPECTED: 5 rows —
--       AuditChange | kind         | text | NO | (null)
--       AuditEvent  | action       | text | NO | (null)
--       AuditEvent  | actorRole    | text | NO | (null)
--       AuditEvent  | publishState | text | NO | 'NONE'::text
--       AuditEvent  | surface      | text | NO | (null)
--     If any row already reads USER-DEFINED the cluster has run; the DDL is
--     re-runnable but read V2 instead. If a default has appeared on one of the
--     other four, stop: this file would silently leave it in place as drift.
SELECT "table_name", "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND ( ("table_name"::text = 'AuditEvent'
          AND "column_name"::text IN ('action', 'surface', 'publishState', 'actorRole'))
      OR ("table_name"::text = 'AuditChange' AND "column_name"::text = 'kind') )
 ORDER BY 1, 2;

-- P4. THE CHECK INVENTORY on both tables. Three constraints, no more and no
--     fewer, and nothing on "surface" or "actorRole" — that absence is the
--     reason P1 exists and is worth seeing with your own eyes.
--     EXPECTED: 3 rows —
--       AuditChange | AuditChange_kind_check        | CHECK ((kind = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'DELETE'::text, 'REORDER'::text])))
--       AuditEvent  | AuditEvent_action_check       | CHECK ((action = ANY (ARRAY['SAVE'::text, 'SAVE_AND_PUBLISH'::text, 'PUBLISH'::text])))
--       AuditEvent  | AuditEvent_publishState_check | CHECK (("publishState" = ANY (ARRAY['NONE'::text, 'OK'::text, 'FAILED'::text])))
--     The quoting above is Postgres's own: pg_get_constraintdef quotes
--     "publishState" because it is mixed case and leaves the all-lowercase
--     action/kind bare. Match on the constraint NAME, not on the whitespace.
--     On a re-run: 0 rows. The drops below are IF EXISTS.
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"AuditEvent"'::regclass, '"AuditChange"'::regclass)
 ORDER BY 1, 2;

-- P5. The four type names this cluster creates are free.
--     EXPECTED: 0 rows on a first run. On a re-run: 14 rows, the four label sets
--     in declaration order. Any other label set under one of these names means
--     somebody created a different type there, and the guarded CREATEs below
--     would silently accept it and then fail the casts.
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM pg_type t
  JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" IN ('AuditAction', 'AuditSurface', 'PublishState', 'AuditChangeKind')
 ORDER BY t."typname", e."enumsortorder";

-- P6. "AdminRole" already exists and carries exactly the three labels the v2
--     schema declares, in that order. This is the one type this cluster does not
--     create, and the only label set it cannot fix inside this transaction.
--     EXPECTED: 3 rows — OWNER | 1 , ADMIN | 2 , SUB_ADMIN | 3
--     'SUB_ADMIN' is in production ("AdminUser"."role" holds it) but in no
--     migration file, so a branch built from migrations rather than cloned would
--     show only two rows here. If SUB_ADMIN is missing, STOP: adding it needs
--     ALTER TYPE "AdminRole" ADD VALUE 'SUB_ADMIN' in its own transaction,
--     committed before this file runs.
--     If the ORDER differs from the schema's declaration order, the casts below
--     still work and no data is at risk, but a later `prisma migrate diff` may
--     notice. Record it rather than reordering: reordering an enum means
--     recreating the type and every column that uses it.
SELECT e."enumlabel", e."enumsortorder"
  FROM pg_type t
  JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'AdminRole'
   AND n."nspname" = current_schema()
 ORDER BY e."enumsortorder";

-- P7. THE INDEX INVENTORY on both tables, so the one drop is deliberate and the
--     five survivors are known by name before two table rewrites touch them.
--     EXPECTED: 7 rows, all indisvalid = t —
--       AuditChange | AuditChange_entity_rowId_idx           | f  <- the one being dropped
--       AuditChange | AuditChange_eventId_seq_idx            | f
--       AuditChange | AuditChange_pkey                       | t
--       AuditEvent  | AuditEvent_actorId_idx                 | f
--       AuditEvent  | AuditEvent_createdAt_idx               | f
--       AuditEvent  | AuditEvent_pkey                        | t
--       AuditEvent  | AuditEvent_publishState_publishedAt_idx| f
--     On a re-run: 6 rows, without the first.
SELECT i."indrelid"::regclass::text AS "table",
       c."relname" AS "index",
       i."indisunique",
       i."indisvalid"
  FROM pg_index i
  JOIN pg_class c ON c."oid" = i."indexrelid"
 WHERE i."indrelid" IN ('"AuditEvent"'::regclass, '"AuditChange"'::regclass)
 ORDER BY 1, 2;

-- P8. Row-count snapshot. data-facts.txt does not state the row counts for
--     either table, so V3 compares against what is actually there now rather
--     than against a number this file invents. The per-value counts go in too:
--     that is how V3 proves no label was silently remapped, which a count(*)
--     alone cannot show.
DROP TABLE IF EXISTS "_pre65_audit_counts";
CREATE TEMP TABLE "_pre65_audit_counts" AS
SELECT 'action' AS "column", "action"::text AS "value", count(*) AS "rows"
  FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'surface', "surface"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'publishState', "publishState"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'actorRole', "actorRole"::text, count(*) FROM "AuditEvent" GROUP BY 2
UNION ALL
SELECT 'kind', "kind"::text, count(*) FROM "AuditChange" GROUP BY 2
UNION ALL
SELECT '_total', 'AuditEvent', count(*) FROM "AuditEvent"
UNION ALL
SELECT '_total', 'AuditChange', count(*) FROM "AuditChange";

SELECT * FROM "_pre65_audit_counts" ORDER BY "column", "value";

-- P9. Fail-closed guard. Here only because running the whole file in one
--     transaction means nobody gets to read P1's output before the DDL executes.
--     It re-asserts P1 and P6 and aborts with a message that names the column,
--     instead of letting a USING cast fail with a bare 22P02. Delete it if the
--     preflight is being run by hand as a separate step first.
DO $$
DECLARE
  "bad"       bigint;
  "roleLabels" text[];
BEGIN
  SELECT array_agg(e."enumlabel"::text ORDER BY e."enumsortorder")
    INTO "roleLabels"
    FROM pg_type t
    JOIN pg_enum e ON e."enumtypid" = t."oid"
    JOIN pg_namespace n ON n."oid" = t."typnamespace"
   WHERE t."typname" = 'AdminRole'
     AND n."nspname" = current_schema();

  IF "roleLabels" IS NULL THEN
    RAISE EXCEPTION
      '65-audit: type "AdminRole" does not exist in %. It predates this cluster (20260308072119_add_admin_user) and this file will not create it.',
      current_schema();
  END IF;

  IF NOT ("roleLabels" @> ARRAY['OWNER', 'ADMIN', 'SUB_ADMIN']) THEN
    RAISE EXCEPTION
      '65-audit: "AdminRole" has labels % but the v2 schema declares OWNER, ADMIN, SUB_ADMIN. Add the missing label with ALTER TYPE in its OWN transaction, commit, then re-run this file.',
      "roleLabels";
  END IF;

  SELECT count(*) INTO "bad" FROM (
    SELECT 1 FROM "AuditEvent"
     WHERE "action" IS NULL OR "action"::text NOT IN ('SAVE','SAVE_AND_PUBLISH','PUBLISH')
    UNION ALL
    SELECT 1 FROM "AuditEvent"
     WHERE "surface" IS NULL OR "surface"::text NOT IN ('staging','publish','script')
    UNION ALL
    SELECT 1 FROM "AuditEvent"
     WHERE "publishState" IS NULL OR "publishState"::text NOT IN ('NONE','OK','FAILED')
    UNION ALL
    SELECT 1 FROM "AuditEvent"
     WHERE "actorRole" IS NULL OR NOT ("actorRole"::text = ANY ("roleLabels"))
    UNION ALL
    SELECT 1 FROM "AuditChange"
     WHERE "kind" IS NULL OR "kind"::text NOT IN ('CREATE','UPDATE','DELETE','REORDER')
  ) "offenders";

  IF "bad" > 0 THEN
    RAISE EXCEPTION
      '65-audit: % audit value(s) outside the target enums. Run preflight P1, identify the writer, and resolve them; do not coerce. History rows are the one thing in this schema that must not be rewritten.',
      "bad";
  END IF;
END $$;


-- ============================================================================
-- DDL, in dependency order
-- ============================================================================

-- 1. The four types. Postgres has no CREATE TYPE ... IF NOT EXISTS, hence the
--    guards. Label order is the v2 schema's declaration order in every case,
--    which is deliberately NOT alphabetical for four of the five columns: it
--    puts the members in lifecycle order (SAVE before PUBLISH, NONE before OK
--    before FAILED) so ORDER BY reads as a progression. Nothing sorts on these
--    columns today; see the header.
--    "AuditSurface" is the @map'd one: its labels are the lowercase strings
--    already in the column, so 'staging' here matches STAGING @map("staging") in
--    the schema and the cast moves no data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'AuditAction' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "AuditAction" AS ENUM ('SAVE', 'SAVE_AND_PUBLISH', 'PUBLISH');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'AuditSurface' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "AuditSurface" AS ENUM ('staging', 'publish', 'script');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'PublishState' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "PublishState" AS ENUM ('NONE', 'OK', 'FAILED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'AuditChangeKind' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "AuditChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'REORDER');
  END IF;
END $$;

-- 2. Retire the three CHECKs. These MUST precede the retypes. Postgres will not
--    silently rewrite a constraint expression that compares the column to text
--    literals once the column is an enum; the ALTER errors out rather than
--    guessing. The enum is now the guard, and it is a stronger one: a CHECK can
--    be added NOT VALID, an enum cannot be bypassed at all.
--    There is nothing else to drop. Neither "surface" nor "actorRole" ever had a
--    CHECK, which P4 shows and the header explains.
ALTER TABLE "AuditEvent"  DROP CONSTRAINT IF EXISTS "AuditEvent_action_check";
ALTER TABLE "AuditEvent"  DROP CONSTRAINT IF EXISTS "AuditEvent_publishState_check";
ALTER TABLE "AuditChange" DROP CONSTRAINT IF EXISTS "AuditChange_kind_check";

-- 3. "AuditEvent"."action" — no default, so one statement. The USING cast is
--    text -> enum by label; writing it ::text::"AuditAction" rather than
--    ::"AuditAction" makes the statement re-runnable after the column is already
--    the enum, which is the only reason the redundant hop is there.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";

-- 4. "AuditEvent"."surface" — no default. The three lowercase values pass
--    straight through to the three @map'd labels. This is the cast that needed
--    SCRIPT to exist: without it, update-about-copy.ts's rows would abort here.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "surface" TYPE "AuditSurface" USING "surface"::text::"AuditSurface";

-- 5. "AuditEvent"."publishState" — DROP DEFAULT, retype, SET DEFAULT. Without
--    the drop the ALTER fails with "default for column "publishState" cannot be
--    cast automatically to type PublishState": there is no assignment cast from
--    text to an enum, and the default is a text literal. The restored default is
--    the same value 20260728150000 set, now as an enum literal, which is what
--    @default(NONE) in the v2 schema compiles to. NONE is not "unknown" — on a
--    plain Save it is the terminal, correct state, so the default is load-bearing.
--    "AuditEvent_publishState_publishedAt_idx" is rebuilt in place by this ALTER
--    and keeps its name; V4 asserts that.
ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" DROP DEFAULT;
ALTER TABLE "AuditEvent"
  ALTER COLUMN "publishState" TYPE "PublishState" USING "publishState"::text::"PublishState";
ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" SET DEFAULT 'NONE'::"PublishState";

-- 6. "AuditEvent"."actorRole" -> the PRE-EXISTING "AdminRole". No CREATE TYPE, no
--    default, no CHECK to drop first. P6 and P9 have already proved every stored
--    value is a label of that type; only 'OWNER' is present today.
--    This column is a JWT claim, not a join, and can legitimately be up to seven
--    days stale against "AdminUser"."role". Typing it does not make it fresh —
--    it makes an unexpected claim a hard insert failure instead of a tolerated
--    oddity, which is why the session boundary needs a guard. See open_problems.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "actorRole" TYPE "AdminRole" USING "actorRole"::text::"AdminRole";

-- 7. "AuditChange"."kind" — no default. The existing CHECK (dropped in step 2)
--    already guaranteed this cast; only 'UPDATE' is actually stored. The other
--    three labels are not speculative: CREATE, DELETE and REORDER all have
--    writers, and a REORDER row is one row per gesture with a NULL "rowId" and
--    the literal field name 'order', not one row per moved item.
--    "AuditChange_eventId_seq_idx" and "AuditChange_pkey" are rebuilt in place.
ALTER TABLE "AuditChange"
  ALTER COLUMN "kind" TYPE "AuditChangeKind" USING "kind"::text::"AuditChangeKind";

-- 8. Drop the dead index. Not in the v2 schema, so keeping it is drift. Plain
--    DROP INDEX, not CONCURRENTLY, precisely because CONCURRENTLY cannot run
--    inside a transaction and this table is tiny.
--    Trade-off, stated once more because it is the only irreversible-in-spirit
--    line in this file: this is the only index that could serve
--    "everything that happened to row X". Nothing queries that today. One
--    CREATE INDEX brings it back.
DROP INDEX IF EXISTS "AuditChange_entity_rowId_idx";


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- V1. The four new types exist with exactly the right labels in the right order.
--     EXPECTED: 14 rows —
--       AuditAction     | SAVE 1, SAVE_AND_PUBLISH 2, PUBLISH 3
--       AuditChangeKind | CREATE 1, UPDATE 2, DELETE 3, REORDER 4
--       AuditSurface    | staging 1, publish 2, script 3      (lowercase: @map)
--       PublishState    | NONE 1, OK 2, FAILED 3
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM pg_type t
  JOIN pg_enum e ON e."enumtypid" = t."oid"
  JOIN pg_namespace n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" IN ('AuditAction', 'AuditSurface', 'PublishState', 'AuditChangeKind')
 ORDER BY t."typname", e."enumsortorder";

-- V2. All five columns are now their enum, nullability unchanged, and the only
--     default is the one the schema declares.
--     EXPECTED: 5 rows —
--       AuditChange | kind         | USER-DEFINED | AuditChangeKind | NO | (null)
--       AuditEvent  | action       | USER-DEFINED | AuditAction     | NO | (null)
--       AuditEvent  | actorRole    | USER-DEFINED | AdminRole       | NO | (null)
--       AuditEvent  | publishState | USER-DEFINED | PublishState    | NO | 'NONE'::"PublishState"
--       AuditEvent  | surface      | USER-DEFINED | AuditSurface    | NO | (null)
SELECT "table_name", "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND ( ("table_name"::text = 'AuditEvent'
          AND "column_name"::text IN ('action', 'surface', 'publishState', 'actorRole'))
      OR ("table_name"::text = 'AuditChange' AND "column_name"::text = 'kind') )
 ORDER BY 1, 2;

-- V3. NOTHING WAS LOST AND NOTHING WAS REMAPPED. Compares every per-value count
--     and both row totals against P8's snapshot. This is the assertion that
--     binds, because data-facts.txt does not state these two row counts.
--     EXPECTED: 0 rows. A row here with a NULL "after" means a label vanished; a
--     differing count means a value was remapped.
WITH "post" AS (
  SELECT 'action' AS "column", "action"::text AS "value", count(*) AS "rows"
    FROM "AuditEvent" GROUP BY 2
  UNION ALL
  SELECT 'surface', "surface"::text, count(*) FROM "AuditEvent" GROUP BY 2
  UNION ALL
  SELECT 'publishState', "publishState"::text, count(*) FROM "AuditEvent" GROUP BY 2
  UNION ALL
  SELECT 'actorRole', "actorRole"::text, count(*) FROM "AuditEvent" GROUP BY 2
  UNION ALL
  SELECT 'kind', "kind"::text, count(*) FROM "AuditChange" GROUP BY 2
  UNION ALL
  SELECT '_total', 'AuditEvent', count(*) FROM "AuditEvent"
  UNION ALL
  SELECT '_total', 'AuditChange', count(*) FROM "AuditChange"
)
SELECT coalesce(b."column", p."column") AS "column",
       coalesce(b."value", p."value")   AS "value",
       b."rows" AS "before",
       p."rows" AS "after"
  FROM "_pre65_audit_counts" b
  FULL JOIN "post" p
    ON p."column" = b."column" AND p."value" = b."value"
 WHERE b."rows" IS DISTINCT FROM p."rows"
 ORDER BY 1, 2;

-- V4. Every index survived both table rewrites with its name and its
--     uniqueness, and the dead one is gone.
--     EXPECTED: 6 rows, all indisvalid = t —
--       AuditChange | AuditChange_eventId_seq_idx             | f | t
--       AuditChange | AuditChange_pkey                        | t | t
--       AuditEvent  | AuditEvent_actorId_idx                  | f | t
--       AuditEvent  | AuditEvent_createdAt_idx                | f | t
--       AuditEvent  | AuditEvent_pkey                         | t | t
--       AuditEvent  | AuditEvent_publishState_publishedAt_idx | f | t
--     "AuditChange_entity_rowId_idx" must NOT appear.
SELECT i."indrelid"::regclass::text AS "table",
       c."relname" AS "index",
       i."indisunique",
       i."indisvalid"
  FROM pg_index i
  JOIN pg_class c ON c."oid" = i."indexrelid"
 WHERE i."indrelid" IN ('"AuditEvent"'::regclass, '"AuditChange"'::regclass)
 ORDER BY 1, 2;

-- V5. No CHECK constraint remains on either table. The v2 schema declares none
--     for these two (see the "Constraints Prisma cannot express" table in
--     schema-v2.md, which lists neither), so any survivor is drift.
--     EXPECTED: 0 rows.
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"AuditEvent"'::regclass, '"AuditChange"'::regclass)
 ORDER BY 1, 2;

-- V6. Read the data back through the enums, as a human sanity check that the
--     labels mean what they meant before.
--     EXPECTED, per data-facts.txt: "surface" shows publish, script and staging
--     and nothing else; "publishState" shows NONE and OK and never FAILED;
--     "actorRole" is OWNER on every row; "kind" is UPDATE on every row; the
--     three "entity" values are aboutParagraph, adminUser and heroContent.
SELECT "action"::text       AS "action",
       "surface"::text      AS "surface",
       "publishState"::text AS "publishState",
       "actorRole"::text    AS "actorRole",
       count(*)             AS "rows"
  FROM "AuditEvent"
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2, 3;

SELECT "kind"::text AS "kind", "entity", count(*) AS "rows"
  FROM "AuditChange"
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- V7. Both foreign keys came through the rewrites unchanged. This cluster does
--     not touch them; the point is to prove that.
--     EXPECTED: 2 rows —
--       AuditChange | AuditChange_eventId_fkey | FOREIGN KEY ("eventId") REFERENCES "AuditEvent"(id) ON UPDATE CASCADE ON DELETE CASCADE
--       AuditEvent  | AuditEvent_actorId_fkey  | FOREIGN KEY ("actorId") REFERENCES "AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL
--     ("id" prints unquoted; it is all-lowercase. Same caveat as P4.)
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM pg_constraint c
 WHERE c."contype" = 'f'
   AND c."conrelid" IN ('"AuditEvent"'::regclass, '"AuditChange"'::regclass)
 ORDER BY 1, 2;

-- V8. The actor denormalisation still holds: history must stay readable after an
--     account is hard-deleted, which is the reason "actorRole" is stored rather
--     than joined. Typing it must not have emptied the other three copies.
--     EXPECTED: 0 rows.
SELECT "id", "actorId", "actorName", "actorEmail", "actorRole"::text AS "actorRole"
  FROM "AuditEvent"
 WHERE "actorName" = '' OR "actorEmail" = '' OR "actorRole" IS NULL;

-- V9. "AdminRole" is unharmed and still types "AdminUser"."role" as well.
--     EXPECTED: 2 rows — AdminUser | role | AdminRole
--                        AuditEvent | actorRole | AdminRole
SELECT "table_name", "column_name", "udt_name"
  FROM information_schema."columns"
 WHERE "table_schema" = current_schema()
   AND "udt_name"::text = 'AdminRole'
 ORDER BY 1, 2;

-- Tidy up the snapshot. It is a TEMP table, so it also dies with the session.
DROP TABLE IF EXISTS "_pre65_audit_counts";
