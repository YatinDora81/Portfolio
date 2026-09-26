-- ============================================================================
-- Cluster 70-media-flags-reval
-- Branch migration for the v2 schema. Runs against the Neon child branch only
-- (copy-on-write clone of production, serves no traffic). Production is not
-- touched by this file. Postgres 17, role is the database OWNER and NOT a
-- superuser: no session_replication_role, no DISABLE TRIGGER ALL, no
-- CREATE EXTENSION, no CONCURRENTLY.
-- ============================================================================
--
-- WHAT THIS CLUSTER DOES
--
--   "MediaAsset"  (2 rows)
--     1. DROP INDEX "MediaAsset_folder_createdAt_idx". It serves no query: the
--        media browser's only folder read is a key prefix scan, not a
--        [folder, createdAt] range. Created by
--        20260822130000_add_links_rollup_media/migration.sql:111.
--     2. CREATE INDEX "MediaAsset_key_prefix_idx" ON "MediaAsset"
--        ("key" text_pattern_ops). browseFolder compiles to LIKE 'prefix%',
--        which the default-collation unique index "MediaAsset_key_key" cannot
--        serve. Written in exactly the form
--        20260803120000_add_notes/migration.sql:78 uses for
--        "NoteNode_path_prefix_idx", which is the form Prisma 7 emits for
--        @@index([key(ops: raw("text_pattern_ops"))], map: "..."), so a later
--        `prisma migrate diff` sees no drift. Two honest limits carried over
--        from schema-v2.md: it does nothing for the empty-prefix landing view
--        and it cannot satisfy `orderBy key asc`.
--     3. ADD CONSTRAINT "MediaAsset_folder_check" — the denormalised "folder"
--        must equal the directory prefix of "key", falling back to 'uploads'.
--        The expression is a literal transcription of folderOfKey
--        (packages/storage/src/media.ts:122-125) and of the column's own
--        DEFAULT 'uploads' (media.ts:42):
--          COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads')
--        The NULLIF is what makes a slash-free key fall back instead of
--        becoming the key itself, which is the case the bucket-root adoption
--        path would otherwise violate.
--     4. "url" STAYS. It is a stored copy of publicUrlFor("key") and it is
--        dropped by a separate contract-only migration after the code deploy
--        that stops reading it (schema-v2.md, step 28). Nine UI sites and three
--        upserts still read/write it.
--
--   "FeatureFlag"
--     5. ADD COLUMN "updatedByName" TEXT, backfilled from "AdminUser"."name",
--        so flags/page.tsx:28-35 can delete its second query instead of
--        trading it for an include.
--     6. DROP COLUMN "label", DROP COLUMN "description". This table is a state
--        store, not a definition store: both columns are written only by
--        packages/db/scripts/seed-flags.ts:18-22 and read only by that script's
--        own read-back, while the page renders label/description from
--        FLAG_DEFINITIONS (packages/shared/src/flags.ts:23-89). See data_loss:
--        the values are recoverable from code for every registry key, and only
--        for those.
--
--   "RevalidationLog"
--     7. CREATE TYPE "RevalidationScope" AS ENUM ('SITE','TAGS','PATHS','MIXED')
--        and ADD COLUMN "scope" "RevalidationScope" — NULLABLE, no default.
--        Nullable and not NOT NULL on purpose: the writer at
--        apps/docs/app/lib/revalidation.ts:79-92 sits inside a catch that
--        swallows everything (:109-111), so a required column with no default
--        would silently lose both the log row and the "TagState" upsert loop
--        that follows it. This deliberately overrides plan.txt step 27, which
--        still said "backfill ... SET NOT NULL"; schema-v2.md and the new
--        schema.prisma both declare `scope RevalidationScope?`.
--        MIXED exists because the admin accepts paths and tags in one call and
--        apps/web/app/api/revalidate/route.ts:40-43 honours both.
--     8. Backfill "scope" from the arrays, which is lossless because the web
--        route's own branch defines the meaning:
--          route.ts:37-39  paths=[] AND tags=[]  -> revalidatePath('/', 'layout')
--                                                -> SITE
--          route.ts:40-43  otherwise             -> per-path and per-tag
--        so 0/0 = SITE, both non-empty = MIXED, paths only = PATHS, else TAGS.
--        Two callers write the empty/empty row deliberately and mean SITE:
--        revalidateWholeSite (actions/revalidation.ts:50-53) and publishSite
--        (actions/publish.ts:20-24, whose comment reads "an empty request
--        revalidates the whole site"). No caller writes a no-op row:
--        manualRevalidate returns early on nothing-valid
--        (actions/revalidation.ts:26-28).
--     9. ADD COLUMN "actorName" TEXT, backfilled from "AdminUser"."name", the
--        same denormalisation AuditEvent has carried since
--        20260728150000_add_audit_log. revalidation/page.tsx:41-46 hand-rolls
--        the join today and renders a raw uuid once an admin is deleted.
--    10. DROP INDEX "RevalidationLog_entityType_entityId_idx". Both columns are
--        written at six call sites and read by nothing.
--    11. Drop 'SYSTEM' from "RevalidationTrigger" by the rename-type / create /
--        cast / drop dance, since Postgres has no ALTER TYPE ... DROP VALUE. No
--        writer emits SYSTEM and the distinct set in /tmp/v2/data-facts.txt is
--        ('CONTENT_SAVE','FLAG_CHANGE','MANUAL'), so the cast cannot fail. The
--        whole dance is guarded on the label still being present, which makes a
--        second run a no-op instead of a pointless second table rewrite.
--
-- NOT IN THIS CLUSTER, on purpose. The v2 schema also gives these three tables
-- a real AdminUser relation each:
--     "MediaAsset_uploadedById_fkey"     + "MediaAsset_uploadedById_idx"
--     "FeatureFlag_updatedById_fkey"     + "FeatureFlag_updatedById_idx"
--     "RevalidationLog_actorId_fkey"     + "RevalidationLog_actorId_idx"
-- Those belong to 60-contact-admin.sql (changes.txt [21]: one cluster for all
-- six admin-id columns across five tables, including TrackedLink.createdById
-- and MessageReply.sentById). They are NOT created here, so this file ALONE
-- does not close the `prisma migrate diff` on those six objects.
--
-- SHARED OWNERSHIP, matching the note at 60-contact-admin.sql header item 3b:
-- that cluster also adds "FeatureFlag"."updatedByName" and
-- "RevalidationLog"."actorName", with the same backfill. Both sides are
-- ADD COLUMN IF NOT EXISTS plus a guarded UPDATE, so whichever runs first wins
-- and the other is a no-op. The two differ in one harmless way: 60 guards on
-- "IS NULL" and this file guards on "IS DISTINCT FROM a.name", so re-running
-- this one also repairs a name that has since changed in "AdminUser".
--
-- Either order works. Running 60 first means the three FKs and their indexes
-- already exist when this file runs: nothing here touches "actorId",
-- "updatedById" or "uploadedById", and the one table rewrite (step 12) simply
-- revalidates "RevalidationLog_actorId_fkey" on the way through. Running this
-- one first means 60's ADD CONSTRAINT scans a table that has already been
-- rewritten. The index-inventory expectations below are written for the
-- numbering's own order (60 before 70) and say so where it matters.
--
-- DATA. Grounded in /tmp/v2/data-facts.txt:
--   * "MediaAsset" is 2 rows, keys 'suite-one/1787423289561-...png' and
--     'uploads/1788024018255-...jpg', folders 'suite-one' and 'uploads' — both
--     already equal the prefix expression, so the CHECK is added VALID with no
--     repair UPDATE. Both rows carry uploadedById '2a88a037-...' and there are
--     no orphans.
--   * "FeatureFlag"."updatedById": 1 distinct value, no orphans. The row count
--     is NOT in data-facts.txt (schema-v2.md says nine keys), so every
--     assertion below is written as an invariant or against a preflight
--     snapshot rather than against a hard-coded number.
--   * "RevalidationLog"."actorId": 1 distinct value, no orphans.
--     "trigger" holds only CONTENT_SAVE, FLAG_CHANGE and MANUAL.
--     "status" holds only SUCCESS. Row count not stated.
--   * "AdminUser"."name" is TEXT NOT NULL (20260308072119_add_admin_user), so
--     every backfilled name is non-NULL wherever the id is non-NULL.
--
-- TRANSACTIONALITY. Every statement in this file is transactional and the file
-- is meant to run as BEGIN; \i 70-media-flags-reval.sql; COMMIT;. Nothing here
-- needs to run outside a transaction:
--   * CREATE INDEX without CONCURRENTLY is transactional (and CONCURRENTLY is
--     pointless on a 2-row table on a branch with no traffic).
--   * DROP INDEX without CONCURRENTLY is transactional.
--   * CREATE TYPE "RevalidationScope" is in this transaction, so its labels are
--     usable immediately in the same transaction — the "unsafe use of new value
--     of enum type" rule applies to ALTER TYPE ... ADD VALUE on a pre-existing
--     type, which this file does not do.
--   * The RevalidationTrigger dance is rename + create + ALTER COLUMN TYPE +
--     drop, all transactional; the ALTER COLUMN TYPE takes ACCESS EXCLUSIVE and
--     rewrites the table and its indexes, which on this table is instantaneous.
--   * The only non-transactional statement in this file's ROLLBACK is
--     ALTER TYPE ... ADD VALUE 'SYSTEM'. On PG12+ that is allowed inside a
--     transaction, but the restored label cannot be USED until after COMMIT.
--
-- ROLLBACK. If the transaction is still open, ROLLBACK. After COMMIT, this
-- reverses it (run in one transaction, in this order):
--
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
--   DROP INDEX IF EXISTS "MediaAsset_key_prefix_idx";
--   CREATE INDEX "MediaAsset_folder_createdAt_idx" ON "MediaAsset" ("folder", "createdAt");
--
--   ALTER TABLE "FeatureFlag" ADD COLUMN "label" TEXT, ADD COLUMN "description" TEXT;
--   -- then refill from the code registry and only then restore NOT NULL:
--   --   cd packages/db && bun run flags:seed        (rewrites label + description)
--   ALTER TABLE "FeatureFlag" ALTER COLUMN "label" SET NOT NULL;
--   ALTER TABLE "FeatureFlag" DROP COLUMN "updatedByName";
--   -- NOTE: the seed only knows the nine registry keys. A row whose key is not
--   -- in FLAG_DEFINITIONS cannot have its label restored by any automated
--   -- means; preflight P7 dumps those values so they exist in the run log.
--
--   ALTER TABLE "RevalidationLog" DROP COLUMN "scope", DROP COLUMN "actorName";
--   CREATE INDEX "RevalidationLog_entityType_entityId_idx"
--     ON "RevalidationLog" ("entityType", "entityId");
--   ALTER TYPE "RevalidationTrigger" ADD VALUE IF NOT EXISTS 'SYSTEM';
--     -- appends last, which is exactly where 20260821130000 had it, so the
--     -- label order comes back byte-identical
--   DROP TYPE IF EXISTS "RevalidationScope";
--
-- The DROP TYPE only succeeds once no column references it, so it must come
-- after the DROP COLUMN "scope".
--
-- ============================================================================


-- ============================================================================
-- PREFLIGHT
-- Plain SELECTs. They write nothing except the two temp snapshot tables, which
-- exist so the verification block can prove nothing was lost without
-- hard-coding row counts that /tmp/v2/data-facts.txt does not state.
-- ============================================================================

-- P1. "MediaAsset"."folder" already satisfies the CHECK about to be added.
--     data-facts.txt: key='suite-one/...' folder='suite-one', and
--     key='uploads/...' folder='uploads'.
--     EXPECTED: 0 rows. Any row here would abort the ADD CONSTRAINT. Repair the
--     row rather than weakening the expression: "folder" is derived, so a
--     mismatch means a writer bypassed folderOfKey.
SELECT "id",
       "key",
       "folder" AS "storedFolder",
       COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads') AS "derivedFolder"
  FROM "MediaAsset"
 WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads')
 ORDER BY "key";

-- P2. The full index inventory on "MediaAsset" before the change.
--     EXPECTED: 4 rows, or 5 if 60-contact-admin.sql has already run —
--       MediaAsset_createdAt_idx         | CREATE INDEX ... ("createdAt")
--       MediaAsset_folder_createdAt_idx  | CREATE INDEX ... ("folder", "createdAt")   <- dropped below
--       MediaAsset_key_key               | CREATE UNIQUE INDEX ... ("key")
--       MediaAsset_pkey                  | CREATE UNIQUE INDEX ... ("id")
--       MediaAsset_uploadedById_idx      | only if 60-contact-admin.sql ran first
--     "MediaAsset_key_prefix_idx" must be absent on a first run. This cluster
--     neither creates nor drops "MediaAsset_uploadedById_idx".
SELECT "indexname", "indexdef"
  FROM "pg_indexes"
 WHERE "schemaname" = current_schema()
   AND "tablename" = 'MediaAsset'
 ORDER BY "indexname";

-- P3. No CHECK constraint exists on any of the three tables yet, so the name
--     "MediaAsset_folder_check" is free and nothing else is about to be
--     clobbered by the DROP-then-ADD below.
--     EXPECTED: 0 rows.
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition"
  FROM "pg_constraint" c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"MediaAsset"'::regclass,
                        '"FeatureFlag"'::regclass,
                        '"RevalidationLog"'::regclass)
 ORDER BY 1, 2;

-- P4. The two indexes this cluster drops have never been scanned.
--     EXPECTED, on PRODUCTION: 2 rows, both idx_scan = 0.
--     READ THIS ONE ON PRODUCTION (read-only), NOT on the branch. A Neon child
--     branch boots a fresh compute, and pg_stat_* counters live in that
--     compute's stats, not in the copied pages: on the branch both rows read 0
--     no matter what production does, so the assertion is vacuous there. This
--     is the same "confirm idx_scan = 0 first" gate plan.txt step 25 asks for.
SELECT "relname" AS "table", "indexrelname" AS "index", "idx_scan", "idx_tup_read"
  FROM "pg_stat_user_indexes"
 WHERE "indexrelname" IN ('MediaAsset_folder_createdAt_idx',
                          'RevalidationLog_entityType_entityId_idx')
 ORDER BY "indexrelname";

-- P5. Column starting state on "FeatureFlag".
--     EXPECTED: 8 rows —
--       createdAt   | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       description | text                        | YES | (null)   <- dropped below
--       enabled     | boolean                     | NO  | true
--       key         | text                        | NO  | (null)
--       label       | text                        | NO  | (null)   <- dropped below
--       note        | text                        | YES | (null)
--       updatedAt   | timestamp without time zone | NO  | (null)
--       updatedById | text                        | YES | (null)
--     "updatedByName" must be absent on a first run. Note "label" is NOT NULL
--     today (20260821140000_add_feature_flags/migration.sql:7), which is why
--     the rollback re-adds it nullable and only restores NOT NULL after the
--     seed has refilled it.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'FeatureFlag'
 ORDER BY "column_name";

-- P6. Every "FeatureFlag" row's key is one of the nine keys in FLAG_DEFINITIONS
--     (packages/shared/src/flags.ts:1-10). This is the assertion that makes the
--     "label"/"description" drop information-preserving: for a registry key the
--     text lives in code and `bun run flags:seed` can reproduce it, for any
--     other key it cannot.
--     EXPECTED: 0 rows. If a row comes back, the values in P7 are the only copy
--     and the DDL below destroys them — decide deliberately, then proceed. The
--     seed leaves such rows alone by design (seed-flags.ts:37-42), so they can
--     legitimately exist.
SELECT "key", "label", "description"
  FROM "FeatureFlag"
 WHERE "key" NOT IN ('section.about',
                     'section.skills',
                     'section.experience',
                     'section.projects',
                     'section.blogs',
                     'section.contact',
                     'contact.form',
                     'analytics.enabled',
                     'easter-eggs.enabled')
 ORDER BY "key";

-- P7. DUMP the two columns that are about to be dropped. Keep this output in
--     the run log: it is the paper record of what left the database.
--     EXPECTED: one row per "FeatureFlag" row (schema-v2.md says nine; the
--     count is not in data-facts.txt), each "label"/"description" pair
--     byte-identical to its FLAG_DEFINITIONS entry.
SELECT "key", "label", "description"
  FROM "FeatureFlag"
 ORDER BY "key";

-- P8. Both denormalisation sources resolve. data-facts.txt says 1 distinct
--     "updatedById", 1 distinct "actorId", orphans=none on both.
--     EXPECTED: 1 row — 0 | 0
--     A non-zero count is not a blocker for this cluster (the backfill simply
--     leaves that row's name NULL), but it IS a blocker for the AdminUser-FK
--     cluster, so surface it here.
SELECT (SELECT count(*) FROM "FeatureFlag" f
          WHERE f."updatedById" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = f."updatedById")) AS "orphanFlagActors",
       (SELECT count(*) FROM "RevalidationLog" l
          WHERE l."actorId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = l."actorId")) AS "orphanLogActors";

-- P9. No row holds 'SYSTEM'. This is the zero-row assertion schema-v2.md
--     requires before the type recreation.
--     data-facts.txt: RevalidationLog.trigger = CONTENT_SAVE, FLAG_CHANGE, MANUAL.
--     EXPECTED: 0 rows.
SELECT "id", "trigger"::text AS "trigger", "createdAt"
  FROM "RevalidationLog"
 WHERE "trigger"::text = 'SYSTEM'
 ORDER BY "createdAt";

-- P10. The enum starting state.
--      EXPECTED: 5 rows on a first run, in this order —
--        RevalidationTrigger | MANUAL            | 1
--        RevalidationTrigger | CONTENT_SAVE      | 2
--        RevalidationTrigger | SCHEDULED_PUBLISH | 3
--        RevalidationTrigger | FLAG_CHANGE       | 4
--        RevalidationTrigger | SYSTEM            | 5
--      "RevalidationScope" must not exist yet, and neither must a leftover
--      "RevalidationTrigger_old" from a half-finished earlier attempt. If
--      "RevalidationTrigger_old" is present, stop and clean it up by hand: the
--      guarded dance below will not touch it.
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM "pg_type" t
  JOIN "pg_enum" e ON e."enumtypid" = t."oid"
  JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" IN ('RevalidationTrigger', 'RevalidationTrigger_old', 'RevalidationScope')
 ORDER BY t."typname", e."enumsortorder";

-- P11. Column starting state on "RevalidationLog", plus the index inventory.
--      EXPECTED columns: 12 rows, the old column list from data-facts.txt
--      (id, paths, tags, trigger, entityType, entityId, actorId, status,
--      httpStatus, durationMs, error, createdAt) — "scope" and "actorName"
--      absent on a first run. "paths" and "tags" are nullable TEXT[] with no
--      default, which is what Prisma emits for a scalar list and is why the
--      backfill below wraps cardinality() in COALESCE.
SELECT "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'RevalidationLog'
 ORDER BY "column_name";

--      EXPECTED indexes: 5 rows (6 and 7 if 60-contact-admin.sql ran first) —
--        FeatureFlag_pkey
--        FeatureFlag_updatedById_idx               only if 60 ran first
--        RevalidationLog_actorId_idx               only if 60 ran first
--        RevalidationLog_createdAt_idx
--        RevalidationLog_entityType_entityId_idx   <- dropped below
--        RevalidationLog_pkey
--        RevalidationLog_status_createdAt_idx
SELECT "indexname", "indexdef"
  FROM "pg_indexes"
 WHERE "schemaname" = current_schema()
   AND "tablename" IN ('RevalidationLog', 'FeatureFlag')
 ORDER BY "tablename", "indexname";

-- P12. Row-count and shape snapshot. data-facts.txt gives a count for
--      "MediaAsset" (2) but not for "FeatureFlag" or "RevalidationLog", so the
--      verification compares against this snapshot instead of a literal.
--      "namedActors" is the non-NULL count of each table's AdminUser id column:
--      for "FeatureFlag" and "RevalidationLog" it is how many rows must end up
--      with a denormalised name, and for "MediaAsset" (which gains no name
--      column) it is only the invariant that this cluster did not disturb
--      "uploadedById".
--      EXPECTED: 3 rows — MediaAsset 2 | 2 ; FeatureFlag <n> | <m> ;
--      RevalidationLog <n> | <m>
DROP TABLE IF EXISTS "_pre70_counts";
CREATE TEMP TABLE "_pre70_counts" AS
SELECT 'MediaAsset' AS "table", count(*) AS "rows", count("uploadedById") AS "namedActors" FROM "MediaAsset"
UNION ALL
SELECT 'FeatureFlag', count(*), count("updatedById") FROM "FeatureFlag"
UNION ALL
SELECT 'RevalidationLog', count(*), count("actorId") FROM "RevalidationLog";

SELECT * FROM "_pre70_counts" ORDER BY "table";

-- P13. The trigger histogram, before the type is recreated. The cast below goes
--      through ::text, so a label that silently changed meaning would show up
--      here as a moved count. data-facts.txt confirms only three labels are in
--      use; the numbers themselves are not stated.
--      EXPECTED: 3 rows — CONTENT_SAVE | <n> , FLAG_CHANGE | <n> , MANUAL | <n>
DROP TABLE IF EXISTS "_pre70_triggers";
CREATE TEMP TABLE "_pre70_triggers" AS
SELECT "trigger"::text AS "trigger", count(*) AS "rows"
  FROM "RevalidationLog"
 GROUP BY 1;

SELECT * FROM "_pre70_triggers" ORDER BY "trigger";

-- P14. Nothing but the one column depends on "RevalidationTrigger". This is the
--      assertion that makes the rename/cast dance safe: ALTER COLUMN TYPE
--      refuses to run if a view, matview or rule reads the column, and a
--      function or default expression typed against the old type would be left
--      pointing at "RevalidationTrigger_old" after the rename.
--      deptype 'i' is excluded because that is the internal dependency of the
--      array type _RevalidationTrigger, which Postgres renames along with it.
--      EXPECTED: 1 row —
--        column trigger of table RevalidationLog | n
SELECT pg_describe_object(d."classid", d."objid", d."objsubid") AS "dependent",
       d."deptype"
  FROM "pg_depend" d
  JOIN "pg_type" t ON t."oid" = d."refobjid"
  JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" = 'RevalidationTrigger'
   AND d."deptype" <> 'i'
 ORDER BY 1;

--      And no view or materialised view exists in the schema at all, which is
--      the same fact from the other side. Prisma creates none.
--      EXPECTED: 0 rows.
SELECT c."relname" AS "object", c."relkind"
  FROM "pg_class" c
  JOIN "pg_namespace" n ON n."oid" = c."relnamespace"
 WHERE n."nspname" = current_schema()
   AND c."relkind" IN ('v', 'm')
 ORDER BY 1;

-- P15. Fail-closed gate. Only here because running the whole file in one
--      transaction means nobody gets to read P1 and P9 before the DDL
--      executes. It re-asserts exactly the two conditions that would make a
--      later statement fail halfway, and nothing else: an off-registry flag key
--      (P6) is a judgement call, not an error, so it warns instead of
--      aborting. Delete this block if the preflight is being run by hand as a
--      separate step.
DO $$
DECLARE
  "badFolders"  bigint;
  "systemRows"  bigint;
  "offRegistry" bigint;
BEGIN
  SELECT count(*) INTO "badFolders"
    FROM "MediaAsset"
   WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads');

  IF "badFolders" > 0 THEN
    RAISE EXCEPTION
      '70-media-flags-reval: % MediaAsset row(s) whose folder is not the prefix of key. Run preflight P1 and repair the rows; do not weaken the CHECK.', "badFolders";
  END IF;

  SELECT count(*) INTO "systemRows"
    FROM "RevalidationLog"
   WHERE "trigger"::text = 'SYSTEM';

  IF "systemRows" > 0 THEN
    RAISE EXCEPTION
      '70-media-flags-reval: % RevalidationLog row(s) still hold trigger SYSTEM. The label cannot be dropped while a row uses it - decide what those rows should become first (P9).', "systemRows";
  END IF;

  SELECT count(*) INTO "offRegistry"
    FROM "FeatureFlag"
   WHERE "key" NOT IN ('section.about', 'section.skills', 'section.experience',
                       'section.projects', 'section.blogs', 'section.contact',
                       'contact.form', 'analytics.enabled', 'easter-eggs.enabled');

  IF "offRegistry" > 0 THEN
    RAISE WARNING
      '70-media-flags-reval: % FeatureFlag row(s) have a key outside FLAG_DEFINITIONS. Their label/description are being dropped and the seed cannot restore them - preflight P7 is the only copy.', "offRegistry";
  END IF;
END $$;


-- ============================================================================
-- DDL AND DML, in dependency order
-- ============================================================================

-- ---------------------------------------------------------------------------
-- MediaAsset
-- ---------------------------------------------------------------------------

-- 1. Drop the folder index first, so the CHECK that replaces its only
--    justification is added against one fewer object, and so nothing rebuilds
--    it later in this transaction. IF EXISTS makes a re-run a no-op.
DROP INDEX IF EXISTS "MediaAsset_folder_createdAt_idx";

-- 2. The prefix index. Name and shape are copied from what Prisma 7 emits for
--    @@index([key(ops: raw("text_pattern_ops"))], map: "MediaAsset_key_prefix_idx"),
--    which is the same form 20260803120000_add_notes/migration.sql:78 already
--    uses for "NoteNode_path_prefix_idx". Not CONCURRENTLY: this must stay
--    inside the transaction, and the table is 2 rows.
CREATE INDEX IF NOT EXISTS "MediaAsset_key_prefix_idx"
  ON "MediaAsset" ("key" text_pattern_ops);

-- 3. The folder CHECK. DROP-then-ADD because ADD CONSTRAINT has no
--    IF NOT EXISTS, and the DROP is the only way to keep this statement
--    re-runnable inside one transaction.
--    Added VALID, not NOT VALID + VALIDATE: the "add it NOT VALID first" rule
--    in schema-v2.md is for busy tables, and this one is 2 rows on a branch
--    with no traffic, so the full-table verification scan is free.
--    Consequence worth knowing: an INSERT that supplies a "key" in a non-default
--    folder but lets "folder" fall back to its DEFAULT 'uploads' now fails with
--    a raw constraint violation. All three writers already pass
--    folder: folderOfKey(key) (actions/media.ts:241,
--    actions/media-browser.ts:506, :804), so no live path is affected.
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_folder_check"
  CHECK ("folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads'));

-- ---------------------------------------------------------------------------
-- FeatureFlag
-- ---------------------------------------------------------------------------

-- 4. The denormalised actor name. Nullable with no default, matching
--    `updatedByName String?`: NULL means "no actor recorded", which is the
--    state of every row the seed created and no operator has since touched.
ALTER TABLE "FeatureFlag"
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

-- 5. Backfill. Only rows whose "updatedById" resolves get a name; P8 asserts
--    there are no unresolvable ones. IS DISTINCT FROM keeps a re-run from
--    writing rows it already agrees with.
UPDATE "FeatureFlag" f
   SET "updatedByName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = f."updatedById"
   AND f."updatedByName" IS DISTINCT FROM a."name";

-- 6. Drop the two definition columns. The state store keeps only what the
--    registry cannot answer: enabled, note, who, when. P7 is the dump.
ALTER TABLE "FeatureFlag"
  DROP COLUMN IF EXISTS "label",
  DROP COLUMN IF EXISTS "description";

-- ---------------------------------------------------------------------------
-- RevalidationLog
-- ---------------------------------------------------------------------------

-- 7. The new scope enum. Postgres has no CREATE TYPE ... IF NOT EXISTS, hence
--    the guard. Label order is the schema's declaration order, which is also
--    what ORDER BY "scope" will mean from now on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "pg_type" t
      JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'RevalidationScope'
       AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "RevalidationScope" AS ENUM ('SITE', 'TAGS', 'PATHS', 'MIXED');
  END IF;
END $$;

-- 8. The two new columns. Both nullable, no default — see the header for why
--    "scope" must not be NOT NULL.
ALTER TABLE "RevalidationLog"
  ADD COLUMN IF NOT EXISTS "scope" "RevalidationScope",
  ADD COLUMN IF NOT EXISTS "actorName" TEXT;

-- 9. Backfill "scope" from the arrays. COALESCE around cardinality() because
--    both array columns are nullable with no default: cardinality(NULL) is
--    NULL, not 0, and a NULL array here means the same thing an empty one does
--    (revalidation.ts:37-38 coalesces both to [] before writing, and
--    route.ts:12-13 defaults both to [] on read).
--    WHERE "scope" IS NULL so a re-run never rewrites a value the application
--    has since written itself.
UPDATE "RevalidationLog"
   SET "scope" = CASE
     WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
     WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
     WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
     ELSE                                                                                     'TAGS'
   END::"RevalidationScope"
 WHERE "scope" IS NULL;

-- 10. Backfill "actorName", same shape as step 5.
UPDATE "RevalidationLog" l
   SET "actorName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = l."actorId"
   AND l."actorName" IS DISTINCT FROM a."name";

-- 11. Drop the unread index. Done BEFORE the type recreation so the rewrite in
--     step 12 has one fewer index to rebuild.
DROP INDEX IF EXISTS "RevalidationLog_entityType_entityId_idx";

-- 12. Drop 'SYSTEM' from "RevalidationTrigger": rename the old type out of the
--     way, create the four-label type under the real name, re-type the column
--     through ::text, drop the old type.
--     The whole dance is guarded on 'SYSTEM' still existing, which makes a
--     second run a genuine no-op rather than a second ALTER COLUMN TYPE table
--     rewrite. The cast is written ::text::"RevalidationTrigger" so it is
--     label-preserving and would raise 22P02 rather than coerce if an
--     unexpected label existed — P9 and P15 have already ruled that out, and
--     P14 has ruled out a dependent view that would refuse the retype outright.
--     The column has no DEFAULT (20260821130000_add_revalidation_log:17), so
--     there is no default expression to drop and restore, unlike the
--     SiteVersion retypes in cluster 20.
--     DDL inside PL/pgSQL is executed, not planned, at block run time, so the
--     new type created two statements earlier resolves normally.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "pg_type" t
      JOIN "pg_enum" e ON e."enumtypid" = t."oid"
      JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'RevalidationTrigger'
       AND n."nspname" = current_schema()
       AND e."enumlabel" = 'SYSTEM'
  ) THEN
    ALTER TYPE "RevalidationTrigger" RENAME TO "RevalidationTrigger_old";

    CREATE TYPE "RevalidationTrigger" AS ENUM (
      'MANUAL', 'CONTENT_SAVE', 'SCHEDULED_PUBLISH', 'FLAG_CHANGE'
    );

    ALTER TABLE "RevalidationLog"
      ALTER COLUMN "trigger" TYPE "RevalidationTrigger"
      USING "trigger"::text::"RevalidationTrigger";

    DROP TYPE "RevalidationTrigger_old";
  END IF;
END $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- V1. "MediaAsset" index inventory.
--     EXPECTED: 4 rows, plus "MediaAsset_uploadedById_idx" if
--     60-contact-admin.sql has already run —
--       MediaAsset_createdAt_idx   | CREATE INDEX ... USING btree ("createdAt")
--       MediaAsset_key_key         | CREATE UNIQUE INDEX ... USING btree ("key")
--       MediaAsset_key_prefix_idx  | CREATE INDEX ... USING btree ("key" text_pattern_ops)
--       MediaAsset_pkey            | CREATE UNIQUE INDEX ... USING btree ("id")
--     "MediaAsset_folder_createdAt_idx" must be gone. The text_pattern_ops
--     opclass MUST appear in the prefix index's definition: without it the
--     index is a duplicate of the unique and still cannot serve LIKE 'prefix%'.
SELECT "indexname", "indexdef"
  FROM "pg_indexes"
 WHERE "schemaname" = current_schema()
   AND "tablename" = 'MediaAsset'
 ORDER BY "indexname";

-- V2. The folder CHECK exists, under the expected name, and holds.
--     EXPECTED: 1 row —
--       MediaAsset | MediaAsset_folder_check | CHECK ((folder = COALESCE(NULLIF(regexp_replace(key, '/[^/]*$'::text, ''::text), key), 'uploads'::text))) | t
--     pg_get_constraintdef prints folder and key unquoted: both are lowercase
--     and key is an unreserved keyword, so neither needs quoting on the way
--     back out. The last column is convalidated: it must be t (true), i.e. the
--     existing rows were verified, not merely trusted.
SELECT c."conrelid"::regclass::text AS "table",
       c."conname",
       pg_get_constraintdef(c."oid") AS "definition",
       c."convalidated"
  FROM "pg_constraint" c
 WHERE c."contype" = 'c'
   AND c."conrelid" IN ('"MediaAsset"'::regclass,
                        '"FeatureFlag"'::regclass,
                        '"RevalidationLog"'::regclass)
 ORDER BY 1, 2;

-- V3. And it holds on data, not just on paper.
--     EXPECTED: 1 row — 2 | 2
--     ("MediaAsset" is 2 rows per data-facts.txt, and both agree with the
--     derivation, so "rows" and "folderMatches" must both read 2.)
SELECT count(*) AS "rows",
       count(*) FILTER (
         WHERE "folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads')
       ) AS "folderMatches"
  FROM "MediaAsset";

-- V4. "FeatureFlag" column list.
--     EXPECTED: 7 rows — createdAt, enabled, key, note, updatedAt,
--     updatedById, updatedByName. "label" and "description" must be absent,
--     and "updatedByName" must be nullable text with no default.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'FeatureFlag'
 ORDER BY "column_name";

-- V5. The flag denormalisation agrees with "AdminUser", in both directions.
--     EXPECTED: 0 rows. A row here means either a name that does not match its
--     id, or a name recorded against no id at all.
SELECT f."key", f."updatedById", f."updatedByName", a."name" AS "adminName"
  FROM "FeatureFlag" f
  LEFT JOIN "AdminUser" a ON a."id" = f."updatedById"
 WHERE f."updatedByName" IS DISTINCT FROM a."name"
 ORDER BY f."key";

-- V6. Every row that had an actor id now has a name, and no row without one
--     invented a name.
--     EXPECTED: 1 row where "namedActors" equals the "namedActors" recorded for
--     FeatureFlag in P12, and "namelessWithActor" = 0.
SELECT count("updatedById") AS "namedActors",
       count("updatedByName") AS "namesWritten",
       count(*) FILTER (WHERE "updatedById" IS NOT NULL AND "updatedByName" IS NULL) AS "namelessWithActor",
       count(*) FILTER (WHERE "updatedById" IS NULL AND "updatedByName" IS NOT NULL) AS "nameWithoutActor"
  FROM "FeatureFlag";

-- V7. "RevalidationTrigger" has exactly four labels, in the schema's
--     declaration order, and no renamed leftover type survives.
--     EXPECTED: 4 rows —
--       RevalidationTrigger | MANUAL            | 1
--       RevalidationTrigger | CONTENT_SAVE      | 2
--       RevalidationTrigger | SCHEDULED_PUBLISH | 3
--       RevalidationTrigger | FLAG_CHANGE       | 4
--     Nothing named "RevalidationTrigger_old" may appear.
SELECT t."typname", e."enumlabel", e."enumsortorder"
  FROM "pg_type" t
  JOIN "pg_enum" e ON e."enumtypid" = t."oid"
  JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
 WHERE n."nspname" = current_schema()
   AND t."typname" IN ('RevalidationTrigger', 'RevalidationTrigger_old')
 ORDER BY t."typname", e."enumsortorder";

-- V8. "RevalidationScope" exists with four labels in declaration order.
--     EXPECTED: 4 rows — SITE | 1 , TAGS | 2 , PATHS | 3 , MIXED | 4
SELECT e."enumlabel", e."enumsortorder"
  FROM "pg_type" t
  JOIN "pg_enum" e ON e."enumtypid" = t."oid"
  JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
 WHERE t."typname" = 'RevalidationScope'
   AND n."nspname" = current_schema()
 ORDER BY e."enumsortorder";

-- V9. "RevalidationLog" column shape.
--     EXPECTED: 14 rows. "scope" is USER-DEFINED / RevalidationScope / YES /
--     (null); "actorName" is text / YES / (null); "trigger" is USER-DEFINED /
--     RevalidationTrigger / NO / (null). Nothing else changed.
SELECT "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'RevalidationLog'
 ORDER BY "column_name";

-- V10. The scope backfill is complete and self-consistent.
--      EXPECTED: 0 rows. Any row is either an un-backfilled NULL or a value
--      that disagrees with the arrays it was derived from.
SELECT "id", "scope"::text AS "scope",
       COALESCE(cardinality("paths"), 0) AS "pathCount",
       COALESCE(cardinality("tags"), 0)  AS "tagCount"
  FROM "RevalidationLog"
 WHERE "scope" IS NULL
    OR "scope" <> CASE
         WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
         WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
         WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
         ELSE                                                                                     'TAGS'
       END::"RevalidationScope"
 ORDER BY "createdAt";

-- V11. The scope histogram.
--      EXPECTED: 2 rows — SITE | <n> and TAGS | <n>, summing to the
--      "RevalidationLog" row count in P12. PATHS and MIXED must not appear:
--      schema-v2.md records that no caller in the repo passes paths, so a
--      PATHS or MIXED row here means the fact base is wrong about the writers
--      and is worth reading before continuing.
SELECT "scope"::text AS "scope", count(*) AS "rows"
  FROM "RevalidationLog"
 GROUP BY 1
 ORDER BY 1;

-- V12. The log's actor denormalisation, same assertion as V5.
--      EXPECTED: 0 rows.
SELECT l."id", l."actorId", l."actorName", a."name" AS "adminName"
  FROM "RevalidationLog" l
  LEFT JOIN "AdminUser" a ON a."id" = l."actorId"
 WHERE l."actorName" IS DISTINCT FROM a."name"
 ORDER BY l."createdAt";

-- V13. "RevalidationLog" and "FeatureFlag" index inventory.
--      EXPECTED: 4 rows, plus the two FK indexes if 60-contact-admin.sql has
--      already run —
--        FeatureFlag     | FeatureFlag_pkey
--        FeatureFlag     | FeatureFlag_updatedById_idx      only if 60 ran first
--        RevalidationLog | RevalidationLog_actorId_idx      only if 60 ran first
--        RevalidationLog | RevalidationLog_createdAt_idx
--        RevalidationLog | RevalidationLog_pkey
--        RevalidationLog | RevalidationLog_status_createdAt_idx
--      "RevalidationLog_entityType_entityId_idx" must be gone. If the two FK
--      indexes are missing, that is 60-contact-admin.sql still owing them, not
--      a fault in this cluster.
SELECT "tablename", "indexname", "indexdef"
  FROM "pg_indexes"
 WHERE "schemaname" = current_schema()
   AND "tablename" IN ('RevalidationLog', 'FeatureFlag')
 ORDER BY "tablename", "indexname";

-- V14. Nothing was lost. Compares against the P12 snapshot.
--      EXPECTED: 0 rows.
WITH "post" AS (
  SELECT 'MediaAsset' AS "table", count(*) AS "rows", count("uploadedById") AS "namedActors" FROM "MediaAsset"
  UNION ALL
  SELECT 'FeatureFlag', count(*), count("updatedById") FROM "FeatureFlag"
  UNION ALL
  SELECT 'RevalidationLog', count(*), count("actorId") FROM "RevalidationLog"
)
SELECT b."table",
       b."rows" AS "rowsBefore",               p."rows" AS "rowsAfter",
       b."namedActors" AS "actorsBefore",      p."namedActors" AS "actorsAfter"
  FROM "_pre70_counts" b
  JOIN "post" p ON p."table" = b."table"
 WHERE b."rows" <> p."rows"
    OR b."namedActors" <> p."namedActors";

-- V15. No trigger label moved during the type recreation. Compares against the
--      P13 snapshot, and a FULL JOIN so a label that appeared or vanished shows
--      up rather than being joined away.
--      EXPECTED: 0 rows.
WITH "post" AS (
  SELECT "trigger"::text AS "trigger", count(*) AS "rows"
    FROM "RevalidationLog"
   GROUP BY 1
)
SELECT COALESCE(b."trigger", p."trigger") AS "trigger",
       b."rows" AS "rowsBefore",
       p."rows" AS "rowsAfter"
  FROM "_pre70_triggers" b
  FULL JOIN "post" p ON p."trigger" = b."trigger"
 WHERE b."rows" IS DISTINCT FROM p."rows";

-- V16. The prefix index is actually usable by the query it exists for. Not an
--      equality assertion — with 2 rows the planner will pick a seq scan no
--      matter what, and that is correct — so this is EXPLAIN output to read,
--      not a pass/fail. On a table with real volume the plan must show
--      "Index Scan using MediaAsset_key_prefix_idx".
--      Run this one AFTER COMMIT if the transaction is being kept open.
EXPLAIN (COSTS OFF)
SELECT "key" FROM "MediaAsset" WHERE "key" LIKE 'uploads/%' ORDER BY "key";
