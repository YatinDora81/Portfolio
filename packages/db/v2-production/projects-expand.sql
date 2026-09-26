-- =====================================================================
-- PRODUCTION CUTOVER, cluster: projects
-- STAGE 1 of 3: EXPAND.  Run this with the LIVE SITE UP, on v1 code.
-- =====================================================================
--
-- Connect with PROD_DATABASE_URL, on the DIRECT Neon endpoint (not the
-- -pooler host): this file is one transaction and takes ACCESS EXCLUSIVE
-- on "Project", and a transaction-pooled session is the wrong place for
-- that.
--
-- WHAT IS ADDITIVE HERE AND WHY EACH PIECE IS SAFE FOR v1
--
--   "Project"."logoAssetId" TEXT + index + FK SetNull
--       v1 has no such field in its Prisma client, so it never appears in
--       a v1 SELECT list, INSERT column list or UPDATE SET list. It is
--       NULL on all six rows and stays NULL for anything v1 writes.
--       NULL trivially satisfies the FK.
--
--   "Project"."createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
--       NOT NULL is only a problem for a v1 INSERT when there is no
--       default. There is one, and Prisma names its columns explicitly
--       (it never does INSERT with an implicit column list), so
--       createProject at git HEAD apps/docs/app/lib/actions/projects.ts:36
--       omits "createdAt" and the default fills it. That is also the
--       semantically right answer: a project created during the window
--       really was created then.
--
--   "Project"."images" ALTER COLUMN SET DEFAULT ARRAY[]::TEXT[]
--       Not in the draft. Added for the DEPLOY-side rollback: after the
--       deploy, v2's createProject omits "images" (its client has no such
--       field), and the column is nullable with no default, so a v2-created
--       row would carry SQL NULL there. If the deploy then has to be rolled
--       back to v1, v1 reads "images" as a required String[]. A default of
--       '{}' makes that row read as an empty gallery instead of NULL.
--       A DEFAULT changes nothing for v1, which always supplies the value.
--
--   3 CHECK constraints on "Project"
--       Every v1 writer of Project.status was read at git HEAD and all of
--       them already satisfy these; see the per-constraint comments.
--
--   "ProjectImage", "ProjectHealth", enum "LiveProbeStatus"
--       New objects. v1 cannot see them. Both new tables hang off
--       "Project"."id" with ON DELETE CASCADE, so deleteProject at git
--       HEAD apps/docs/app/lib/actions/projects.ts:110 keeps working; a
--       RESTRICT/NO ACTION FK there is exactly what would have broken it.
--
--   2 triggers that mirror "Project"."images" into "ProjectImage"
--       THIS IS THE ONE PIECE THAT IS NOT IN THE DRAFT AND IS THE WHOLE
--       REASON THE WINDOW IS SURVIVABLE. See the WINDOW section below.
--
-- WHAT IS *NOT* HERE
--   ALTER TABLE "Project" DROP COLUMN "images".  That is in
--   projects-contract.sql. Dropping it now breaks the PUBLIC SITE
--   immediately: readProjects at git HEAD apps/web/app/lib/data.ts:238
--   uses `include:` with no `select:`, so Prisma emits the full scalar
--   column list for "Project", "images" included, and the SELECT fails
--   42703. It also breaks every v1 project write (projects.ts:43 and :75)
--   and the admin media orphan scan
--   (git HEAD apps/docs/app/lib/media-references.ts:22, which selects
--   images explicitly).
--
-- THE WINDOW, CONCRETELY
--   Between EXPAND and DEPLOY the admin app is still v1. v1 stores the
--   gallery in "Project"."images" and has never heard of "ProjectImage":
--     git HEAD apps/docs/app/lib/actions/projects.ts:43
--         images: data.images.filter(Boolean)     (createProject)
--     git HEAD apps/docs/app/lib/actions/projects.ts:75
--         images: data.images.filter(Boolean)     (updateProject)
--   So without help, one admin save in the window means:
--     - an edited project: v2 renders the PRE-EXPAND cover, silently
--     - a NEW project: v2 renders NO cover at all, because it has zero
--       ProjectImage rows
--   Neither throws. Both are silently wrong content on the public site.
--   STEP 10 closes that hole by making the database do the dual write.
--   The triggers key on "UPDATE OF images", so the writers that do NOT
--   touch images are untouched by them:
--     reorderProjects            projects.ts:117   sortOrder only
--     publishProjectNow          publishing.ts:225 status/publishAt/publishedAt
--     setProjectStatus           publishing.ts:309 same
--     publishDueContent          packages/db/src/publish-due.ts:53 same
--
-- LOCKS
--   ACCESS EXCLUSIVE on "Project" for the ALTERs (6 rows, milliseconds)
--   and SHARE ROW EXCLUSIVE on "MediaAsset" while the two new FKs are
--   added (2 rows). lock_timeout below keeps this from queueing behind a
--   long public read instead of failing fast. Public reads of "Project"
--   happen rarely: the homepage is `export const revalidate = 86400`
--   (apps/web/app/page.tsx:276) over an unstable_cache with an 86400s
--   lifetime (apps/web/app/lib/data.ts:264).
--
-- ROLLBACK
--   Before COMMIT: ROLLBACK. After COMMIT: see the block at the bottom.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout        = '3s';
SET LOCAL statement_timeout   = '60s';
SET LOCAL idle_in_transaction_session_timeout = '5min';


-- ---------------------------------------------------------------------
-- 0. PREFLIGHT GATE. Aborts rather than half-applying.
--    Every assertion here is from the draft's gate, plus two new ones
--    (the trigger names, and the assertion that "images" is still the
--    live source of truth).
-- ---------------------------------------------------------------------

DO $$
DECLARE
    bad_elements    bigint;
    asset_matches   bigint;
    logo_matches    bigint;
    scheduled_bad   bigint;
    already_written boolean;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'Project'
                      AND column_name = 'images') THEN
        RAISE EXCEPTION 'Project."images" is already gone - EXPAND has nothing to read from';
    END IF;

    IF (SELECT udt_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'Project'
           AND column_name = 'images') <> '_text' THEN
        RAISE EXCEPTION 'Project."images" is not text[]; the gallery backfill assumes unnest() over text[]';
    END IF;

    IF to_regclass('public."MediaAsset"') IS NULL THEN
        RAISE EXCEPTION 'MediaAsset is missing; both new foreign keys reference it';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'MediaAsset'
           AND column_name = 'id') <> 'text' THEN
        RAISE EXCEPTION 'MediaAsset."id" is not text; the two new FK columns are TEXT';
    END IF;

    IF to_regclass('public."ProjectImage"') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM "ProjectImage" WHERE "assetId" IS NOT NULL)'
           INTO already_written;
        IF already_written THEN
            RAISE EXCEPTION 'ProjectImage already holds assetId rows; v2 has written here, do not re-run EXPAND';
        END IF;
    END IF;

    SELECT count(*) INTO bad_elements
      FROM "Project" p
      CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
     WHERE g."img" IS NULL OR btrim(g."img") = '';
    IF bad_elements <> 0 THEN
        RAISE EXCEPTION 'Project."images" holds % null or blank element(s); decide what they mean first', bad_elements;
    END IF;

    -- every gallery path and every logoUrl is a bare CDN path with no
    -- MediaAsset row, which is what makes externalUrl correct and
    -- assetId / logoAssetId necessarily NULL. Re-proved here rather than
    -- trusted from data-facts.txt.
    SELECT count(*) INTO asset_matches
      FROM "Project" p
      CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
      JOIN "MediaAsset" m
        ON m."key" = g."img" OR m."key" = ltrim(g."img", '/')
        OR m."url" = g."img" OR m."url" = '/' || ltrim(g."img", '/');
    IF asset_matches <> 0 THEN
        RAISE EXCEPTION '% gallery path(s) match a MediaAsset; those rows want assetId, not externalUrl', asset_matches;
    END IF;

    SELECT count(*) INTO logo_matches
      FROM "Project" p
      JOIN "MediaAsset" m
        ON m."key" = p."logoUrl" OR m."key" = ltrim(p."logoUrl", '/')
        OR m."url" = p."logoUrl" OR m."url" = '/' || ltrim(p."logoUrl", '/')
     WHERE p."logoUrl" IS NOT NULL;
    IF logo_matches <> 0 THEN
        RAISE EXCEPTION '% Project."logoUrl" value(s) match a MediaAsset; those rows want logoAssetId', logo_matches;
    END IF;

    -- there is no defensible automatic repair for a SCHEDULED row with no
    -- publishAt (inventing a date is a content decision). v1 cannot create
    -- one, but stop rather than fail on ADD CONSTRAINT.
    SELECT count(*) INTO scheduled_bad
      FROM "Project" WHERE "status" = 'SCHEDULED' AND "publishAt" IS NULL;
    IF scheduled_bad <> 0 THEN
        RAISE EXCEPTION '% SCHEDULED project(s) have no publishAt; fix by hand', scheduled_bad;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname IN ('Project_images_insert_to_gallery',
                                 'Project_images_update_to_gallery')) THEN
        RAISE EXCEPTION 'the dual-write triggers already exist; EXPAND has already run';
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- 1. The two new columns on "Project". "logoUrl" is KEPT: the FK sits
--    BESIDE the string column, because cdnUrl() passes an absolute
--    off-bucket URL straight through and such a logo has nowhere else to
--    live.
--    v1 SAFE: neither column is in the v1 Prisma client, so v1 never
--    selects or writes either. "createdAt" is NOT NULL but has a
--    default, so the v1 INSERT that omits it still succeeds.
--    CURRENT_TIMESTAMP is STABLE, not VOLATILE, so PG17 stores one
--    attmissingval and does not rewrite the table.
-- ---------------------------------------------------------------------

ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "logoAssetId" TEXT,
    ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Project_logoAssetId_idx" ON "Project" ("logoAssetId");

-- onDelete: SetNull, with the ON UPDATE CASCADE Prisma emits beside it.
-- v1 SAFE: the only v1 statement this constraint can see is an INSERT or
-- UPDATE that leaves logoAssetId NULL, which passes. It also gives
-- MediaAsset deletes a new dependent, but with all six values NULL the
-- SET NULL sweep is a no-op, and "Project_logoAssetId_idx" above is the
-- access path for it.
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_logoAssetId_fkey";
ALTER TABLE "Project" ADD CONSTRAINT "Project_logoAssetId_fkey"
    FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- 2. Give "images" an empty-array default. Purely for the DEPLOY-side
--    rollback; see the header. v1 always supplies the value, so this
--    changes nothing for v1.
-- ---------------------------------------------------------------------

ALTER TABLE "Project" ALTER COLUMN "images" SET DEFAULT ARRAY[]::TEXT[];


-- ---------------------------------------------------------------------
-- 3. Lifecycle repair, before the CHECK that would reject it.
--    Expected to touch 0 rows: data-facts.txt shows all six PUBLISHED
--    and all six stamped 2026-08-21T18:53:06.003. It is here for a row
--    the admin published between the dump and this run.
--    publishAt is the operator's own intended date, so it beats
--    updatedAt, which is only the last write.
--    Raw SQL, so this does NOT bump "updatedAt" (Prisma's @updatedAt is
--    client-side), and therefore does not poison the stale-content
--    signal "createdAt" is being added to feed.
--    expected: UPDATE 0
-- ---------------------------------------------------------------------

UPDATE "Project"
   SET "publishedAt" = COALESCE("publishAt", "updatedAt")
 WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;


-- ---------------------------------------------------------------------
-- 4. createdAt backfill. Nothing in the old schema records creation
--    time, so this is the earliest moment the row is PROVABLY known to
--    have existed, not a recovered fact. LEAST ignores NULLs and
--    "updatedAt" is NOT NULL, so the result is never NULL.
--    The "createdAt" > LEAST(...) guard makes it monotone-backwards: a
--    second run is a no-op and can never push creation forwards.
--    Letting the DEFAULT stand instead would stamp all six rows with the
--    migration date and make every project look brand new to the stale
--    detection this column exists for.
--    expected: UPDATE 6
-- ---------------------------------------------------------------------

UPDATE "Project"
   SET "createdAt" = LEAST("publishedAt", "publishAt", "updatedAt")
 WHERE LEAST("publishedAt", "publishAt", "updatedAt") IS NOT NULL
   AND "createdAt" > LEAST("publishedAt", "publishAt", "updatedAt");


-- ---------------------------------------------------------------------
-- 5. The three CHECKs on "Project". Added VALIDATED, not NOT VALID:
--    NOT VALID only skips the existing-row scan, it does not exempt new
--    writes, so at six rows it buys nothing and leaves a constraint that
--    guarantees nothing until someone remembers to VALIDATE it.
--
--    v1 SAFE - every v1 writer of Project.status, read at git HEAD:
--      createProject      projects.ts:47   publishedAt: status==='PUBLISHED' ? new Date() : null
--      updateProject      projects.ts:79   stamps publishedAt when it is currently null
--      publishProjectNow  publishing.ts:225 via projectPublishStamp(), which stamps when null
--      setProjectStatus   publishing.ts:309 same, only when status==='PUBLISHED'
--      publishDueContent  packages/db/src/publish-due.ts:53  needsStamp when null
--    and no v1 path anywhere sets publishedAt back to NULL.
--    For SCHEDULED, both entry points refuse the write before it reaches
--    the database unless a future publishAt is present:
--      resolveLifecycle   apps/docs/app/lib/lifecycle.ts, SCHEDULED branch
--      StatusInput        publishing.ts superRefine, 'Scheduling a post needs a publish date.'
--    and every non-SCHEDULED status clears publishAt in the same UPDATE,
--    so the row-level CHECK sees a consistent pair.
--    The PUBLIC SITE never writes "Project" at all (the only prisma.project
--    call in apps/web at HEAD is the findMany at data.ts:238), so the worst
--    a CHECK I have mis-reasoned about can do is make an ADMIN save throw.
--    Public traffic cannot hit it.
--
--    If you want zero admin risk in the window, these three ALTERs are
--    the only statements in this file that can be moved to CONTRACT
--    without changing anything the deploy needs. Nothing in v2 requires
--    them to exist at DEPLOY time.
-- ---------------------------------------------------------------------

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishedAt_required_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_publishedAt_required_check"
    CHECK ("status" <> 'PUBLISHED'::"ContentStatus" OR "publishedAt" IS NOT NULL);

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishAt_required_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_publishAt_required_check"
    CHECK ("status" <> 'SCHEDULED'::"ContentStatus" OR "publishAt" IS NOT NULL);

-- at-most-one, not exactly-one: a project with neither mark is legal.
-- v1 SAFE: v1 writes logoUrl (projects.ts:42 and :74) and never writes
-- logoAssetId, so the left operand is always NULL on a v1 write and the
-- CHECK is unconditionally satisfied.
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_logo_source_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_logo_source_check"
    CHECK ("logoAssetId" IS NULL OR "logoUrl" IS NULL);


-- ---------------------------------------------------------------------
-- 6. "ProjectImage". Surrogate TEXT id with no database default, because
--    Prisma's @default(uuid()) is client-side everywhere in this schema;
--    the backfill and the trigger supply their own uuids.
--    PK, both FKs and the CHECK inline so the statement is IF NOT
--    EXISTS-able; the pg_constraint rows are identical to what
--    ALTER TABLE ... ADD CONSTRAINT would produce, so `prisma migrate
--    diff` still comes back empty.
--    v1 SAFE: new table, invisible to the v1 client. projectId CASCADE is
--    what keeps deleteProject (projects.ts:110) working.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ProjectImage" (
    "id"          TEXT    NOT NULL,
    "projectId"   TEXT    NOT NULL,
    "assetId"     TEXT,
    "externalUrl" TEXT,
    "sortOrder"   INTEGER NOT NULL,

    CONSTRAINT "ProjectImage_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "ProjectImage_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT "ProjectImage_assetId_fkey" FOREIGN KEY ("assetId")
        REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,

    -- exactly one of assetId and externalUrl: an empty slot is the
    -- absence of the row, so a row with neither is meaningless and a row
    -- with both is ambiguous about which one renders.
    CONSTRAINT "ProjectImage_source_check"
        CHECK (("assetId" IS NOT NULL) <> ("externalUrl" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "ProjectImage_projectId_sortOrder_idx"
    ON "ProjectImage" ("projectId", "sortOrder");

CREATE INDEX IF NOT EXISTS "ProjectImage_assetId_idx"
    ON "ProjectImage" ("assetId");


-- ---------------------------------------------------------------------
-- 7. Backfill the gallery from "Project"."images".
--    Written as a full rebuild, not the draft's anti-join, so that the
--    same two statements are the RESYNC in STAGE E-FINAL below. The
--    blunt DELETE is only safe while nothing but the array has ever
--    written here, which the preflight gate proved (no assetId rows).
--    WITH ORDINALITY is 1-based, so "ord" - 1 gives the repo's 0-based
--    sortOrder (packages/db/seed.ts uses sortOrder: 0 for the first
--    element of every ordered list). All six arrays hold exactly one
--    element, so all six rows land on sortOrder 0.
--    assetId is NULL on all six by construction: the preflight proved no
--    MediaAsset matches any of /projects/drawsheet.png,
--    /projects/connect.png, /projects/netflix-gpt.png,
--    /projects/trimrr.png, /projects/nextmove_v1.png,
--    /projects/grill_v1.png. Minting placeholder MediaAsset rows would
--    invent altText, bytes, mimeType and an R2 object that does not
--    exist; externalUrl is the escape hatch the schema provides for
--    exactly this.
--    expected: DELETE 0, then INSERT 0 6
-- ---------------------------------------------------------------------

DELETE FROM "ProjectImage";

INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
SELECT gen_random_uuid()::text,
       p."id",
       NULL::text,
       g."img",
       (g."ord" - 1)::int
  FROM "Project" p
  CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord");


-- ---------------------------------------------------------------------
-- 8. GUARD. Prove the array contents landed. Multiset comparison in both
--    directions, so a duplicated path at two ordinals is still checked.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    missing bigint;
    extra   bigint;
    src     bigint;
    dst     bigint;
BEGIN
    SELECT count(*) INTO src
      FROM "Project" p
      CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord");

    SELECT count(*) INTO dst FROM "ProjectImage";

    SELECT count(*) INTO missing FROM (
        SELECT p."id", g."img", (g."ord" - 1)::int AS "so"
          FROM "Project" p
          CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
        EXCEPT ALL
        SELECT "projectId", "externalUrl", "sortOrder" FROM "ProjectImage") d;

    SELECT count(*) INTO extra FROM (
        SELECT "projectId", "externalUrl", "sortOrder" FROM "ProjectImage"
        EXCEPT ALL
        SELECT p."id", g."img", (g."ord" - 1)::int
          FROM "Project" p
          CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")) d;

    IF missing <> 0 OR extra <> 0 OR src <> dst THEN
        RAISE EXCEPTION
            'gallery backfill mismatch: array elements=%, ProjectImage rows=%, missing=%, extra=%',
            src, dst, missing, extra;
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- 9. "LiveProbeStatus" and "ProjectHealth". Created EMPTY and stays
--    empty: nothing in the repo writes it yet, the probe still runs
--    inline in the homepage render (probeLive, apps/web/app/lib/data.ts),
--    and an invented row would print "up - 0 ms" for a URL nobody
--    probed. v2's readProjects falls back to probeLive whenever
--    health?.status is null, so an empty table is exactly the behaviour
--    v1 has today.
--    LOWERCASE enum members on purpose: the value is printed AND used as
--    a CSS class, so 'UP' would paint a healthy project red. 'unknown'
--    is deliberately not a member; it is checkedAt IS NULL.
--    CREATE TYPE is transactional on PG17 and a type created earlier in
--    the same transaction may be used later in it.
--    v1 SAFE: both are invisible to the v1 client. projectId CASCADE
--    again keeps deleteProject working.
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t
                     JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'LiveProbeStatus' AND n.nspname = 'public') THEN
        CREATE TYPE "LiveProbeStatus" AS ENUM ('up', 'down');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ProjectHealth" (
    "projectId" TEXT NOT NULL,
    "status"    "LiveProbeStatus",
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectHealth_pkey" PRIMARY KEY ("projectId"),

    CONSTRAINT "ProjectHealth_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,

    -- a status with no timestamp is unfalsifiable; a timestamp with no
    -- status cannot be told apart from "never probed"
    CONSTRAINT "ProjectHealth_status_checkedAt_check"
        CHECK (("status" IS NULL) = ("checkedAt" IS NULL)),

    CONSTRAINT "ProjectHealth_latencyMs_requires_status_check"
        CHECK ("latencyMs" IS NULL OR "status" IS NOT NULL),

    CONSTRAINT "ProjectHealth_latencyMs_nonneg_check"
        CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0)
);


-- ---------------------------------------------------------------------
-- 10. THE DUAL WRITE. This is what makes the EXPAND -> DEPLOY window
--     safe instead of merely short.
--
--     v1's createProject and updateProject write the gallery into
--     "Project"."images" (git HEAD projects.ts:43 and :75) and have never
--     heard of "ProjectImage". These two triggers make the database do
--     the second half of the write, so a v1 save in the window leaves
--     "ProjectImage" correct and the public site renders the admin's
--     actual intent after DEPLOY.
--
--     Why two triggers and not one:
--       - the UPDATE trigger is column-qualified with UPDATE OF "images",
--         so it fires only for statements that name that column. v1's
--         updateProject always names it, even when unchanged, so this
--         also self-heals a gallery that has drifted for any reason.
--         reorderProjects, publishProjectNow, setProjectStatus and
--         publishDueContent do not name it and so never fire it.
--       - OF is not available for INSERT, so the INSERT trigger is
--         instead gated on a non-empty array. That gate is what keeps it
--         inert for a v2 createProject, which omits "images" and
--         therefore gets the '{}' default from step 2.
--         (Even if it did fire there it would be a no-op: the FK forces
--         Prisma to insert the parent "Project" row before its nested
--         gallery children, so the DELETE finds nothing and the INSERT
--         has nothing to read.)
--
--     DELETE-then-reinsert, not a merge, so that removing an image in
--     the v1 form actually removes the ProjectImage row. It churns
--     ProjectImage ids on every save, which is harmless: nothing
--     references a ProjectImage id, and the row identity only exists so
--     the v2 form can reorder.
--
--     NULL and blank elements are skipped rather than allowed to abort
--     the admin's save. v1 already filters them with .filter(Boolean)
--     before the write, so this branch is unreachable; if it were
--     reachable, a blank element would otherwise violate
--     ProjectImage_source_check and turn an admin save into a 500.
--
--     This trigger is dropped in projects-contract.sql. Drop it as the
--     FIRST thing after the deploy is confirmed if you would rather not
--     leave it standing.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "project_images_to_gallery"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "ProjectImage" WHERE "projectId" = NEW."id";

    INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
    SELECT gen_random_uuid()::text,
           NEW."id",
           NULL::text,
           g."img",
           (row_number() OVER (ORDER BY g."ord") - 1)::int
      FROM unnest(COALESCE(NEW."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
     WHERE g."img" IS NOT NULL AND btrim(g."img") <> '';

    RETURN NULL;
END
$$;

COMMENT ON FUNCTION "project_images_to_gallery"() IS
  'v1->v2 cutover shim: mirrors Project.images into ProjectImage while the deployed admin is still v1. Drop with projects-contract.sql.';

DROP TRIGGER IF EXISTS "Project_images_insert_to_gallery" ON "Project";
CREATE TRIGGER "Project_images_insert_to_gallery"
    AFTER INSERT ON "Project"
    FOR EACH ROW
    WHEN (COALESCE(array_length(NEW."images", 1), 0) > 0)
    EXECUTE FUNCTION "project_images_to_gallery"();

DROP TRIGGER IF EXISTS "Project_images_update_to_gallery" ON "Project";
CREATE TRIGGER "Project_images_update_to_gallery"
    AFTER UPDATE OF "images" ON "Project"
    FOR EACH ROW
    EXECUTE FUNCTION "project_images_to_gallery"();


-- ---------------------------------------------------------------------
-- 11. A backup of the array, so that CONTRACT's DROP COLUMN is
--     reversible without needing the column. Refreshed by STAGE E-FINAL.
--     Not a Prisma model, hence the underscore name: `prisma migrate
--     diff` will report it as an extra table, which is the point - it is
--     scaffolding and gets dropped once confidence is high.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "_v2_backup_project_images" (
    "projectId"  TEXT PRIMARY KEY,
    "images"     TEXT[],
    "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO "_v2_backup_project_images" ("projectId", "images")
SELECT "id", "images" FROM "Project"
ON CONFLICT ("projectId") DO UPDATE
   SET "images" = EXCLUDED."images", "capturedAt" = now();


-- ---------------------------------------------------------------------
-- 12. VERIFICATION. Read these before COMMIT.
-- ---------------------------------------------------------------------

-- V1  the gallery landed. expected: 6 | 6 | 6 | 0 | 6
SELECT count(*)                                              AS gallery_rows,
       count(DISTINCT "projectId")                           AS projects_covered,
       count(*) FILTER (WHERE "externalUrl" LIKE '/projects/%') AS project_paths,
       count(*) FILTER (WHERE "assetId" IS NOT NULL)          AS with_asset,
       count(*) FILTER (WHERE "sortOrder" = 0)                AS cover_slots
  FROM "ProjectImage";

-- V2  every project still resolves to the same cover it had.
--     expected: 6 rows, "cover" equal to images[1] for each title
SELECT p."title", g."externalUrl" AS cover, g."sortOrder", p."images"[1] AS old_cover,
       (g."externalUrl" = p."images"[1]) AS matches
  FROM "Project" p
  JOIN "ProjectImage" g ON g."projectId" = p."id" AND g."sortOrder" = 0
 ORDER BY p."sortOrder";

-- V3  new columns are the right shape. expected:
--     createdAt   | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--     logoAssetId | text                        | YES | (null)
--     images      | ARRAY                       | YES | ARRAY[]::text[]
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Project'
   AND column_name IN ('createdAt', 'logoAssetId', 'images')
 ORDER BY column_name;

-- V4  createdAt is a lower bound, never the migration date.
--     expected: 6 | 6 | 0 | 0
SELECT count(*)                                                        AS projects,
       count(*) FILTER (WHERE "createdAt" <= "updatedAt")               AS created_before_updated,
       count(*) FILTER (WHERE "createdAt" > now())                      AS in_the_future,
       count(*) FILTER (WHERE "createdAt" > LEAST("publishedAt", "publishAt", "updatedAt"))
                                                                        AS not_earliest
  FROM "Project";

-- V5  all six logos are still string logos, none moved to an asset.
--     expected: 6 | 6 | 0
SELECT count(*) AS projects,
       count(*) FILTER (WHERE "logoUrl" IS NOT NULL)     AS with_logo_url,
       count(*) FILTER (WHERE "logoAssetId" IS NOT NULL) AS with_logo_asset
  FROM "Project";

-- V6  ProjectHealth exists and is empty; the enum has exactly up, down.
--     expected: t | 0 | {up,down}
SELECT to_regclass('public."ProjectHealth"') IS NOT NULL AS health_table_present,
       (SELECT count(*) FROM "ProjectHealth")            AS health_rows,
       (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'LiveProbeStatus')            AS probe_members;

-- V7  every new constraint is present with the right definition.
--     expected: 11 rows (3 CHECK + 1 FK on Project, 1 PK + 2 FK + 1 CHECK
--     on ProjectImage, 1 PK + 1 FK + 3 CHECK on ProjectHealth = 14; the
--     filter below shows the new ones only)
SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype,
       pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
 WHERE c.conrelid IN ('public."Project"'::regclass,
                      'public."ProjectImage"'::regclass,
                      'public."ProjectHealth"'::regclass)
   AND c.conname NOT IN ('Project_pkey')
 ORDER BY tbl, c.contype, c.conname;

-- V8  the two status indexes were left alone, not recreated.
--     expected: Project_logoAssetId_idx, Project_status_publishAt_idx,
--               Project_status_publishedAt_idx (+ the 2 ProjectImage ones)
SELECT tablename, indexname
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename IN ('Project', 'ProjectImage', 'ProjectHealth')
 ORDER BY tablename, indexname;

-- V9  the dual-write shim is armed. expected: 2 rows, both enabled 'O'
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
  FROM pg_trigger
 WHERE tgrelid = 'public."Project"'::regclass AND NOT tgisinternal
 ORDER BY tgname;

-- V10 the array backup covers every project. expected: 6 | 6 | 0
SELECT (SELECT count(*) FROM "Project")                        AS projects,
       (SELECT count(*) FROM "_v2_backup_project_images")      AS backed_up,
       (SELECT count(*) FROM "Project" p
         LEFT JOIN "_v2_backup_project_images" b ON b."projectId" = p."id"
        WHERE b."projectId" IS NULL)                           AS unbacked;

COMMIT;


-- =====================================================================
-- STAGE E-FINAL. RESYNC. Run this in its OWN transaction immediately
-- before you push the v2 code, and again if the deploy is delayed.
--
-- With the triggers from step 10 armed this should be a no-op, and that
-- is exactly why it is worth running: if it changes anything, a v1 write
-- got past the triggers and you want to know before the deploy, not
-- after. The guard refuses to run once v2 has written an assetId row, so
-- it cannot destroy v2 data if you run it a day late by mistake.
-- =====================================================================

-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
--
-- DO $$
-- BEGIN
--     IF EXISTS (SELECT 1 FROM "ProjectImage" WHERE "assetId" IS NOT NULL) THEN
--         RAISE EXCEPTION 'ProjectImage holds assetId rows - v2 is already writing here; do NOT resync from Project.images';
--     END IF;
-- END
-- $$;
--
-- DELETE FROM "ProjectImage";
--
-- INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
-- SELECT gen_random_uuid()::text, p."id", NULL::text, g."img", (g."ord" - 1)::int
--   FROM "Project" p
--   CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
--  WHERE g."img" IS NOT NULL AND btrim(g."img") <> '';
--
-- INSERT INTO "_v2_backup_project_images" ("projectId", "images")
-- SELECT "id", "images" FROM "Project"
-- ON CONFLICT ("projectId") DO UPDATE
--    SET "images" = EXCLUDED."images", "capturedAt" = now();
--
-- -- expected: as many ProjectImage rows as array elements, 0 with assetId
-- SELECT (SELECT count(*) FROM "ProjectImage")                                    AS gallery_rows,
--        (SELECT count(*) FROM "Project" p
--           CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) x)       AS array_elements;
--
-- COMMIT;


-- =====================================================================
-- POST-COMMIT ROLLBACK of EXPAND, if you decide not to deploy.
-- Lossless for everything this stage created, because every gallery row
-- is an externalUrl row and the array it came from is still there.
-- =====================================================================

-- BEGIN;
-- DROP TRIGGER IF EXISTS "Project_images_update_to_gallery" ON "Project";
-- DROP TRIGGER IF EXISTS "Project_images_insert_to_gallery" ON "Project";
-- DROP FUNCTION IF EXISTS "project_images_to_gallery"();
--
-- -- put back anything a v1 save wrote to ProjectImage but not to images.
-- -- (Cannot happen: v1 writes the array, the trigger derives the rows.)
-- DROP TABLE IF EXISTS "ProjectHealth";
-- DROP TABLE IF EXISTS "ProjectImage";
-- DROP TYPE  IF EXISTS "LiveProbeStatus";
--
-- ALTER TABLE "Project"
--   DROP CONSTRAINT IF EXISTS "Project_logo_source_check",
--   DROP CONSTRAINT IF EXISTS "Project_publishAt_required_check",
--   DROP CONSTRAINT IF EXISTS "Project_publishedAt_required_check",
--   DROP CONSTRAINT IF EXISTS "Project_logoAssetId_fkey";
-- DROP INDEX IF EXISTS "Project_logoAssetId_idx";
-- ALTER TABLE "Project"
--   ALTER COLUMN "images" DROP DEFAULT,
--   DROP COLUMN IF EXISTS "logoAssetId",
--   DROP COLUMN IF EXISTS "createdAt";
--
-- DROP TABLE IF EXISTS "_v2_backup_project_images";
-- COMMIT;
--
-- This discards "createdAt" (the old schema has nowhere to hold it) and
-- any logoAssetId. It does NOT undo anything outside the database: no R2
-- object and no email is involved anywhere in this cluster.
