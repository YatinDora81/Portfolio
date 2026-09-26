-- =====================================================================
-- PRODUCTION CUTOVER, cluster: projects
-- STAGE 3 of 3: CONTRACT.  Run this ONLY AFTER the v2 deploy is live and
-- confirmed. Nothing in here is safe while any v1 code can still run.
-- =====================================================================
--
-- PRECONDITIONS, all of them
--   1. The v2 commit is the current production deployment on BOTH Vercel
--      projects (apps/web and apps/docs). A half deploy is the one state
--      this stage cannot survive: dropping "images" while apps/web is
--      still on v1 takes the PUBLIC SITE down.
--   2. No in-flight v1 request can still be executing. Vercel routes new
--      requests to the new deployment atomically, but a request that
--      started on the old bundle can still be mid-render. Give it a
--      couple of minutes. A v1 render that regenerates the projects cache
--      after "images" is gone throws 42703 inside readProjects and
--      surfaces as a 500 on the homepage.
--   3. You have loaded https://yatindora.in and confirmed all six project
--      cards render their cover image, and loaded the admin project list
--      and confirmed the same. That is the only real proof that
--      "ProjectImage" carries what "images" used to.
--   4. STAGE E-FINAL (the resync at the bottom of projects-expand.sql)
--      ran immediately before the deploy, so
--      "_v2_backup_project_images" is current.
--
-- WHY EACH STATEMENT COULD NOT HAVE GONE IN EXPAND
--
--   DROP TRIGGER / DROP FUNCTION
--       The shim exists precisely to serve v1. It has to outlive EXPAND
--       and it must not outlive v1 by long. It is inert under v2 (v2
--       never names "images" in an UPDATE, and its INSERT leaves the
--       column '{}' so the INSERT trigger's WHEN gate is false), so
--       leaving it up between DEPLOY and CONTRACT is harmless.
--       It must be dropped EXPLICITLY, and BEFORE the next statement,
--       and the order is not a style preference:
--         - the UPDATE trigger names "images" in its UPDATE OF list.
--           Postgres records that as a DEPENDENCY_AUTO edge on the column,
--           so DROP COLUMN takes the trigger with it silently.
--         - the INSERT trigger names "images" only in its WHEN clause and
--           inside the plpgsql function body. plpgsql bodies are not
--           dependency-tracked at all, and the WHEN clause is stored as a
--           parsed expression rather than as a tracked column reference.
--           If that trigger survives the DROP COLUMN - and you should not
--           be finding out in production whether it does - then the very
--           next v2 createProject INSERT into "Project" aborts at runtime
--           on the missing field, which means the admin cannot create a
--           project at all. C2 below asserts both are gone.
--
--   ALTER TABLE "Project" DROP COLUMN "images"
--       Breaks three distinct v1 code paths, all read at git HEAD:
--         apps/web/app/lib/data.ts:238   readProjects uses `include:` with
--             no `select:`, so Prisma emits the full scalar column list
--             for "Project" and the SELECT fails 42703 undefined_column.
--             This is the PUBLIC SITE. Non-negotiable.
--         apps/docs/app/lib/actions/projects.ts:43 and :75
--             createProject and updateProject both set
--             images: data.images.filter(Boolean). Both fail.
--         apps/docs/app/lib/media-references.ts:22
--             select: { title, logoUrl, images } - the media orphan scan
--             that decides whether an R2 object is safe to delete. Fails,
--             which would leave the admin unable to reason about deletes.
--       v2 reads none of them: readProjects at apps/web/app/lib/data.ts:226
--       reads gallery.externalUrl / gallery.asset.url, and updateProject
--       at apps/docs/app/lib/actions/projects.ts:88 deleteMany +
--       createMany on projectImage.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout      = '3s';
SET LOCAL statement_timeout = '60s';


-- ---------------------------------------------------------------------
-- 0. GATE. Refuse to drop the column if the gallery does not look like
--    it took over.
--
--    The "lost gallery" test compares the array against ProjectImage per
--    project. A project whose array is non-empty but which now has zero
--    ProjectImage rows is either a gallery that never migrated or one a
--    v2 admin deliberately emptied. Those two are indistinguishable in
--    SQL, so this stops and makes you look. If you emptied it on purpose,
--    clear that project's backup row first:
--        UPDATE "_v2_backup_project_images" SET "images" = '{}'
--         WHERE "projectId" = '<id>';
--    and re-run.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    lost     bigint;
    unbacked bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'Project'
                      AND column_name = 'images') THEN
        RAISE NOTICE 'Project."images" is already gone; CONTRACT has already run';
        RETURN;
    END IF;

    IF to_regclass('public."ProjectImage"') IS NULL THEN
        RAISE EXCEPTION 'ProjectImage does not exist - EXPAND never ran, do not drop the array';
    END IF;

    IF to_regclass('public."_v2_backup_project_images"') IS NULL THEN
        RAISE EXCEPTION 'the array backup table is missing; DROP COLUMN would be irreversible';
    END IF;

    SELECT count(*) INTO unbacked
      FROM "Project" p
      LEFT JOIN "_v2_backup_project_images" b ON b."projectId" = p."id"
     WHERE b."projectId" IS NULL
       AND COALESCE(array_length(p."images", 1), 0) > 0;
    IF unbacked <> 0 THEN
        RAISE EXCEPTION '% project(s) have a non-empty images array with no backup row; re-run the E-FINAL capture first', unbacked;
    END IF;

    SELECT count(*) INTO lost
      FROM "Project" p
     WHERE COALESCE(array_length(p."images", 1), 0) > 0
       AND NOT EXISTS (SELECT 1 FROM "ProjectImage" g WHERE g."projectId" = p."id");
    IF lost <> 0 THEN
        RAISE EXCEPTION '% project(s) still hold images in the array but have no ProjectImage row; see the note above before dropping', lost;
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- 1. Retire the cutover shim. Must precede the DROP COLUMN.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS "Project_images_update_to_gallery" ON "Project";
DROP TRIGGER IF EXISTS "Project_images_insert_to_gallery" ON "Project";
DROP FUNCTION IF EXISTS "project_images_to_gallery"();


-- ---------------------------------------------------------------------
-- 2. Drop the array. This is the only column this cluster removes, and
--    the only statement in the whole cluster that a v1 process cannot
--    survive.
--    The DEFAULT added in EXPAND step 2 goes with it.
-- ---------------------------------------------------------------------

ALTER TABLE "Project" DROP COLUMN IF EXISTS "images";


-- ---------------------------------------------------------------------
-- 3. Optional: the three lifecycle/logo CHECKs, IF you chose to defer
--    them out of EXPAND step 5. They are already correct for v2's
--    writers, which use the same resolveLifecycle and the same
--    projectPublishStamp as v1. Uncomment only if EXPAND skipped them.
-- ---------------------------------------------------------------------

-- ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishedAt_required_check";
-- ALTER TABLE "Project" ADD CONSTRAINT "Project_publishedAt_required_check"
--     CHECK ("status" <> 'PUBLISHED'::"ContentStatus" OR "publishedAt" IS NOT NULL);
-- ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishAt_required_check";
-- ALTER TABLE "Project" ADD CONSTRAINT "Project_publishAt_required_check"
--     CHECK ("status" <> 'SCHEDULED'::"ContentStatus" OR "publishAt" IS NOT NULL);
-- ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_logo_source_check";
-- ALTER TABLE "Project" ADD CONSTRAINT "Project_logo_source_check"
--     CHECK ("logoAssetId" IS NULL OR "logoUrl" IS NULL);


-- ---------------------------------------------------------------------
-- 4. VERIFICATION. Read before COMMIT.
-- ---------------------------------------------------------------------

-- C1  the array is gone, the two new tables and the enum remain.
--     expected: f | t | t | t
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'Project'
                  AND column_name = 'images')                       AS images_still_there,
       to_regclass('public."ProjectImage"')  IS NOT NULL             AS gallery_table,
       to_regclass('public."ProjectHealth"') IS NOT NULL             AS health_table,
       EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LiveProbeStatus') AS probe_enum;

-- C2  the shim is gone. expected: 0 | 0
SELECT (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public."Project"'::regclass AND NOT tgisinternal) AS triggers_left,
       (SELECT count(*) FROM pg_proc
         WHERE proname = 'project_images_to_gallery')                       AS shim_functions_left;

-- C3  "Project" now matches target-ddl.sql exactly.
--     expected, in this order:
--       createdAt TIMESTAMP NO CURRENT_TIMESTAMP / github text YES /
--       id text NO / live text YES / logoAssetId text YES /
--       logoUrl text YES / publishAt TIMESTAMP YES /
--       publishedAt TIMESTAMP YES / sortOrder integer NO /
--       status ContentStatus NO 'DRAFT' / summary text NO /
--       title text NO / updatedAt TIMESTAMP NO (no default)
--     13 columns, no "images".
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Project'
 ORDER BY column_name;

-- C4  the gallery is intact and every row still has exactly one source.
--     expected: 6 (or more) | 0
SELECT count(*)                                                                AS gallery_rows,
       count(*) FILTER (WHERE ("assetId" IS NOT NULL) = ("externalUrl" IS NOT NULL))
                                                                               AS violating_rows
  FROM "ProjectImage";

-- C5  every project that should have a cover has one.
--     expected: 0
SELECT count(*) AS projects_without_a_cover
  FROM "Project" p
 WHERE NOT EXISTS (SELECT 1 FROM "ProjectImage" g
                    WHERE g."projectId" = p."id" AND g."sortOrder" = 0);

COMMIT;


-- =====================================================================
-- LATER CLEANUP. Once the v2 deploy has survived a few days and you no
-- longer want a rollback path for the array, drop the scaffolding so
-- `prisma migrate diff` against schema.prisma comes back completely
-- empty for this cluster.
-- =====================================================================

-- DROP TABLE IF EXISTS "_v2_backup_project_images";


-- =====================================================================
-- ROLLBACK of CONTRACT. Only needed if you have to put v1 back after
-- this stage. Restores the column and its contents from the backup, and
-- from ProjectImage for anything written since.
--
-- BE HONEST ABOUT WHAT THIS DOES NOT RESTORE: a gallery row a v2 admin
-- created with assetId set has no place in a String[] of paths, so it
-- comes back as the MediaAsset's url. A project a v2 admin created has
-- no ProjectSkill representation v1 can read at all (that is cluster 35),
-- so a v1 rollback is lossy for reasons beyond this cluster.
-- =====================================================================

-- BEGIN;
-- ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
--
-- -- prefer the live gallery, fall back to the backup for a project with none
-- UPDATE "Project" p SET "images" = COALESCE(
--   (SELECT array_agg(COALESCE(g."externalUrl",
--                              (SELECT m."url" FROM "MediaAsset" m WHERE m."id" = g."assetId"))
--                     ORDER BY g."sortOrder", g."id")
--      FROM "ProjectImage" g
--     WHERE g."projectId" = p."id"
--       AND COALESCE(g."externalUrl",
--                    (SELECT m."url" FROM "MediaAsset" m WHERE m."id" = g."assetId")) IS NOT NULL),
--   (SELECT b."images" FROM "_v2_backup_project_images" b WHERE b."projectId" = p."id"),
--   '{}'::text[]);
--
-- -- expected: 0. A NULL element is something v1's String[] cannot represent.
-- SELECT count(*) AS null_elements
--   FROM "Project" p
--   CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) AS g("img")
--  WHERE g."img" IS NULL;
--
-- -- re-arm the shim so a v1 save keeps ProjectImage in step, in case you
-- -- roll forward again. Paste EXPAND step 10 here.
-- COMMIT;
