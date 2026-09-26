-- =====================================================================
-- cluster 50-projects
-- target: the Neon child branch only. Production is not touched.
-- =====================================================================
--
-- WHAT THIS DOES
--   Everything the v2 schema adds under "### Projects" except the
--   ProjectSkill join (cluster 35-skill-joins) and ProjectBullet's new
--   index (its own cluster). In order:
--
--   "Project"
--     + "logoAssetId" TEXT, FK -> MediaAsset ON DELETE SET NULL, and the
--       matching @@index([logoAssetId]). "logoUrl" is KEPT, not replaced.
--     + "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--       backfilled to the earliest stamp the row still carries.
--     + the two lifecycle CHECKs (PUBLISHED needs publishedAt, SCHEDULED
--       needs publishAt), preceded by the repair UPDATE.
--     + the not-both-logo CHECK.
--     - "images" TEXT[], dropped last, after its contents are proven to
--       have landed in "ProjectImage".
--     = both existing status indexes are left exactly as they are.
--
--   "ProjectImage" (new)  surrogate "id", "projectId" Cascade,
--     nullable "assetId" Cascade, "externalUrl", "sortOrder", the two
--     declared indexes, and the exactly-one-of CHECK. Backfilled one row
--     per element of the old "Project"."images" array.
--
--   "LiveProbeStatus" (new enum, lowercase 'up' / 'down')
--   "ProjectHealth"   (new, EMPTY, PK = "projectId", Cascade FK) plus its
--     three pairing CHECKs.
--
-- WHY THE GALLERY BACKFILL USES externalUrl AND NOT assetId
--   /tmp/v2/data-facts.txt, "### Project.images / logoUrl": all six rows
--   hold exactly one element, and every element is a site-relative path
--   under /projects/ :
--     /projects/drawsheet.png  /projects/connect.png
--     /projects/netflix-gpt.png  /projects/trimrr.png
--     /projects/nextmove_v1.png  /projects/grill_v1.png
--   "### MediaAsset (2)" lists the only two assets that exist:
--     key 'suite-one/1787423289561-c10a7a05-senor-avatar-final-v2.png'
--     key 'uploads/1788024018255-e15fe177-download-3.jpg'
--   Neither key nor url matches any of the six paths, so there is no
--   MediaAsset to point "assetId" at. Minting placeholder MediaAsset rows
--   would invent altText, bytes, mimeType and an R2 object that does not
--   exist. The escape hatch the schema already provides for exactly this
--   case is "externalUrl", so all six rows are written with
--   assetId = NULL and externalUrl = the old path. Preflight 6 re-proves
--   the no-match claim against the branch itself rather than trusting
--   this comment.
--
--   Same argument for "logoAssetId": none of the six "logoUrl" values
--   (/logos/*.png, /logos/grill_v1.svg) matches either MediaAsset, so the
--   column is added and left NULL on all six rows. Preflight 7 proves it.
--   That is also what makes the not-both-logo CHECK pass on day one.
--
-- WHERE sortOrder COMES FROM
--   The array ordinal, minus one, so it is 0-based. 0-based is the repo's
--   convention, not a choice made here - packages/db/seed.ts uses
--   sortOrder: 0 for the first element of every ordered list, and
--   cluster 35-skill-joins backfills row_number() - 1 for the same
--   reason. Every array has exactly one element today, so all six rows
--   land on sortOrder 0. schema-v2.md is explicit that sortOrder's only
--   observable effect is which image is the card cover, and with one
--   image per project there is nothing to disambiguate.
--
-- WHERE createdAt COMES FROM, AND WHAT IS HONESTLY UNKNOWN
--   No column anywhere records when a Project row was created. The
--   available stamps are "publishedAt", which 20260822100100_backfill_
--   content_status set to CURRENT_TIMESTAMP in bulk (all six read
--   2026-08-21T18:53:06.003, i.e. one migration run, not six creation
--   events), "publishAt", and "updatedAt", which 20260822100000 added
--   with DEFAULT CURRENT_TIMESTAMP and then dropped the default from.
--   The backfill therefore takes LEAST of the three, which is the
--   earliest moment the row is *provably* known to have existed. It is a
--   conservative lower bound, not a recovered fact. Leaving the DEFAULT
--   to fire would stamp all six rows with the migration date, which is
--   strictly worse: it would make every project look brand new to the
--   stale-content detection this column exists to feed.
--   The DEFAULT CURRENT_TIMESTAMP stays on the column, because the schema
--   declares @default(now()) and dropping it would be drift. (Contrast
--   the @updatedAt columns in the timestamps cluster, which have no
--   Prisma-side default and must drop theirs.)
--   The backfill UPDATE is raw SQL, so it does NOT bump "updatedAt" -
--   Prisma's @updatedAt is client-side. Nothing here poisons the stale
--   signal it is being added to serve.
--
-- CONSTRAINT AND INDEX NAMES
--   PK      <Table>_pkey
--   FK      <Table>_<column>_fkey
--   index   <Table>_<column>[_<column>]_idx
--   so that `prisma migrate diff` against the new schema.prisma comes
--   back empty. The new schema declares no map: on any of these three
--   models, so every name below is the Prisma default.
--
--   The seven CHECK names are NOT derivable from schema.prisma, because
--   Prisma cannot model a CHECK at all and migrate diff ignores them.
--   They follow the convention the repo already set in
--   20260728120000_add_hero_version and 20260728150000_add_audit_log,
--   <Table>_<subject>_check :
--     Project_publishedAt_required_check
--     Project_publishAt_required_check
--     Project_logo_source_check
--     ProjectImage_source_check
--     ProjectHealth_status_checkedAt_check
--     ProjectHealth_latencyMs_requires_status_check
--     ProjectHealth_latencyMs_nonneg_check
--   The Blog and Experience clusters add the same-shaped constraints
--   (Blog_cover_source_check, Experience_logo_source_check, and Blog's
--   two lifecycle CHECKs); those names have to be agreed across the three
--   files or the family reads as three conventions.
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional on Postgres 17. Run the
--   whole file inside one BEGIN/COMMIT. Notes on the three that usually
--   are not:
--     - CREATE TYPE ... AS ENUM is transactional, and using a type
--       created earlier in the same transaction is allowed. (It is
--       ALTER TYPE ... ADD VALUE followed by a use of that new value in
--       the same transaction that is forbidden, and this file does not
--       do that.)
--     - CREATE INDEX without CONCURRENTLY is transactional. Project has
--       six rows; CONCURRENTLY would be worse, because it cannot run in a
--       transaction at all.
--     - Both CHECKs on "Project" are added VALIDATED, not NOT VALID.
--       schema-v2.md reserves NOT VALID + VALIDATE for busy tables; six
--       rows is not one, and NOT VALID would leave a constraint that does
--       not actually guarantee anything until someone remembers to
--       validate it.
--   No CONCURRENTLY, no VACUUM, no CREATE EXTENSION, no
--   session_replication_role, no DISABLE TRIGGER. gen_random_uuid() is
--   core Postgres since 13, so no pgcrypto is needed. Owner privileges
--   are sufficient throughout.
--
-- IDEMPOTENCY, HONESTLY
--   ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, a DROP CONSTRAINT IF EXISTS before every ADD
--   CONSTRAINT on the pre-existing "Project", an existence guard around
--   CREATE TYPE, and an anti-join on the gallery INSERT make every
--   statement a no-op on a second run *within the same transaction
--   attempt*. The PK, FKs and CHECKs on the two NEW tables are declared
--   inline in CREATE TABLE, because ADD CONSTRAINT has no IF NOT EXISTS;
--   the resulting pg_constraint rows are identical either way, so the
--   diff is still empty.
--
--   Once the DROP COLUMN commits the file can no longer be re-run: the
--   gallery INSERT references "Project"."images" and will fail 42703
--   undefined_column. That is deliberate. A silent no-op there would hide
--   a half-migrated branch.
--
-- ROLLBACK
--   Inside the transaction: ROLLBACK. Nothing else is needed.
--   After a COMMIT, this restores the pre-migration shape:
--
--     ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "images" TEXT[];
--     UPDATE "Project" p SET "images" = COALESCE(
--       (SELECT array_agg(g."externalUrl" ORDER BY g."sortOrder", g."id")
--          FROM "ProjectImage" g WHERE g."projectId" = p."id"), '{}'::text[]);
--     DROP TABLE IF EXISTS "ProjectHealth";
--     DROP TABLE IF EXISTS "ProjectImage";
--     DROP TYPE  IF EXISTS "LiveProbeStatus";
--     ALTER TABLE "Project"
--       DROP CONSTRAINT IF EXISTS "Project_logo_source_check",
--       DROP CONSTRAINT IF EXISTS "Project_publishAt_required_check",
--       DROP CONSTRAINT IF EXISTS "Project_publishedAt_required_check",
--       DROP CONSTRAINT IF EXISTS "Project_logoAssetId_fkey";
--     DROP INDEX IF EXISTS "Project_logoAssetId_idx";
--     ALTER TABLE "Project"
--       DROP COLUMN IF EXISTS "logoAssetId",
--       DROP COLUMN IF EXISTS "createdAt";
--
--   That rollback is lossless for the six rows this migration moves,
--   because all six are externalUrl rows. It is NOT lossless for any
--   gallery row added after the migration with "assetId" set and
--   "externalUrl" NULL: array_agg would write a NULL element into a
--   String[] that Prisma cannot represent. If such rows exist by then,
--   resolve them to a MediaAsset url first:
--     COALESCE(g."externalUrl", (SELECT m."url" FROM "MediaAsset" m
--                                 WHERE m."id" = g."assetId"))
--   The rollback also discards "createdAt" and any "logoAssetId", which
--   the old schema has nowhere to hold.
--
-- COUPLING (not SQL, but it belongs in the migration)
--   Dropping "Project"."images" breaks the currently generated Prisma
--   client: it SELECTs that column on every project read. The branch
--   serves no traffic, so nothing breaks there, but the code half
--   (prisma generate + the four readers that take images[0] switching to
--   an explicitly ordered gallery relation) has to land before this shape
--   reaches anything that serves. Nothing writes "ProjectHealth" yet, and
--   nothing clears it when "Project"."live" is edited - both are open
--   items recorded in the cluster's open_problems, not fixable in SQL.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PREFLIGHT. Run these first and read them. Every one must match.
-- ---------------------------------------------------------------------

-- 1. The source column is present, the three targets are absent, and the
--    FK target table exists.
--    expected: t | t | t | t | t
SELECT EXISTS (SELECT 1 FROM "information_schema"."columns"
                WHERE "table_schema" = 'public' AND "table_name" = 'Project'
                  AND "column_name" = 'images')                AS images_present,
       to_regclass('public."ProjectImage"')  IS NULL           AS project_image_absent,
       to_regclass('public."ProjectHealth"') IS NULL           AS project_health_absent,
       NOT EXISTS (SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
                    WHERE t."typname" = 'LiveProbeStatus' AND n."nspname" = 'public')
                                                              AS enum_absent,
       to_regclass('public."MediaAsset"')    IS NOT NULL       AS fk_target_present;

-- 2. "images" really is a text array. It was added by db push, not by any
--    migration (schema-v2.md: "images exists only in the datamodel"), so
--    its storage type is not asserted anywhere in the history. If this
--    comes back jsonb the unnest below is wrong.
--    expected: ARRAY | _text | YES
--    The first two columns are the assertion. "is_nullable" is
--    informational: Prisma emits a bare TEXT[] for a scalar list, so YES
--    is expected, but NO would be fine too - the COALESCE in every
--    statement below handles either.
SELECT "data_type", "udt_name", "is_nullable"
  FROM "information_schema"."columns"
 WHERE "table_schema" = 'public' AND "table_name" = 'Project'
   AND "column_name" = 'images';

-- 3. Row shape. Six projects, all PUBLISHED, none with a NULL array.
--    expected: 6 | 6 | 0 | 6 | 6
SELECT count(*)                                                       AS projects,
       count(*) FILTER (WHERE "status" = 'PUBLISHED')                  AS published,
       count(*) FILTER (WHERE "images" IS NULL)                        AS null_arrays,
       sum(COALESCE(array_length("images", 1), 0))                     AS image_elements,
       count(*) FILTER (WHERE "logoUrl" IS NOT NULL)                   AS with_logo_url
  FROM "Project";

-- 4. The two lifecycle CHECKs will pass. Both counts are the rows the
--    CHECK would reject, so both must be 0 BEFORE the constraint is
--    added. Step 2 below repairs the first case; the second has no
--    defensible automatic repair (inventing a publishAt is a content
--    decision, and downgrading to DRAFT unpublishes a live card), so if
--    this is non-zero, STOP and fix the rows by hand.
--    expected: 0 | 0
SELECT count(*) FILTER (WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL) AS published_unstamped,
       count(*) FILTER (WHERE "status" = 'SCHEDULED' AND "publishAt"   IS NULL) AS scheduled_unstamped
  FROM "Project";

-- 5. Every element of every array is a usable, non-blank string. A NULL
--    element would land as (assetId NULL, externalUrl NULL) and abort on
--    ProjectImage_source_check; the INSERT deliberately does not filter
--    those out, so that they abort loudly rather than vanish.
--    expected: 0 | 0
SELECT count(*) FILTER (WHERE g."img" IS NULL)         AS null_elements,
       count(*) FILTER (WHERE btrim(COALESCE(g."img", 'x')) = '') AS blank_elements
  FROM "Project" p
  CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord");

-- 6. No gallery path matches any MediaAsset, by key or by url, with or
--    without the leading slash. This is the claim that makes externalUrl
--    correct and assetId impossible. If it is non-zero, STOP: those rows
--    should become assetId rows instead.
--    expected: 0
SELECT count(*)
  FROM "Project" p
  CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
  JOIN "MediaAsset" m
    ON m."key" = g."img" OR m."key" = ltrim(g."img", '/')
    OR m."url" = g."img" OR m."url" = '/' || ltrim(g."img", '/');

-- 7. Same test for the six logo paths. If it is non-zero, the matching
--    rows want logoAssetId set and logoUrl cleared, which this migration
--    does not do.
--    expected: 0
SELECT count(*)
  FROM "Project" p
  JOIN "MediaAsset" m
    ON m."key" = p."logoUrl" OR m."key" = ltrim(p."logoUrl", '/')
    OR m."url" = p."logoUrl" OR m."url" = '/' || ltrim(p."logoUrl", '/')
 WHERE p."logoUrl" IS NOT NULL;

-- 8. The two status indexes this cluster must LEAVE ALONE are present, so
--    that "kept" can be verified as "kept" rather than "recreated".
--    expected: 2 rows - Project_status_publishAt_idx, Project_status_publishedAt_idx
SELECT "indexname"
  FROM "pg_indexes"
 WHERE "schemaname" = 'public' AND "tablename" = 'Project'
   AND "indexname" LIKE 'Project_status_%'
 ORDER BY "indexname";

-- 9. MediaAsset."id" is a plain text primary key, which is what the two
--    new foreign keys reference. If the media cluster has retyped it,
--    that cluster must run before this one.
--    expected: MediaAsset_pkey | PRIMARY KEY (id) , and text
SELECT (SELECT c."conname" || ' | ' || pg_get_constraintdef(c."oid")
          FROM "pg_constraint" c
         WHERE c."conrelid" = 'public."MediaAsset"'::regclass AND c."contype" = 'p') AS media_pk,
       (SELECT "data_type" FROM "information_schema"."columns"
         WHERE "table_schema" = 'public' AND "table_name" = 'MediaAsset'
           AND "column_name" = 'id')                                                AS media_id_type;

-- 10. No constraint or index name this file creates is already taken.
--     expected: 0 rows
SELECT "conname" AS taken_name FROM "pg_constraint"
 WHERE "conname" IN ('Project_logoAssetId_fkey',
                     'Project_publishedAt_required_check',
                     'Project_publishAt_required_check',
                     'Project_logo_source_check')
UNION ALL
SELECT "indexname" FROM "pg_indexes"
 WHERE "schemaname" = 'public' AND "indexname" = 'Project_logoAssetId_idx';


-- ---------------------------------------------------------------------
-- PREFLIGHT GATE. The same assertions, as a hard stop. Aborts the
-- transaction rather than letting a later statement fail halfway.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    bad_elements  bigint;
    asset_matches bigint;
    logo_matches  bigint;
    scheduled_bad bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "information_schema"."columns"
                    WHERE "table_schema" = 'public' AND "table_name" = 'Project'
                      AND "column_name" = 'images') THEN
        RAISE EXCEPTION 'Project."images" is already gone - this cluster has already run past its point of no return';
    END IF;

    IF (SELECT "udt_name" FROM "information_schema"."columns"
         WHERE "table_schema" = 'public' AND "table_name" = 'Project'
           AND "column_name" = 'images') <> '_text' THEN
        RAISE EXCEPTION 'Project."images" is not text[]; the gallery backfill assumes unnest() over text[]';
    END IF;

    IF to_regclass('public."MediaAsset"') IS NULL THEN
        RAISE EXCEPTION 'MediaAsset is missing; both new foreign keys reference it';
    END IF;

    SELECT count(*) INTO bad_elements
      FROM "Project" p
      CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
     WHERE g."img" IS NULL OR btrim(g."img") = '';
    IF bad_elements <> 0 THEN
        RAISE EXCEPTION 'Project."images" holds % null or blank element(s); decide what they mean before backfilling', bad_elements;
    END IF;

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

    SELECT count(*) INTO scheduled_bad
      FROM "Project" WHERE "status" = 'SCHEDULED' AND "publishAt" IS NULL;
    IF scheduled_bad <> 0 THEN
        RAISE EXCEPTION '% SCHEDULED project(s) have no publishAt; there is no defensible automatic repair', scheduled_bad;
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- STEP 1. The two new columns on "Project".
-- "logoUrl" is untouched: schema-v2.md is explicit that the new FK sits
-- BESIDE the old string column, because cdnUrl passes an absolute
-- off-bucket URL straight through and such a logo has nowhere else to
-- live.
-- "createdAt" takes DEFAULT CURRENT_TIMESTAMP, which the schema declares
-- as @default(now()) and which therefore STAYS. CURRENT_TIMESTAMP is
-- stable, so Postgres stores one attmissingval and does not rewrite the
-- table; every existing row gets the same stamp, which step 3 then
-- corrects downwards.
-- ---------------------------------------------------------------------

ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "logoAssetId" TEXT,
    ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- @@index([logoAssetId]). Six rows, so this is intent-recording and a
-- cheap access path for the SetNull sweep when an asset is deleted, not a
-- performance fix.
CREATE INDEX IF NOT EXISTS "Project_logoAssetId_idx" ON "Project" ("logoAssetId");

-- onDelete: SetNull. Prisma emits ON UPDATE CASCADE beside it.
-- DROP-then-ADD because ADD CONSTRAINT has no IF NOT EXISTS.
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_logoAssetId_fkey";
ALTER TABLE "Project" ADD CONSTRAINT "Project_logoAssetId_fkey"
    FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- STEP 2. Lifecycle repair, before the CHECK that would reject it.
-- schema-v2.md: "the only backfill that stamped published projects ran a
-- month of writes ago, so ADD CONSTRAINT can fail outright". Per
-- data-facts all six rows are currently stamped, so this is expected to
-- touch 0 rows - it is here because a row published by the admin between
-- the dump and the run would need it, and because it costs nothing.
-- COALESCE order: publishAt is the operator's own intended date, so it
-- beats updatedAt, which is only the last write.
-- Raw SQL, so this does not bump "updatedAt".
-- expected: UPDATE 0
-- ---------------------------------------------------------------------

UPDATE "Project"
   SET "publishedAt" = COALESCE("publishAt", "updatedAt")
 WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;


-- ---------------------------------------------------------------------
-- STEP 3. createdAt backfill. LEAST ignores NULLs in Postgres and
-- "updatedAt" is NOT NULL, so the result is never NULL.
-- The "createdAt" > LEAST(...) guard makes this monotone-backwards: it
-- only ever moves a stamp earlier, so a second run is a no-op and a
-- re-run after an unrelated edit cannot push creation into the future.
-- expected: UPDATE 6
-- ---------------------------------------------------------------------

UPDATE "Project"
   SET "createdAt" = LEAST("publishedAt", "publishAt", "updatedAt")
 WHERE LEAST("publishedAt", "publishAt", "updatedAt") IS NOT NULL
   AND "createdAt" > LEAST("publishedAt", "publishAt", "updatedAt");


-- ---------------------------------------------------------------------
-- STEP 4. The three CHECKs on "Project".
-- Added VALIDATED: six rows, and step 2 plus the preflight gate have
-- already proven the table satisfies all three.
-- The two lifecycle CHECKs are what make the admin's "published with no
-- publish date" warning banner unreachable.
-- The logo CHECK is at-most-one, not exactly-one: a project with neither
-- a logo asset nor a logo URL is legal and simply renders no mark.
-- ---------------------------------------------------------------------

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishedAt_required_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_publishedAt_required_check"
    CHECK ("status" <> 'PUBLISHED'::"ContentStatus" OR "publishedAt" IS NOT NULL);

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_publishAt_required_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_publishAt_required_check"
    CHECK ("status" <> 'SCHEDULED'::"ContentStatus" OR "publishAt" IS NOT NULL);

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_logo_source_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_logo_source_check"
    CHECK ("logoAssetId" IS NULL OR "logoUrl" IS NULL);


-- ---------------------------------------------------------------------
-- STEP 5. "ProjectImage". Surrogate "id" TEXT, no database default:
-- Prisma's @default(uuid()) is client-side, exactly as in every other
-- table in this schema (20260307195336_init writes a bare
-- '"id" TEXT NOT NULL'). The backfill below supplies its own uuids.
-- PK, both FKs and the CHECK are inline so the whole statement is
-- IF NOT EXISTS-able; the pg_constraint rows are identical to what
-- ALTER TABLE ... ADD CONSTRAINT would produce.
-- "sortOrder" INTEGER NOT NULL with NO default, matching the schema.
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

    -- exactly one of assetId and externalUrl. Not at-most-one: an empty
    -- gallery slot is represented by the absence of the row, so a row
    -- with neither source is meaningless and a row with both is
    -- ambiguous about which one renders.
    CONSTRAINT "ProjectImage_source_check"
        CHECK (("assetId" IS NOT NULL) <> ("externalUrl" IS NOT NULL))
);

-- @@index([projectId, sortOrder]) - the parent-prefix lookup every read
-- does, now that the readers have to pass an explicit orderBy.
CREATE INDEX IF NOT EXISTS "ProjectImage_projectId_sortOrder_idx"
    ON "ProjectImage" ("projectId", "sortOrder");

-- @@index([assetId]) - carried for the Cascade delete when a MediaAsset
-- is removed, not for a reader.
CREATE INDEX IF NOT EXISTS "ProjectImage_assetId_idx"
    ON "ProjectImage" ("assetId");


-- ---------------------------------------------------------------------
-- STEP 6. Backfill the gallery from "Project"."images".
-- WITH ORDINALITY is 1-based, so "ord" - 1 gives the repo's 0-based
-- sortOrder. gen_random_uuid() is core Postgres 13+; cast to text
-- because Prisma's @default(uuid()) column is TEXT, not UUID.
-- No filter on "img": preflight 5 and the gate proved there are no NULL
-- or blank elements, and a filter here would let a future NULL element
-- disappear silently instead of aborting on ProjectImage_source_check.
-- The anti-join keys on (projectId, externalUrl, sortOrder) so that a
-- re-run inside the same transaction attempt inserts nothing, while two
-- genuinely identical paths at different ordinals both still land.
-- expected: INSERT 0 6
-- ---------------------------------------------------------------------

INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
SELECT gen_random_uuid()::text,
       p."id",
       NULL::text,
       g."img",
       (g."ord" - 1)::int
  FROM "Project" p
  CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
 WHERE NOT EXISTS (
        SELECT 1 FROM "ProjectImage" x
         WHERE x."projectId"   = p."id"
           AND x."externalUrl" = g."img"
           AND x."sortOrder"   = (g."ord" - 1)::int);


-- ---------------------------------------------------------------------
-- GUARD. Prove the array contents landed BEFORE the column is dropped.
-- This is the one check that cannot live in the verification section:
-- after the DROP there is nothing left to compare against.
-- Compares the (projectId, path, ordinal) multiset in both directions.
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

    IF EXISTS (SELECT 1 FROM "ProjectImage" WHERE "assetId" IS NOT NULL) THEN
        RAISE EXCEPTION 'a backfilled gallery row has assetId set; no MediaAsset matches any path, so this is a bug';
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- STEP 7. Drop the array. Point of no return for re-running this file.
-- Everything it held is in "ProjectImage", proven one statement above.
-- ---------------------------------------------------------------------

ALTER TABLE "Project" DROP COLUMN IF EXISTS "images";


-- ---------------------------------------------------------------------
-- STEP 8. "LiveProbeStatus". LOWERCASE members on purpose: the value is
-- printed and used directly as a CSS class, so 'UP' would print wrong
-- and paint a healthy project red, and @map would not help because the
-- Prisma client returns the member name either way.
-- 'unknown' is deliberately not a member - it is "checkedAt" IS NULL.
-- Member order matches schema.prisma (up, then down).
-- CREATE TYPE has no IF NOT EXISTS, hence the guard.
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "pg_type" t
                     JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
                    WHERE t."typname" = 'LiveProbeStatus' AND n."nspname" = 'public') THEN
        CREATE TYPE "LiveProbeStatus" AS ENUM ('up', 'down');
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- STEP 9. "ProjectHealth". Created EMPTY and stays empty: nothing in the
-- repo writes it yet, the probe still runs inline in the homepage render,
-- and an invented row would print "up - 0 ms" for a URL nobody probed.
-- "projectId" is both the primary key and the foreign key, so the
-- Cascade delete needs no separate index and the schema declares none.
-- No index on "status" or "checkedAt" either: the probe's scan over a
-- handful of rows is a deliberate seq scan.
-- The three pairing CHECKs, inline for the same IF NOT EXISTS reason:
--   1. "status" and "checkedAt" are both set or both null. A status with
--      no timestamp is unfalsifiable; a timestamp with no status cannot
--      be distinguished from "never probed".
--   2. "latencyMs" requires "status". A latency for an unknown outcome
--      means nothing.
--   3. "latencyMs" >= 0. Milliseconds.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ProjectHealth" (
    "projectId" TEXT NOT NULL,
    "status"    "LiveProbeStatus",
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectHealth_pkey" PRIMARY KEY ("projectId"),

    CONSTRAINT "ProjectHealth_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT "ProjectHealth_status_checkedAt_check"
        CHECK (("status" IS NULL) = ("checkedAt" IS NULL)),

    CONSTRAINT "ProjectHealth_latencyMs_requires_status_check"
        CHECK ("latencyMs" IS NULL OR "status" IS NOT NULL),

    CONSTRAINT "ProjectHealth_latencyMs_nonneg_check"
        CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0)
);


-- ---------------------------------------------------------------------
-- VERIFICATION. Run after the DDL/DML, before COMMIT.
-- ---------------------------------------------------------------------

-- V1. The gallery landed: six rows, one per project, all externalUrl,
--     all sortOrder 0 (because every array had exactly one element).
--     expected: 6 | 6 | 6 | 0 | 0 | 0
SELECT count(*)                                            AS gallery_rows,
       count(DISTINCT "projectId")                          AS projects_covered,
       count(*) FILTER (WHERE "externalUrl" LIKE '/projects/%') AS project_paths,
       count(*) FILTER (WHERE "assetId" IS NOT NULL)        AS with_asset,
       count(*) FILTER (WHERE "sortOrder" <> 0)             AS non_zero_order,
       count(*) FILTER (WHERE "externalUrl" IS NULL)        AS without_source
  FROM "ProjectImage";

-- V2. The exact six paths, so the six known values can be eyeballed.
--     expected: 6 rows, and "cover" is the old images[0] of each project
--       Connect     | /projects/connect.png     | 0
--       Draw Sheet  | /projects/drawsheet.png   | 0
--       Grill       | /projects/grill_v1.png    | 0
--       Netflix-GPT | /projects/netflix-gpt.png | 0
--       NextMoveApp | /projects/nextmove_v1.png | 0
--       Trimrr      | /projects/trimrr.png      | 0
SELECT p."title", g."externalUrl" AS "cover", g."sortOrder"
  FROM "ProjectImage" g JOIN "Project" p ON p."id" = g."projectId"
 ORDER BY p."title", g."sortOrder";

-- V3. sortOrder is a dense 0-based sequence inside every project.
--     expected: 0 rows
SELECT "projectId", count(*) AS slots, min("sortOrder") AS lo,
       max("sortOrder") AS hi, count(DISTINCT "sortOrder") AS distinct_order
  FROM "ProjectImage"
 GROUP BY "projectId"
HAVING min("sortOrder") <> 0
    OR max("sortOrder") <> count(*) - 1
    OR count(DISTINCT "sortOrder") <> count(*);

-- V4. The array is gone and nothing else on "Project" was disturbed.
--     expected exactly these thirteen rows, in this order:
--       createdAt   | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       github      | text                        | YES | (null)
--       id          | text                        | NO  | (null)
--       live        | text                        | YES | (null)
--       logoAssetId | text                        | YES | (null)
--       logoUrl     | text                        | YES | (null)
--       publishAt   | timestamp without time zone | YES | (null)
--       publishedAt | timestamp without time zone | YES | (null)
--       sortOrder   | integer                     | NO  | (null)
--       status      | USER-DEFINED                | NO  | 'DRAFT'::"ContentStatus"
--       summary     | text                        | NO  | (null)
--       title       | text                        | NO  | (null)
--       updatedAt   | timestamp without time zone | NO  | (null)
--     "images" must NOT appear. "createdAt" MUST keep its default -
--     the schema declares @default(now()), so dropping it would be drift -
--     and "updatedAt" must NOT have one, because @updatedAt is written
--     client-side. The row order is collation-dependent; what is being
--     asserted is the set of thirteen and the absence of "images".
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = 'public' AND "table_name" = 'Project'
 ORDER BY "column_name";

-- V5. createdAt is a real lower bound, not the migration date. The
--     exact value cannot be predicted here because Project."updatedAt"
--     is not in data-facts.txt, so this asserts the invariant instead:
--     no row was created after it was published, after it was last
--     written, or today.
--     expected: 6 | 0 | 0 | 0
SELECT count(*)                                                        AS projects,
       count(*) FILTER (WHERE "createdAt" > "updatedAt")               AS created_after_update,
       count(*) FILTER (WHERE "publishedAt" IS NOT NULL
                          AND "createdAt" > "publishedAt")             AS created_after_publish,
       count(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE)        AS stamped_today
  FROM "Project";

-- V6. Logos: still on logoUrl, no asset pointer, so the at-most-one
--     CHECK is satisfied with room to spare.
--     expected: 6 | 6 | 0 | 0
SELECT count(*)                                                                AS projects,
       count(*) FILTER (WHERE "logoUrl" IS NOT NULL)                            AS with_logo_url,
       count(*) FILTER (WHERE "logoAssetId" IS NOT NULL)                        AS with_logo_asset,
       count(*) FILTER (WHERE "logoAssetId" IS NOT NULL AND "logoUrl" IS NOT NULL) AS with_both
  FROM "Project";

-- V7. ProjectHealth exists and is empty; the enum has exactly two
--     lowercase labels in declaration order.
--     expected: t | 0 | up,down
SELECT to_regclass('public."ProjectHealth"') IS NOT NULL AS health_table_present,
       (SELECT count(*) FROM "ProjectHealth")            AS health_rows,
       (SELECT string_agg(e."enumlabel", ',' ORDER BY e."enumsortorder")
          FROM "pg_enum" e
          JOIN "pg_type" t ON t."oid" = e."enumtypid"
          JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
         WHERE t."typname" = 'LiveProbeStatus'
           AND n."nspname" = 'public')                   AS probe_labels;

-- V8. Every constraint on the three tables, by name and definition.
--     Read the definitions; Postgres reprints them normalised, so expect
--     extra parentheses.
--     expected exactly these fourteen rows:
--       Project        | Project_logoAssetId_fkey                      | f
--       Project        | Project_logo_source_check                     | c
--       Project        | Project_pkey                                  | p
--       Project        | Project_publishAt_required_check              | c
--       Project        | Project_publishedAt_required_check            | c
--       ProjectHealth  | ProjectHealth_latencyMs_nonneg_check          | c
--       ProjectHealth  | ProjectHealth_latencyMs_requires_status_check | c
--       ProjectHealth  | ProjectHealth_pkey                            | p
--       ProjectHealth  | ProjectHealth_projectId_fkey                  | f
--       ProjectHealth  | ProjectHealth_status_checkedAt_check          | c
--       ProjectImage   | ProjectImage_assetId_fkey                     | f
--       ProjectImage   | ProjectImage_pkey                             | p
--       ProjectImage   | ProjectImage_projectId_fkey                   | f
--       ProjectImage   | ProjectImage_source_check                     | c
--     Project_pkey is pre-existing and must be untouched. NOT NULL
--     constraints do not appear in pg_constraint on Postgres 17, so
--     nothing is missing from this list.
SELECT c."conrelid"::regclass::text AS tbl, c."conname", c."contype",
       pg_get_constraintdef(c."oid") AS definition
  FROM "pg_constraint" c
 WHERE c."conrelid" IN ('public."Project"'::regclass,
                        'public."ProjectImage"'::regclass,
                        'public."ProjectHealth"'::regclass)
   AND c."contype" IN ('p', 'f', 'c')
 ORDER BY tbl, c."conname";

-- V9. Foreign key actions, decoded. confdeltype: n = SET NULL,
--     c = CASCADE. confupdtype: c = CASCADE, which is what Prisma emits
--     for every relation in this schema.
--     expected: 4 rows
--       Project_logoAssetId_fkey     | n | c
--       ProjectHealth_projectId_fkey | c | c
--       ProjectImage_assetId_fkey    | c | c
--       ProjectImage_projectId_fkey  | c | c
SELECT c."conname", c."confdeltype", c."confupdtype"
  FROM "pg_constraint" c
 WHERE c."conrelid" IN ('public."Project"'::regclass,
                        'public."ProjectImage"'::regclass,
                        'public."ProjectHealth"'::regclass)
   AND c."contype" = 'f'
 ORDER BY c."conname";

-- V10. Indexes. The two status indexes must still be there, untouched,
--      alongside the three new ones. Nothing else.
--      expected: 8 rows, in any collation order
--        Project       | Project_logoAssetId_idx
--        Project       | Project_pkey
--        Project       | Project_status_publishAt_idx
--        Project       | Project_status_publishedAt_idx
--        ProjectHealth | ProjectHealth_pkey
--        ProjectImage  | ProjectImage_assetId_idx
--        ProjectImage  | ProjectImage_pkey
--        ProjectImage  | ProjectImage_projectId_sortOrder_idx
SELECT "tablename", "indexname"
  FROM "pg_indexes"
 WHERE "schemaname" = 'public'
   AND "tablename" IN ('Project', 'ProjectImage', 'ProjectHealth')
 ORDER BY "tablename", "indexname";

-- V11. No orphan reference in either direction, so both FKs are live.
--      expected: 0 | 0 | 0
SELECT (SELECT count(*) FROM "ProjectImage" g
          WHERE NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = g."projectId"))    AS orphan_gallery_project,
       (SELECT count(*) FROM "ProjectImage" g
          WHERE g."assetId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "MediaAsset" m WHERE m."id" = g."assetId")) AS orphan_gallery_asset,
       (SELECT count(*) FROM "Project" p
          WHERE p."logoAssetId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "MediaAsset" m WHERE m."id" = p."logoAssetId")) AS orphan_logo_asset;


-- ---------------------------------------------------------------------
-- V12. BEHAVIOURAL PROOF. A name in pg_constraint proves a row exists,
-- not that the predicate bites. This probes all seven CHECKs with a
-- value each one must reject, inside plpgsql sub-blocks so every
-- rejection is rolled back to its implicit savepoint and the
-- transaction survives. If any CHECK fails to fire, the block raises
-- and the whole migration aborts - which is the correct outcome, and
-- also undoes the probe row that got through.
-- Nothing here is left behind on success: eight expected violations
-- across the seven CHECKs (ProjectImage_source_check is probed from both
-- sides), eight automatic rollbacks, one well-formed row inserted and
-- deleted, zero net change. V13 re-counts to prove that.
--      expected: seven NOTICEs, no rows, no error
-- ---------------------------------------------------------------------

DO $$
DECLARE
    pid   text;
    lid   text;
    aid   text;
    fired boolean;
BEGIN
    SELECT "id" INTO pid FROM "Project"
     WHERE "status" = 'PUBLISHED'::"ContentStatus" AND "publishedAt" IS NOT NULL
     ORDER BY "id" LIMIT 1;
    SELECT "id" INTO lid FROM "Project" WHERE "logoUrl" IS NOT NULL ORDER BY "id" LIMIT 1;
    SELECT "id" INTO aid FROM "MediaAsset" ORDER BY "id" LIMIT 1;
    IF pid IS NULL THEN
        RAISE EXCEPTION 'no PUBLISHED, stamped Project row to probe the lifecycle CHECKs against';
    END IF;

    -- 1. Project_publishedAt_required_check
    fired := false;
    BEGIN
        UPDATE "Project" SET "publishedAt" = NULL WHERE "id" = pid;
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN RAISE EXCEPTION 'Project_publishedAt_required_check does not fire'; END IF;
    RAISE NOTICE 'Project_publishedAt_required_check: fires';

    -- 2. Project_publishAt_required_check
    fired := false;
    BEGIN
        UPDATE "Project" SET "status" = 'SCHEDULED'::"ContentStatus", "publishAt" = NULL WHERE "id" = pid;
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN RAISE EXCEPTION 'Project_publishAt_required_check does not fire'; END IF;
    RAISE NOTICE 'Project_publishAt_required_check: fires';

    -- 3. Project_logo_source_check. Needs a real MediaAsset id, because
    --    the FK is checked too, and a row that already has a logoUrl, or
    --    setting logoAssetId would be legal. Both are skipped with a
    --    NOTICE rather than a silent pass if either is unavailable.
    IF aid IS NULL OR lid IS NULL THEN
        RAISE NOTICE 'Project_logo_source_check: NOT PROBED (MediaAsset empty: %, no Project with logoUrl: %)',
                     aid IS NULL, lid IS NULL;
    ELSE
        fired := false;
        BEGIN
            UPDATE "Project" SET "logoAssetId" = aid WHERE "id" = lid;
        EXCEPTION WHEN check_violation THEN fired := true;
        END;
        IF NOT fired THEN RAISE EXCEPTION 'Project_logo_source_check does not fire'; END IF;
        RAISE NOTICE 'Project_logo_source_check: fires';
    END IF;

    -- 4. ProjectImage_source_check, neither source set.
    fired := false;
    BEGIN
        INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
        VALUES ('probe-neither', pid, NULL, NULL, 99);
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN
        DELETE FROM "ProjectImage" WHERE "id" = 'probe-neither';
        RAISE EXCEPTION 'ProjectImage_source_check does not reject (NULL, NULL)';
    END IF;

    -- 4b. ProjectImage_source_check, both sources set.
    IF aid IS NULL THEN
        RAISE NOTICE 'ProjectImage_source_check: rejects neither-set; both-set NOT PROBED (MediaAsset is empty)';
    ELSE
        fired := false;
        BEGIN
            INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
            VALUES ('probe-both', pid, aid, '/probe.png', 99);
        EXCEPTION WHEN check_violation THEN fired := true;
        END;
        IF NOT fired THEN
            DELETE FROM "ProjectImage" WHERE "id" = 'probe-both';
            RAISE EXCEPTION 'ProjectImage_source_check does not reject both sources set';
        END IF;
        RAISE NOTICE 'ProjectImage_source_check: rejects neither-set and both-set';
    END IF;

    -- 5. ProjectHealth_status_checkedAt_check
    fired := false;
    BEGIN
        INSERT INTO "ProjectHealth" ("projectId", "status", "latencyMs", "checkedAt")
        VALUES (pid, 'up'::"LiveProbeStatus", NULL, NULL);
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN
        DELETE FROM "ProjectHealth" WHERE "projectId" = pid;
        RAISE EXCEPTION 'ProjectHealth_status_checkedAt_check does not fire';
    END IF;
    RAISE NOTICE 'ProjectHealth_status_checkedAt_check: fires';

    -- 6. ProjectHealth_latencyMs_requires_status_check
    fired := false;
    BEGIN
        INSERT INTO "ProjectHealth" ("projectId", "status", "latencyMs", "checkedAt")
        VALUES (pid, NULL, 120, NULL);
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN
        DELETE FROM "ProjectHealth" WHERE "projectId" = pid;
        RAISE EXCEPTION 'ProjectHealth_latencyMs_requires_status_check does not fire';
    END IF;
    RAISE NOTICE 'ProjectHealth_latencyMs_requires_status_check: fires';

    -- 7. ProjectHealth_latencyMs_nonneg_check
    fired := false;
    BEGIN
        INSERT INTO "ProjectHealth" ("projectId", "status", "latencyMs", "checkedAt")
        VALUES (pid, 'up'::"LiveProbeStatus", -1, CURRENT_TIMESTAMP);
    EXCEPTION WHEN check_violation THEN fired := true;
    END;
    IF NOT fired THEN
        DELETE FROM "ProjectHealth" WHERE "projectId" = pid;
        RAISE EXCEPTION 'ProjectHealth_latencyMs_nonneg_check does not fire';
    END IF;
    RAISE NOTICE 'ProjectHealth_latencyMs_nonneg_check: fires';

    -- A legal row must still be accepted, or the CHECKs are too strict.
    INSERT INTO "ProjectHealth" ("projectId", "status", "latencyMs", "checkedAt")
    VALUES (pid, 'up'::"LiveProbeStatus", 0, CURRENT_TIMESTAMP);
    DELETE FROM "ProjectHealth" WHERE "projectId" = pid;
    RAISE NOTICE 'ProjectHealth accepts a well-formed row';
END
$$;

-- V13. The probes left nothing behind.
--      expected: 0 | 6 | 6
SELECT (SELECT count(*) FROM "ProjectHealth")                                   AS health_rows,
       (SELECT count(*) FROM "ProjectImage")                                    AS gallery_rows,
       (SELECT count(*) FROM "Project" WHERE "status" = 'PUBLISHED'
                                         AND "publishedAt" IS NOT NULL)         AS published_stamped;
