-- ============================================================================
-- PRODUCTION CONTRACT  ·  cluster: media-flags-reval-github
-- Run ONLY after the v2 code is deployed to BOTH apps and confirmed serving.
-- "Confirmed" means, concretely:
--   1. /flags, /site-config and /terminal on the admin render 200 (they are the
--      three pages that select FeatureFlag.label today).
--   2. /revalidation on the admin renders 200 and its scope column shows values.
--   3. The homepage renders the GitHub tile, i.e. apps/web/app/lib/github.ts is
--      the reordered version.
-- If any of those is still v1, STOP: section 1 below takes the admin down and
-- section 4 arms a constraint the v1 writer violates.
--
-- Postgres 17 / Neon. Role is the database OWNER, not a superuser.
--
-- THIS FILE CARRIES ITS OWN TRANSACTION. One BEGIN below the header, one COMMIT
-- after the verification block, matching the other 21 files in this directory.
-- Do NOT wrap it in an outer BEGIN/COMMIT and do NOT pass psql
-- --single-transaction. Atomicity here is not tidiness; it is the whole safety
-- argument of the file:
--   * SET LOCAL lock_timeout / statement_timeout are a silent NO-OP outside a
--     transaction block (they only emit "WARNING: SET LOCAL can only be used in
--     transaction blocks"). Section 3 takes ACCESS EXCLUSIVE on
--     "RevalidationLog" to rewrite it while two live writers can be mid-statement,
--     and section 1 takes it on "FeatureFlag", which apps/web reads inside the
--     root layout. Without the lock timeout a blocked statement queues the site
--     behind it instead of failing fast.
--   * the DROP COLUMN in section 1 is the one statement in this file whose only
--     remaining source is the Step 15 P4 dump. Without a transaction it commits
--     BEFORE section 3's SYSTEM-rows guard and section 4's orphan-GithubYear
--     guard, both of which RAISE EXCEPTION — and section 4's is the LAST
--     statement in the file and the likeliest to fire. Half-applied is the one
--     state the rollback block at the foot of this file cannot describe.
-- The verification SELECTs therefore run INSIDE the transaction and COMMIT is
-- the last statement. Read the human GATE above and the P4 dump from Step 15 in
-- PASS 1 (RUNBOOK.md Stage 1), before any DDL.
--
-- ADMIN FREEZE: state a 2-minute admin freeze for this file. Section 3 rewrites
-- RevalidationLog under ACCESS EXCLUSIVE. The PUBLIC site is untouched by every
-- statement here — apps/web reads none of these columns (its only FeatureFlag
-- read is `select: { key: true, enabled: true }` at apps/web/app/lib/flags.ts:13,
-- and it never reads MediaAsset or RevalidationLog at all).
--
-- NOT HERE: MediaAsset."url". The v2 schema still declares it
-- (packages/db/prisma/schema.prisma:598) and the v2 code still writes it
-- (apps/docs/app/lib/actions/media.ts:227, media-browser.ts:495, :804). Its
-- drop is a separate third stage after a LATER code deploy, per schema-v2.md
-- step 28.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';


-- ============================================================================
-- 0. POST-DEPLOY TOP-UP of the two EXPAND backfills.
--
-- Every write that landed between EXPAND and DEPLOY came from v1 code that did
-- not know the new columns existed:
--   * A flag flip wrote updatedById and left updatedByName alone
--     (HEAD:apps/docs/app/lib/actions/flags.ts:48-55).
--   * A revalidation wrote a row with scope = NULL and actorName = NULL
--     (HEAD:apps/docs/app/lib/revalidation.ts:79-92).
-- Re-run both backfills before anything is dropped. This is idempotent and is
-- the only statement in this file that is safe to run more than once at will.
-- ============================================================================

UPDATE "FeatureFlag" f
   SET "updatedByName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = f."updatedById"
   AND f."updatedByName" IS DISTINCT FROM a."name";

UPDATE "RevalidationLog" l
   SET "actorName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = l."actorId"
   AND l."actorName" IS DISTINCT FROM a."name";

UPDATE "RevalidationLog"
   SET "scope" = CASE
     WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
     WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
     WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
     ELSE                                                                                     'TAGS'
   END::"RevalidationScope"
 WHERE "scope" IS NULL;


-- ============================================================================
-- 1. FeatureFlag  ·  DROP label, DROP description
--
-- WHY THIS COULD NOT BE ADDITIVE: three deployed v1 admin pages call
-- prisma.featureFlag.findMany() with no `select`, and the Prisma client emits an
-- explicit column list built from its own datamodel, so all three SELECT
-- "label" and "description":
--   HEAD:apps/docs/app/(dashboard)/flags/page.tsx:23
--   HEAD:apps/docs/app/(dashboard)/site-config/page.tsx:19
--   HEAD:apps/docs/app/(dashboard)/terminal/page.tsx:46
-- After the drop, those queries return 42703, Prisma raises P2022, and all three
-- (force-dynamic server components) 500. The v2 client's datamodel no longer has
-- the fields, so its identical findMany() call selects seven columns and is fine.
--
-- LAST CHANCE to record the values. Run this OUTSIDE the transaction first if
-- the preflight P4 output from EXPAND is not already in your run log:
--   SELECT "key", "label", "description" FROM "FeatureFlag" ORDER BY "key";
-- For the nine FLAG_DEFINITIONS keys the text lives in
-- packages/shared/src/flags.ts and nothing is lost. For any other key this is
-- the only copy, which is why the gate below refuses to guess.
-- ============================================================================

DO $$
DECLARE "offRegistry" bigint;
BEGIN
  SELECT count(*) INTO "offRegistry" FROM "FeatureFlag"
   WHERE "key" NOT IN ('section.about','section.skills','section.experience',
                       'section.projects','section.blogs','section.contact',
                       'contact.form','analytics.enabled','easter-eggs.enabled');
  IF "offRegistry" > 0 THEN
    RAISE WARNING 'CONTRACT: % FeatureFlag row(s) have a key outside FLAG_DEFINITIONS. Their label/description are about to be destroyed and `bun run flags:seed` cannot restore them. EXPAND preflight P4 is the only copy.', "offRegistry";
  END IF;
END $$;

ALTER TABLE "FeatureFlag"
  DROP COLUMN IF EXISTS "label",
  DROP COLUMN IF EXISTS "description";


-- ============================================================================
-- 2. The two unread indexes.
--
-- Deferred out of EXPAND only to keep EXPAND purely additive; neither drop can
-- break v1 or v2, because no query in either version filters on MediaAsset.folder
-- or on RevalidationLog.[entityType, entityId]. entityType/entityId are written
-- at six v1 call sites and read by nothing.
-- Confirm idx_scan = 0 on PRODUCTION (not on a Neon branch, whose pg_stat_*
-- counters are a fresh compute's and always read 0) before running these:
--   SELECT "indexrelname", "idx_scan" FROM "pg_stat_user_indexes"
--    WHERE "indexrelname" IN ('MediaAsset_folder_createdAt_idx',
--                             'RevalidationLog_entityType_entityId_idx');
-- ============================================================================

DROP INDEX IF EXISTS "MediaAsset_folder_createdAt_idx";
DROP INDEX IF EXISTS "RevalidationLog_entityType_entityId_idx";


-- ============================================================================
-- 3. RevalidationTrigger  ·  drop 'SYSTEM'
--
-- Postgres has no ALTER TYPE ... DROP VALUE, so this is rename / create / retype
-- / drop, and the ALTER COLUMN TYPE rewrites the table under ACCESS EXCLUSIVE.
--
-- WHY IT WAITED FOR THE DEPLOY: not because a v1 writer emits SYSTEM — none
-- does; all four v1 call sites are accounted for and all four labels survive:
--   HEAD:apps/docs/app/lib/actions/flags.ts:67              FLAG_CHANGE
--   HEAD:apps/docs/app/lib/actions/publishing.ts:133,329,348 SCHEDULED_PUBLISH / CONTENT_SAVE
--   HEAD:apps/docs/app/lib/actions/revalidation.ts:33,51,70,102  MANUAL
-- It waited because of the LOCK, and because of one narrow protocol race: a
-- concurrent INSERT that has already planned `CAST($n::text AS
-- "RevalidationTrigger")` and is then queued behind our ACCESS EXCLUSIVE lock
-- resolves the OLD type OID, and that OID is gone by the time it runs. Two live
-- writers can be in flight — the log INSERT
-- (HEAD:apps/docs/app/lib/revalidation.ts:79) and the retention DELETE
-- (HEAD:packages/db/src/maintenance.ts:163-177) which fires off a *visitor*
-- beacon at HEAD:apps/web/app/api/collect/route.ts:108. The admin freeze plus
-- lock_timeout = 3s is the mitigation: we fail fast and retry rather than queue.
--
-- What is NOT a hazard, checked in the installed driver: the deployed client is
-- @prisma/adapter-pg 7.4.2 over node-postgres, and it issues every query as
-- client.query({ text, values, rowMode }) with NO `name`
-- (node_modules/.bun/@prisma+adapter-pg@7.4.2/.../dist/index.js:652-679), i.e.
-- unnamed prepared statements with no server-side statement cache. So the new
-- type OID cannot trigger "cached plan must not change result type", and reads
-- are unaffected because the adapter maps any OID >= 16384 to ColumnTypeEnum.Text
-- per result set (same file, fieldToColumnType default branch) rather than
-- caching a pg_type lookup.
-- ============================================================================

DO $$
DECLARE "systemRows" bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_type" t
      JOIN "pg_enum" e ON e."enumtypid" = t."oid"
      JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'RevalidationTrigger' AND n."nspname" = current_schema()
       AND e."enumlabel" = 'SYSTEM'
  ) THEN
    RAISE NOTICE 'RevalidationTrigger already has no SYSTEM label; no-op.';
  ELSE
    SELECT count(*) INTO "systemRows" FROM "RevalidationLog" WHERE "trigger"::text = 'SYSTEM';
    IF "systemRows" > 0 THEN
      RAISE EXCEPTION 'ABORT: % RevalidationLog row(s) hold trigger SYSTEM. Decide what they should become before the label is dropped.', "systemRows";
    END IF;

    -- Now that this file carries its own BEGIN/COMMIT, a failed run rolls the
    -- rename back and this cannot fire from a retry of THIS file. It is kept
    -- because the state it detects is still reachable: somebody running the
    -- rename by hand, or an older copy of this file applied without a
    -- transaction. The condition is cheap and the failure it prevents -- two
    -- enum types both claiming the column -- is not.
    IF EXISTS (SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
                WHERE t."typname" = 'RevalidationTrigger_old' AND n."nspname" = current_schema()) THEN
      RAISE EXCEPTION 'ABORT: RevalidationTrigger_old already exists — a previous attempt half-finished. Clean it up by hand.';
    END IF;

    ALTER TYPE "RevalidationTrigger" RENAME TO "RevalidationTrigger_old";

    CREATE TYPE "RevalidationTrigger" AS ENUM (
      'MANUAL', 'CONTENT_SAVE', 'SCHEDULED_PUBLISH', 'FLAG_CHANGE'
    );

    -- ::text::"RevalidationTrigger" is label-preserving and raises 22P02 rather
    -- than coercing if an unexpected label exists. The column has no DEFAULT
    -- (20260821130000_add_revalidation_log/migration.sql:17), so there is no
    -- default expression to drop and restore.
    ALTER TABLE "RevalidationLog"
      ALTER COLUMN "trigger" TYPE "RevalidationTrigger"
      USING "trigger"::text::"RevalidationTrigger";

    DROP TYPE "RevalidationTrigger_old";
  END IF;
END $$;


-- ============================================================================
-- 4. GithubYear -> GithubProfile(handle)  ·  RESTRICT / CASCADE
--
-- WHY THIS COULD NOT BE ADDED BEFORE THE DEPLOY. The v1 refresh builds its
-- write array years-first and appends the profile upsert last, then runs the
-- whole array in one $transaction:
--   HEAD:apps/web/app/lib/github.ts:146-153   GithubYear upserts pushed first
--   HEAD:apps/web/app/lib/github.ts:156-161   GithubProfile upsert pushed last
--   HEAD:apps/web/app/lib/github.ts:162       await prisma.$transaction(writes)
-- FK checks are immediate by default, so the first year INSERT for a handle with
-- no profile row fails 23503, the whole transaction aborts, and
-- HEAD:apps/web/app/lib/github.ts:164 (`catch { return false }`) swallows it.
-- That is not an admin-only path: HEAD:apps/web/app/page.tsx:120-134 fires the
-- refresh in after() on any homepage ISR regeneration whenever
-- `!github || github.stale`, so the graph would fail and silently retry on
-- public traffic forever.
--
-- For the handle that is live TODAY the profile row exists, so every v1 year
-- upsert is an UPDATE or a same-handle INSERT and the FK would in fact have held
-- through the window. What it could not survive is the `!github` bootstrap case,
-- i.e. someone editing the github SocialLink. The FK has no reader in either
-- version, so there was nothing to gain by taking that risk early.
--
-- The v2 writer puts the profile upsert FIRST (apps/web/app/lib/github.ts:141-147
-- in the deployed tree), which is what makes this unconditionally safe now.
--
-- REPAIR FOR AN ORPHAN IS AN INSERT, NEVER A DELETE. GithubYear is the only copy
-- of contribution history older than upstream's trailing ~365-day window and
-- nothing can rebuild it; a missing GithubProfile row holds only a handle, a
-- total and a timestamp and is trivially recreatable.
-- ============================================================================

DO $$
DECLARE
  "orphanRows"    bigint;
  "orphanHandles" text;
BEGIN
  IF EXISTS (SELECT 1 FROM "pg_constraint"
              WHERE "conrelid" = '"GithubYear"'::regclass
                AND "conname" = 'GithubYear_handle_fkey') THEN
    RAISE NOTICE 'GithubYear_handle_fkey already exists; no-op.';
  ELSE
    SELECT count(*), string_agg(DISTINCT y."handle", ', ')
      INTO "orphanRows", "orphanHandles"
      FROM "GithubYear" y
      LEFT JOIN "GithubProfile" p ON p."handle" = y."handle"
     WHERE p."handle" IS NULL;

    IF "orphanRows" > 0 THEN
      RAISE EXCEPTION
        'ABORT: % orphan GithubYear row(s) for handle(s) [%]. REPAIR BY INSERTING THE MISSING GithubProfile, NEVER BY DELETING THE GithubYear ROW: those rows are the only copy of contribution history older than upstream''s trailing ~365-day window. INSERT INTO "GithubProfile" ("id","handle","total","fetchedAt") VALUES (gen_random_uuid()::text, ''<handle>'', 0, ''epoch''::timestamp);',
        "orphanRows", "orphanHandles";
    END IF;

    -- RESTRICT, not CASCADE: nothing in either version ever deletes a
    -- GithubProfile, so CASCADE would protect nothing while arming one DELETE
    -- against a one-row table to wipe an irreplaceable archive.
    -- ON UPDATE CASCADE is the useful half: handle is the join key and is
    -- derived from the SocialLink whose iconKey is 'github', so a rename must
    -- carry the years with it rather than orphan them.
    ALTER TABLE "GithubYear"
      ADD CONSTRAINT "GithubYear_handle_fkey"
      FOREIGN KEY ("handle") REFERENCES "GithubProfile"("handle")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
-- No index is added on GithubYear."handle": GithubYear_handle_year_key already
-- leads with handle, so the RESTRICT and CASCADE checks have an access path, and
-- the v2 schema declares no such index — adding one would be drift.


-- ============================================================================
-- VERIFICATION  (run before COMMIT)
-- ============================================================================

-- V1. FeatureFlag is down to seven columns and label/description are gone.
--     EXPECTED: 7 rows — createdAt, enabled, key, note, updatedAt, updatedById,
--     updatedByName.
SELECT "column_name", "data_type", "is_nullable"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'FeatureFlag'
 ORDER BY "column_name";

-- V2. Both indexes are gone and nothing else on those two tables was.
--     EXPECTED: MediaAsset — createdAt_idx, key_key, key_prefix_idx, pkey
--     (+ uploadedById_idx if cluster 60 has run); RevalidationLog — createdAt_idx,
--     pkey, status_createdAt_idx (+ actorId_idx if cluster 60 has run).
SELECT "tablename", "indexname" FROM "pg_indexes"
 WHERE "schemaname" = current_schema()
   AND "tablename" IN ('MediaAsset', 'RevalidationLog', 'FeatureFlag')
 ORDER BY "tablename", "indexname";

-- V3. RevalidationTrigger has exactly four labels in declaration order and no
--     renamed leftover survives. EXPECTED: 4 rows, MANUAL / CONTENT_SAVE /
--     SCHEDULED_PUBLISH / FLAG_CHANGE, and nothing named *_old.
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM "pg_type" t JOIN "pg_enum" e ON e."enumtypid" = t."oid"
  JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" IN ('RevalidationTrigger', 'RevalidationTrigger_old')
 ORDER BY t."typname", e."enumsortorder";

-- V4. No trigger value moved during the rewrite, and scope/actorName are now
--     complete. EXPECTED: no NULL scope; nullScopeRows = 0.
SELECT "trigger"::text AS "trigger", "scope"::text AS "scope", count(*) AS "rows"
  FROM "RevalidationLog" GROUP BY 1, 2 ORDER BY 1, 2;

SELECT count(*) FILTER (WHERE "scope" IS NULL) AS "nullScopeRows",
       count(*) FILTER (WHERE "actorId" IS NOT NULL AND "actorName" IS NULL) AS "namelessWithActor",
       count(*) FILTER (WHERE "actorId" IS NULL AND "actorName" IS NOT NULL) AS "nameWithoutActor"
  FROM "RevalidationLog";

-- V5. The FK exists with the right actions and the two pre-existing GithubYear
--     CHECKs are untouched. EXPECTED: 5 rows —
--       GithubYear_days_length_check | c |   |   | t | CHECK ((length(days) = ANY (ARRAY[365, 366])))
--       GithubYear_handle_fkey       | f | r | c | t | FOREIGN KEY (handle) REFERENCES "GithubProfile"(handle) ON UPDATE CASCADE ON DELETE RESTRICT
--       GithubYear_handle_year_key   | u |   |   | t | UNIQUE (handle, year)
--       GithubYear_pkey              | p |   |   | t | PRIMARY KEY (id)
--       GithubYear_year_check        | c |   |   | t | CHECK (((year >= 2005) AND (year <= 2200)))
--     confdeltype 'r' = RESTRICT, confupdtype 'c' = CASCADE. Both matter.
SELECT "conname", "contype", "confdeltype", "confupdtype", "convalidated",
       pg_get_constraintdef("oid") AS "definition"
  FROM "pg_constraint"
 WHERE "conrelid" = '"GithubYear"'::regclass
 ORDER BY "conname";

-- V6. Every GithubYear row still has its profile, and nothing vanished.
--     EXPECTED: 1 row — 2 | 0 | 1 (githubProfiles per EXPAND preflight).
SELECT count(*) AS "githubYears",
       count(*) FILTER (WHERE p."handle" IS NULL) AS "orphans",
       (SELECT count(*) FROM "GithubProfile") AS "githubProfiles"
  FROM "GithubYear" y LEFT JOIN "GithubProfile" p ON p."handle" = y."handle";

-- V7. MediaAsset is intact, url included (it is NOT dropped by this cutover).
--     EXPECTED: 14 rows including "url" text NO.
SELECT "column_name", "data_type", "is_nullable"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'MediaAsset'
 ORDER BY "column_name";


COMMIT;


-- ============================================================================
-- ROLLBACK  (after COMMIT)
--
-- FIVE STEPS, NOT ONE TRANSACTION. `SET NOT NULL` on "label" cannot be in the
-- same transaction as the ADD COLUMN, because between them the text has to be
-- put back, and the tool that puts most of it back is a separate process. If you
-- run them together, SET NOT NULL raises 23502 on the first row whose label is
-- still NULL and rolls back the entire rollback — including the FK drop and the
-- enum re-widening, which had nothing to do with it. That failure is not
-- hypothetical: it is the expected outcome whenever any FeatureFlag key is
-- outside FLAG_DEFINITIONS, which is precisely the case section 1 above RAISEs a
-- WARNING about.
--
-- R1. Shape back, in one transaction. "label" returns NULLABLE, i.e. the
--     post-EXPAND shape, which is deliberate: R5 is what closes it.
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "GithubYear" DROP CONSTRAINT IF EXISTS "GithubYear_handle_fkey";
--   ALTER TYPE "RevalidationTrigger" ADD VALUE IF NOT EXISTS 'SYSTEM';
--     -- appends last, which is exactly where 20260821130000 had it, so the
--     -- label order comes back byte-identical. On PG12+ this is allowed inside
--     -- a transaction but the restored label cannot be USED until after COMMIT.
--   CREATE INDEX IF NOT EXISTS "RevalidationLog_entityType_entityId_idx"
--     ON "RevalidationLog" ("entityType", "entityId");
--   CREATE INDEX IF NOT EXISTS "MediaAsset_folder_createdAt_idx"
--     ON "MediaAsset" ("folder", "createdAt");
--   ALTER TABLE "FeatureFlag" ADD COLUMN IF NOT EXISTS "label" TEXT,
--                             ADD COLUMN IF NOT EXISTS "description" TEXT;
--   COMMIT;
--
-- R2. The text back, for EVERY key including the off-registry ones, out of the
--     Step 38 PRE-CONTRACT dump (or Step 7's — both predate this file, so both
--     still carry label and description). This is the executable form of what
--     used to be "read the P4 output and retype it":
--
--       cd packages/db
--       jq -r -f v2-production/recover-from-dump.jq \
--          --arg table FeatureFlag --arg key key \
--          --arg cols 'label,description' --arg mode update \
--          backups/PRE-CONTRACT-<stamp>.json \
--          > /tmp/v2/prod/recover-flag-labels.sql
--       # read it, then apply it the same way you applied this file
--
--     Its guard aborts if a key in the dump no longer exists in "FeatureFlag" —
--     read the message rather than deleting the guard. A key CREATED after the
--     dump is simply absent from the generated file and is what R4 exists for.
--     RUNBOOK.md Step 8b rehearses this exact command on a throwaway branch; if
--     you have not run Step 8b, do not first learn this path here.
--
-- R3. Belt and braces for the nine FLAG_DEFINITIONS keys, if R2's dump is
--     unavailable or you want the registry text rather than the stored text. The
--     DATABASE_URL override is MANDATORY: `flags:seed` resolves its connection
--     through packages/db/src/index.ts:1,5 (dotenv/config + process.env
--     .DATABASE_URL), and local DATABASE_URL points at the throwaway Neon child
--     branch — without the override you seed the branch, leave production's
--     labels NULL, and then R5 fails 23502 with no obvious cause.
--
--       git stash && git checkout 0050cc9 -- packages/db packages/shared
--       cd packages/db && DATABASE_URL="$PGPROD" bun run db:generate
--       DATABASE_URL="$PGPROD" bun run flags:seed
--
--     0050cc9 is the deployed v1 commit. Its seed upserts label + description
--     (0050cc9:packages/db/scripts/seed-flags.ts:14-23); the v2 seed writes
--     neither (HEAD:packages/db/scripts/seed-flags.ts:19-22), so the v1 tree is
--     required, and the generated client is gitignored (.gitignore,
--     `**/generated/prisma`) so db:generate has to run again against it. The v1
--     seed leaves off-registry keys alone by design (0050cc9:.../seed-flags.ts
--     :37-42) — that is why R2 comes first and R4 exists.
--
-- R4. The fail-safe. Never expected to matter, and the only reason R5 is safe.
--
--   BEGIN;
--   SELECT "key" FROM "FeatureFlag" WHERE "label" IS NULL;      -- read this
--   UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL;
--   COMMIT;
--
-- R5. Only now:
--
--   BEGIN; ALTER TABLE "FeatureFlag" ALTER COLUMN "label" SET NOT NULL; COMMIT;
--
-- DO NOT RE-ALIAS THE v1 DEPLOYMENT UNTIL R5 HAS COMMITTED. The v1 client's
-- datamodel declares `label String`, non-nullable
-- (0050cc9:packages/db/prisma/schema.prisma, model FeatureFlag), so a NULL label
-- is a value its three reader pages were never built to receive. `description`
-- is already `String?` there and needs nothing. Finish the rollback, re-alias
-- second — the same ordering rule as Step 39's `ContactMessage.read`.
--
-- If you are rolling back because the v2 DEPLOY is being reverted, roll back
-- this file FIRST and leave EXPAND in place: v1 runs correctly against the
-- post-EXPAND schema, which is the whole point of the split.
-- ============================================================================
