-- ============================================================================
-- PRODUCTION EXPAND  ·  cluster: media-flags-reval-github
-- Run this with the LIVE SITE UP and the CURRENTLY DEPLOYED v1 CODE RUNNING.
-- Everything here is additive or a relaxation. No column is dropped, no type is
-- narrowed, no constraint is added that a v1 writer can violate.
--
-- Postgres 17 / Neon. Role is the database OWNER, not a superuser.
-- Run as:   BEGIN; \i media-flags-reval-github-expand.sql  -- read the output
--           COMMIT;
--
-- WHAT IS DELIBERATELY *NOT* HERE, and why (all four are in the contract file):
--   * FeatureFlag.label / .description DROP  — three deployed v1 admin pages
--     call prisma.featureFlag.findMany() with no `select`, so the v1 client
--     emits an explicit column list that names both columns:
--       git show HEAD:apps/docs/app/(dashboard)/flags/page.tsx        :23
--       git show HEAD:apps/docs/app/(dashboard)/site-config/page.tsx  :19
--       git show HEAD:apps/docs/app/(dashboard)/terminal/page.tsx     :46
--     Dropping either column returns 42703, which Prisma raises as P2022, and
--     all three force-dynamic server components 500.
--   * RevalidationTrigger 'SYSTEM' drop — needs a type recreation, and the
--     ALTER COLUMN TYPE rewrites RevalidationLog under ACCESS EXCLUSIVE while
--     two live writers can be mid-statement (the log INSERT at
--     HEAD:apps/docs/app/lib/revalidation.ts:79 and the retention DELETE at
--     HEAD:packages/db/src/maintenance.ts:163-177, which fires off a *visitor*
--     beacon at HEAD:apps/web/app/api/collect/route.ts:99). No v1 or v2 writer
--     emits SYSTEM, so the narrowing is never urgent. It waits.
--   * GithubYear_handle_fkey — the deployed v1 refresh queues its GithubYear
--     upserts BEFORE the GithubProfile upsert inside one $transaction
--     (HEAD:apps/web/app/lib/github.ts:146-161), and that refresh runs off
--     public traffic (HEAD:apps/web/app/page.tsx:120-134 fires it in after()
--     on any homepage ISR regeneration). See the contract file.
--   * The two index DROPs. Keeping EXPAND purely additive makes its rollback
--     free of anything that has to be rebuilt.
--   * MediaAsset.url is NOT dropped by this cutover at all. The v2 schema still
--     declares `url String` (packages/db/prisma/schema.prisma:598) and the v2
--     code still writes it (apps/docs/app/lib/actions/media.ts:227,
--     media-browser.ts:495 and :804). Its drop is a THIRD stage after a LATER
--     code deploy.
--   * MediaAsset_uploadedById / FeatureFlag_updatedById / RevalidationLog_actorId
--     foreign keys and their indexes belong to the admin-FK cluster (60), not
--     here. The four MediaAsset back-relations are FKs on Project /
--     ProjectImage / Experience / Blog and belong to those clusters.
-- ============================================================================

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';


-- ============================================================================
-- PREFLIGHT  (plain SELECTs; nothing here writes)
-- ============================================================================

-- P1. MediaAsset.folder already equals the derived prefix on every row, so the
--     CHECK below can be added VALID. Expression is a literal transcription of
--     folderOfKey (packages/storage/src/media.ts, `at === -1 ? "uploads"`).
--     EXPECTED: 0 rows.
SELECT "id", "key", "folder" AS "stored",
       COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads') AS "derived"
  FROM "MediaAsset"
 WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads');

-- P2. Neither new name is taken, and the four objects EXPAND creates are absent.
--     EXPECTED: 0 rows.
SELECT 'MediaAsset_key_prefix_idx' AS "object"
 WHERE EXISTS (SELECT 1 FROM "pg_class" WHERE "relname" = 'MediaAsset_key_prefix_idx')
UNION ALL
SELECT 'MediaAsset_folder_check'
 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'MediaAsset_folder_check')
UNION ALL
SELECT 'RevalidationScope'
 WHERE EXISTS (SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
                WHERE t."typname" = 'RevalidationScope' AND n."nspname" = current_schema())
UNION ALL
SELECT 'RevalidationLog.scope'
 WHERE EXISTS (SELECT 1 FROM "information_schema"."columns"
                WHERE "table_schema" = current_schema()
                  AND "table_name" = 'RevalidationLog' AND "column_name" = 'scope');

-- P3. Both denormalisation sources resolve. data-facts.txt: 1 distinct
--     updatedById, 1 distinct actorId, orphans none on both.
--     EXPECTED: 1 row — 0 | 0
SELECT (SELECT count(*) FROM "FeatureFlag" f
         WHERE f."updatedById" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = f."updatedById")) AS "orphanFlagActors",
       (SELECT count(*) FROM "RevalidationLog" l
         WHERE l."actorId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = l."actorId")) AS "orphanLogActors";

-- P4. THE PAPER RECORD of what the contract file will destroy. Keep this output
--     in the run log. For the nine FLAG_DEFINITIONS keys these values are
--     reproducible from packages/shared/src/flags.ts; for any other key they
--     are not, and this is the only copy.
SELECT "key", "label", "description",
       ("key" NOT IN ('section.about','section.skills','section.experience',
                      'section.projects','section.blogs','section.contact',
                      'contact.form','analytics.enabled','easter-eggs.enabled')) AS "offRegistry"
  FROM "FeatureFlag" ORDER BY "key";

-- P5. Row counts, for the verification block. RevalidationLog is NOT frozen:
--     the retention prune (maintenance.ts:163-177) can delete rows at any
--     moment off a visitor beacon, so treat its count as a bound.
SELECT (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
       (SELECT count(*) FROM "FeatureFlag")     AS "flags",
       (SELECT count(*) FROM "RevalidationLog") AS "logs",
       (SELECT count("updatedById") FROM "FeatureFlag")     AS "flagsWithActor",
       (SELECT count("actorId") FROM "RevalidationLog")     AS "logsWithActor";

-- P6. Fail-closed gate on the one condition that would abort a statement below.
DO $$
DECLARE "bad" bigint;
BEGIN
  SELECT count(*) INTO "bad" FROM "MediaAsset"
   WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads');
  IF "bad" > 0 THEN
    RAISE EXCEPTION 'EXPAND aborted: % MediaAsset row(s) whose folder is not the prefix of key (preflight P1). Repair the rows; do not weaken the CHECK.', "bad";
  END IF;
END $$;


-- ============================================================================
-- 1. MediaAsset  ·  prefix index + folder CHECK
--
-- v1 IMPACT: none. The index is invisible to the application. The CHECK is
-- satisfied by every v1 write, verified exhaustively against all 14 v1
-- prisma.mediaAsset call sites in HEAD:
--   INSERT paths — both supply folder: folderOfKey(key):
--     HEAD:apps/docs/app/lib/actions/media.ts:237-245         (saveUpload create)
--     HEAD:apps/docs/app/lib/actions/media-browser.ts:504-507 (adopt create)
--   UPDATE paths that touch key — writes key and folder together:
--     HEAD:apps/docs/app/lib/actions/media-browser.ts:802-805 (relocate)
--   UPDATE paths that touch neither key nor folder (CHECK re-evaluated, passes):
--     media.ts:237 update branch (`update: shared`, no key/folder),
--     media.ts:339 (altText), media-browser.ts:935 (filename)
--   There is no v1 path that writes folder without key, and none that inserts
--   a row letting folder fall back to its DEFAULT 'uploads'.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "MediaAsset_key_prefix_idx"
  ON "MediaAsset" ("key" text_pattern_ops);
-- Not CONCURRENTLY: 2 rows, and CONCURRENTLY cannot run inside this
-- transaction. The ACCESS EXCLUSIVE window is microseconds.
-- NOTE: Prisma emits this same form for
-- @@index([key(ops: raw("text_pattern_ops"))], map: "MediaAsset_key_prefix_idx")
-- but `prisma migrate diff` reports text_pattern_ops indexes as pending
-- forever regardless; that is known drift, not a failure of this file.

ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_folder_check"
  CHECK ("folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads'));
-- Added VALID (2 rows, scan is free). Prisma cannot express a CHECK, so this
-- object never appears in target-ddl.sql and must be carried by hand forever.
-- Residual, accepted: if a writer ever did violate it, the failure is a raw
-- 23514 AFTER the bytes are already in R2 (the presigned PUT precedes
-- saveUpload), leaving a re-adoptable orphan object — not data loss.


-- ============================================================================
-- 2. FeatureFlag  ·  updatedByName, + relax label's NOT NULL
--
-- v1 IMPACT: none.
--   * The only v1 UPDATE names enabled / updatedById / note and nothing else
--     (HEAD:apps/docs/app/lib/actions/flags.ts:48-55), so it cannot collide
--     with a new column.
--   * The only v1 INSERT is the seed's upsert create, which always supplies
--     label (HEAD:packages/db/scripts/seed-flags.ts:14-22), so relaxing the
--     NOT NULL cannot let a NULL label appear while v1 is deployed. v1's reads
--     select label but never render it — the page takes its label from
--     FLAG_DEFINITIONS (HEAD:.../flags/page.tsx:41).
-- WHY relax label at all: the v2 seed inserts without it
-- (packages/db/scripts/seed-flags.ts:19, `create({ data: { key, enabled } })`).
-- Leaving label NOT NULL would make that seed fail 23502 in the whole gap
-- between DEPLOY and CONTRACT.
-- ============================================================================

ALTER TABLE "FeatureFlag" ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "FeatureFlag" f
   SET "updatedByName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = f."updatedById"
   AND f."updatedByName" IS DISTINCT FROM a."name";

ALTER TABLE "FeatureFlag" ALTER COLUMN "label" DROP NOT NULL;


-- ============================================================================
-- 3. RevalidationLog  ·  RevalidationScope + scope + actorName
--
-- v1 IMPACT: none.
--   * The v1 INSERT names 10 columns explicitly
--     (HEAD:apps/docs/app/lib/revalidation.ts:79-92), so both new columns are
--     simply omitted and take NULL. This is the whole reason `scope` is
--     nullable with no default: that INSERT sits inside a try whose catch
--     swallows everything (HEAD:.../revalidation.ts:109-111), so a NOT NULL
--     column with no default would silently lose the log row AND the TagState
--     upsert loop that follows it in the same try.
--   * Every v1 read lists only v1 columns, so added columns are invisible:
--     readRecentLogs   HEAD:apps/docs/app/lib/revalidation.ts:171
--     readHealth       HEAD:apps/docs/app/lib/revalidation.ts:134,139
--     stale detector   HEAD:apps/docs/app/lib/stale.ts:24 (select createdAt)
--     retention prune  HEAD:packages/db/src/maintenance.ts:167-175 (raw SQL,
--                      names only "id" and "createdAt")
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'RevalidationScope' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "RevalidationScope" AS ENUM ('SITE', 'TAGS', 'PATHS', 'MIXED');
  END IF;
END $$;

ALTER TABLE "RevalidationLog"
  ADD COLUMN IF NOT EXISTS "scope" "RevalidationScope",
  ADD COLUMN IF NOT EXISTS "actorName" TEXT;

-- Backfill scope. Lossless because the public route's own branch defines the
-- meaning: HEAD:apps/web/app/api/revalidate/route.ts:37-38 treats
-- paths=[] AND tags=[] as revalidatePath('/', 'layout') = whole site; :40-43
-- honours per-path and per-tag otherwise. COALESCE around cardinality()
-- because both array columns are nullable TEXT[] with no default.
UPDATE "RevalidationLog"
   SET "scope" = CASE
     WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
     WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
     WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
     ELSE                                                                                     'TAGS'
   END::"RevalidationScope"
 WHERE "scope" IS NULL;

UPDATE "RevalidationLog" l
   SET "actorName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = l."actorId"
   AND l."actorName" IS DISTINCT FROM a."name";


-- ============================================================================
-- VERIFICATION  (run before COMMIT)
-- ============================================================================

-- V1. The prefix index exists WITH the opclass. Without text_pattern_ops it is
--     a useless duplicate of MediaAsset_key_key.
--     EXPECTED: 1 row, indexdef containing "text_pattern_ops".
SELECT "indexname", "indexdef" FROM "pg_indexes"
 WHERE "schemaname" = current_schema() AND "indexname" = 'MediaAsset_key_prefix_idx';

-- V2. The CHECK exists and is convalidated = t (rows verified, not trusted).
--     EXPECTED: 1 row, convalidated = t.
SELECT c."conname", pg_get_constraintdef(c."oid") AS "definition", c."convalidated"
  FROM "pg_constraint" c
 WHERE c."conrelid" = '"MediaAsset"'::regclass AND c."contype" = 'c';

-- V3. And it holds on data. EXPECTED: 1 row — 2 | 2
SELECT count(*) AS "rows",
       count(*) FILTER (WHERE "folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads')) AS "folderMatches"
  FROM "MediaAsset";

-- V4. FeatureFlag shape. EXPECTED: 9 rows (the original 8 plus updatedByName:
--     createdAt, description, enabled, key, label, note, updatedAt, updatedById,
--     updatedByName). label is now is_nullable = YES,
--     description YES, updatedByName text / YES / (null). Nothing dropped.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'FeatureFlag'
 ORDER BY "column_name";

-- V5. Both denormalisations agree with AdminUser in both directions.
--     EXPECTED: 0 rows from each.
SELECT 'FeatureFlag' AS "table", f."key" AS "row", f."updatedById" AS "actorId", f."updatedByName" AS "name", a."name" AS "adminName"
  FROM "FeatureFlag" f LEFT JOIN "AdminUser" a ON a."id" = f."updatedById"
 WHERE f."updatedByName" IS DISTINCT FROM a."name"
UNION ALL
SELECT 'RevalidationLog', l."id", l."actorId", l."actorName", a."name"
  FROM "RevalidationLog" l LEFT JOIN "AdminUser" a ON a."id" = l."actorId"
 WHERE l."actorName" IS DISTINCT FROM a."name";

-- V6. Scope is complete and self-consistent. EXPECTED: 0 rows.
SELECT "id", "scope"::text AS "scope",
       COALESCE(cardinality("paths"), 0) AS "pathCount", COALESCE(cardinality("tags"), 0) AS "tagCount"
  FROM "RevalidationLog"
 WHERE "scope" IS NULL
    OR "scope" <> CASE
         WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
         WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
         WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
         ELSE                                                                                     'TAGS'
       END::"RevalidationScope";

-- V7. Scope histogram. EXPECTED: SITE and TAGS only. A PATHS or MIXED row means
--     the fact base is wrong about the writers (no repo caller passes paths).
SELECT "scope"::text AS "scope", count(*) AS "rows" FROM "RevalidationLog" GROUP BY 1 ORDER BY 1;

-- V8. Nothing was lost and no old object was touched. EXPECTED: MediaAsset 2,
--     FeatureFlag = P5, RevalidationLog >= P5 minus whatever the prune removed;
--     RevalidationTrigger still has 5 labels including SYSTEM; the two indexes
--     the contract file drops are still present; GithubYear_handle_fkey absent.
SELECT (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
       (SELECT count(*) FROM "FeatureFlag")     AS "flags",
       (SELECT count(*) FROM "RevalidationLog") AS "logs",
       (SELECT count(*) FROM "pg_enum" e JOIN "pg_type" t ON t."oid" = e."enumtypid"
         WHERE t."typname" = 'RevalidationTrigger')                       AS "triggerLabels",
       (SELECT count(*) FROM "pg_class"
         WHERE "relname" IN ('MediaAsset_folder_createdAt_idx',
                             'RevalidationLog_entityType_entityId_idx'))  AS "indexesStillThere",
       (SELECT count(*) FROM "pg_constraint"
         WHERE "conname" = 'GithubYear_handle_fkey')                      AS "githubFkYet";


-- ============================================================================
-- ROLLBACK  (after COMMIT; one transaction, this order)
--
--   ALTER TABLE "RevalidationLog" DROP COLUMN IF EXISTS "scope",
--                                 DROP COLUMN IF EXISTS "actorName";
--   DROP TYPE IF EXISTS "RevalidationScope";   -- must follow the DROP COLUMN
--   ALTER TABLE "FeatureFlag" DROP COLUMN IF EXISTS "updatedByName";
--   UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL;  -- see note
--   ALTER TABLE "FeatureFlag" ALTER COLUMN "label" SET NOT NULL;
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
--   DROP INDEX IF EXISTS "MediaAsset_key_prefix_idx";
--
-- The UPDATE is a guard, not an expectation: no v1 writer can produce a NULL
-- label, so it should affect 0 rows. If it affects any, the v2 seed ran in the
-- gap — restore the real text with `cd packages/db && bun run flags:seed` on
-- the v1 code before restoring NOT NULL.
--
-- Nothing in this file destroys anything, so the rollback needs no dump and no
-- reload. That is the point of keeping EXPAND additive.
-- ============================================================================
