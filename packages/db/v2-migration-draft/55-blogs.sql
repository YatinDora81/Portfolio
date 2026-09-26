-- =============================================================================
-- cluster 55-blogs
-- target: the Neon child branch (copy-on-write clone of production, no traffic)
-- Postgres 17, role is the database owner and NOT a superuser.
-- =============================================================================
--
-- WHAT THIS CLUSTER DOES
--
--   Blog only. Ten rows, all "status" = 'DRAFT', all "publishAt" IS NULL, all
--   "show" = false, every "publishedAt" a creation stamp from 2026-03-08
--   07:24:25.xxx (/tmp/v2/data-facts.txt, "Blog.image / orientation /
--   lifecycle"). Nine changes, in this order:
--
--   1. ADD "createdAt" TIMESTAMP(3), backfilled from the OLD "publishedAt".
--      "publishedAt" carried DEFAULT CURRENT_TIMESTAMP since 20260307195336_init
--      and nothing in the admin has ever written it except the publish stamp, so
--      today it IS the creation stamp. Copying it across is what makes step 3
--      safe: the instant survives verbatim, only its meaning changes.
--      Added nullable -> backfilled -> SET NOT NULL + SET DEFAULT, the house
--      three-step from 20260822100000/100100/100200, because a NOT NULL column
--      whose value has to come from another column cannot be added in one shot
--      without a wrong default landing first.
--
--   2. "publishedAt" loses its NOT NULL and its DEFAULT CURRENT_TIMESTAMP. The
--      new schema declares `publishedAt DateTime?` with no default; leaving the
--      default in place is drift that `prisma migrate diff` would report.
--
--   3. "publishedAt" := NULL for every DRAFT/SCHEDULED row still carrying that
--      creation stamp. All ten rows qualify today, so all ten end up NULL.
--      THIS IS THE ONE DELIBERATELY INFORMATION-LOSING STEP in this cluster --
--      see the data-loss note below for why it is acceptable and why the
--      rollback is nevertheless exact for today's data. The predicate is
--      `"publishedAt" = "createdAt"`, i.e. "indistinguishable from the creation
--      stamp", not a blanket `IS NOT NULL`: a row with a genuine editorial date
--      must keep it, and after this cluster runs a re-run must not eat one.
--
--   4. ADD "coverAssetId" TEXT + "Blog_coverAssetId_fkey" (SetNull) +
--      "Blog_coverAssetId_idx", while KEEPING "image". Left NULL on all ten
--      rows: every "image" is an absolute https://images.unsplash.com URL, and
--      "MediaAsset" holds exactly two rows, neither of which is one of them
--      (/tmp/v2/data-facts.txt, "MediaAsset (2)"). There is no honest id to put
--      here, so none is invented.
--
--   5. "image" becomes nullable, and '' maps to NULL. Production holds zero
--      empty strings -- the ten empty strings schema-v2.md warns about are in
--      the SEED, not in this database -- so the UPDATE is a no-op here and is
--      present so that the invariant "'' never reaches the new column" is
--      established by the migration rather than assumed.
--
--   6. "Blog_cover_source_check": at most one of "coverAssetId" / "image".
--      Named after "Experience_logo_source_check", which is the same shape.
--
--   7. The two lifecycle CHECKs from the schema-v2.md inventory:
--      "Blog_publishedAt_required_check" -- status <> PUBLISHED OR publishedAt IS NOT NULL
--      "Blog_publishAt_required_check"   -- status <> SCHEDULED OR publishAt IS NOT NULL
--      Both are vacuously true on ten DRAFT rows; they exist to stop the next
--      writer, not to fix these rows.
--
--   8. "Blog_status_publishedAt_idx" is dropped and recreated as
--      ("status", "publishedAt" DESC). Same NAME -- Prisma derives an index name
--      from table + column list and ignores the sort modifier, so
--      @@index([status, publishedAt(sort: Desc)]) still expects
--      "Blog_status_publishedAt_idx". Renaming it would be drift.
--      DESC defaults to NULLS FIRST, so after step 3 all ten NULL rows sort
--      ahead of everything; schema-v2.md flags this and it is correct, because
--      publishedAt IS NULL means "never published" and the readers filter on
--      status before they sort.
--
--   9. DROP COLUMN "show".
--
--   NOT TOUCHED, on purpose: "imageOrientation" and the "ImageOrientation" enum
--   (three of the ten rows are not LANDSCAPE, apps/web still SELECTs the column,
--   and dropping it is a 42703 for the public homepage -- see the departures
--   section of schema-v2.md), "Blog_slug_key", "Blog_pkey",
--   "Blog_status_publishAt_idx", "updatedAt" (already TIMESTAMP(3) NOT NULL with
--   no default, which is exactly what @updatedAt diffs to), and the
--   "ContentStatus" enum.
--
--   NOT DONE HERE: the identical pair of lifecycle CHECKs on "Project". Those
--   belong to the Project cluster, which also owns the repair UPDATE that
--   Project needs and Blog does not.
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional. Run the whole file inside one
--   BEGIN / COMMIT. There is no CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD
--   VALUE, no VACUUM, nothing that needs superuser. The DROP INDEX in step 8 and
--   the ADD CONSTRAINTs take ACCESS EXCLUSIVE on a ten-row table, which is
--   microseconds, and the branch serves no traffic anyway.
--
-- IDEMPOTENCY
--   Safe to re-run. The two ADD COLUMNs use IF NOT EXISTS, the createdAt
--   backfill is guarded on `"createdAt" IS NULL`, the publishedAt null-out is
--   guarded on `"publishedAt" = "createdAt"` (false for every row once it has
--   run, because publishedAt is then NULL), the '' -> NULL update is guarded on
--   the value, the FK and the four CHECKs are DROP IF EXISTS then ADD, the index
--   is DROP IF EXISTS then CREATE IF NOT EXISTS, and DROP COLUMN uses IF EXISTS.
--   SET NOT NULL / SET DEFAULT / DROP DEFAULT are all naturally idempotent.
--
-- ROLLBACK
--   ROLLBACK the transaction if it has not committed. After commit:
--
--     ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "show" BOOLEAN NOT NULL DEFAULT true;
--     UPDATE "Blog" SET "show" = false;                  -- what production actually held
--     DROP INDEX IF EXISTS "Blog_status_publishedAt_idx";
--     CREATE INDEX "Blog_status_publishedAt_idx" ON "Blog" ("status", "publishedAt");
--     ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishAt_required_check";
--     ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishedAt_required_check";
--     ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_cover_source_check";
--     ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_coverAssetId_fkey";
--     DROP INDEX IF EXISTS "Blog_coverAssetId_idx";
--     ALTER TABLE "Blog" DROP COLUMN IF EXISTS "coverAssetId";
--     UPDATE "Blog" SET "image" = '' WHERE "image" IS NULL;
--     ALTER TABLE "Blog" ALTER COLUMN "image" SET NOT NULL;
--     UPDATE "Blog" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;
--     ALTER TABLE "Blog" ALTER COLUMN "publishedAt" SET NOT NULL;
--     ALTER TABLE "Blog" ALTER COLUMN "publishedAt" SET DEFAULT CURRENT_TIMESTAMP;
--     ALTER TABLE "Blog" DROP COLUMN IF EXISTS "createdAt";
--
--   That round-trip is EXACT for today's data and only for today's data:
--     * "publishedAt" is restored from "createdAt", which was copied from it
--       millisecond for millisecond, so all ten stamps come back identical.
--       A row published AFTER this cluster runs would come back with its
--       creation stamp instead of its publish stamp -- restore from the JSON
--       dump, not from this block, in that case.
--     * "show" cannot be restored per row by DDL. It was false on all ten rows,
--       so the blanket UPDATE is faithful today. The original values also live
--       in the read-only JSON dump.
--     * "image" '' vs NULL: there are no empty strings today, so the reverse
--       UPDATE touches nothing. If a NULL is created later, rollback cannot tell
--       "was empty" from "was never set" and turns both into ''.
--     * "createdAt" is dropped; it held nothing that existed before this cluster.
--
-- =============================================================================


-- =============================================================================
-- PREFLIGHT. Every one of these must return the stated result BEFORE any DDL.
-- They are all reads and open no locks. Run them all, read them all, then run
-- the DDL.
-- =============================================================================

-- P1. Shape of the table as it stands. This cluster reads and rewrites eight of
--     these columns, so a surprise here means stop.
--     EXPECTED: exactly 14 rows ->
--       color            | text                        | NO  | (null)
--       content          | text                        | NO  | (null)
--       description      | text                        | NO  | (null)
--       id               | text                        | NO  | (null)
--       image            | text                        | NO  | (null)
--       imageOrientation | ImageOrientation (USER-DEF) | NO  | 'LANDSCAPE'::"ImageOrientation"
--       publishAt        | timestamp without time zone | YES | (null)
--       publishedAt      | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       show             | boolean                     | NO  | true
--       slug             | text                        | NO  | (null)
--       sortOrder        | integer                     | NO  | (null)
--       status           | ContentStatus (USER-DEF)    | NO  | 'DRAFT'::"ContentStatus"
--       title            | text                        | NO  | (null)
--       updatedAt        | timestamp without time zone | NO  | (null)
SELECT "column_name", "data_type", "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'Blog'
ORDER BY "column_name";

-- P2. Neither column this cluster adds may already exist. If one does, a sibling
--     cluster or a stray `db push` has been here and the ADD COLUMN IF NOT
--     EXISTS below would silently skip the backfill that belongs with it.
--     EXPECTED: 0 rows.
SELECT "column_name", "data_type", "is_nullable"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'Blog'
  AND "column_name" IN ('createdAt', 'coverAssetId');

-- P3. Row count and lifecycle census.
--     EXPECTED: 1 row -> rows=10, draft=10, scheduled=0, published=0, archived=0,
--               publishedAtNull=0, publishAtNotNull=0, showTrue=0, showFalse=10.
--     The two "show" numbers are the point of schema-v2.md's note: the dashboard
--     counts live posts with `where show = true`, which is 0 while ten posts
--     exist. Nothing is being repaired here; the column is dropped in step 9 and
--     the four admin surfaces move to the shared visibility predicate in code.
SELECT
  count(*)                                                        AS "rows",
  count(*) FILTER (WHERE "status" = 'DRAFT')                      AS "draft",
  count(*) FILTER (WHERE "status" = 'SCHEDULED')                  AS "scheduled",
  count(*) FILTER (WHERE "status" = 'PUBLISHED')                  AS "published",
  count(*) FILTER (WHERE "status" = 'ARCHIVED')                   AS "archived",
  count(*) FILTER (WHERE "publishedAt" IS NULL)                   AS "publishedAtNull",
  count(*) FILTER (WHERE "publishAt" IS NOT NULL)                 AS "publishAtNotNull",
  count(*) FILTER (WHERE "show" = true)                           AS "showTrue",
  count(*) FILTER (WHERE "show" = false)                          AS "showFalse"
FROM "Blog";

-- P4. THE LOAD-BEARING ASSERTION for the information-losing step. Print every
--     "publishedAt" that is about to be discarded, with its slug, so the value is on
--     the record in the migration log and not only in the dump. All ten are
--     2026-03-08 07:24:25.xxx, seconds apart, which is what a seed loop looks
--     like and not what ten editorial dates look like.
--     EXPECTED: exactly 10 rows, every "publishedAt" on 2026-03-08, spanning
--     07:24:25.397 to 07:24:25.981, and "willBecome" = 'NULL, value preserved in
--     createdAt' on all ten.
SELECT "slug", "status", "publishedAt", "publishAt",
       'NULL, value preserved in createdAt' AS "willBecome"
FROM "Blog"
WHERE "status" IN ('DRAFT', 'SCHEDULED')
  AND "publishedAt" IS NOT NULL
ORDER BY "publishedAt";

-- P5. Anything NOT on that list must be a PUBLISHED or ARCHIVED row keeping its
--     stamp. If this returns rows, the assumption "every publishedAt in this
--     table is a creation stamp" is false and the null-out predicate needs a
--     second look before it runs.
--     EXPECTED: 0 rows.
SELECT "slug", "status", "publishedAt"
FROM "Blog"
WHERE "status" NOT IN ('DRAFT', 'SCHEDULED');

-- P6. Preconditions for the two lifecycle CHECKs, evaluated as they will be
--     AFTER step 3. A CHECK is added VALID here, so it re-scans the table and
--     aborts the transaction on any violation.
--     EXPECTED: 1 row -> publishedViolations=0, scheduledViolations=0.
SELECT
  count(*) FILTER (WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL) AS "publishedViolations",
  count(*) FILTER (WHERE "status" = 'SCHEDULED' AND "publishAt" IS NULL)   AS "scheduledViolations"
FROM "Blog";

-- P7. Precondition for "Blog_cover_source_check". "coverAssetId" does not exist
--     yet and is added NULL on every row, so the constraint can only be violated
--     by an "image" that is somehow already set on a row that also gets an
--     asset; it cannot be, but the image census is needed anyway to justify
--     leaving "coverAssetId" NULL.
--     EXPECTED: 1 row -> rows=10, imageNotNull=10, imageEmpty=0,
--               absoluteHttps=10, unsplash=10, relative=0.
SELECT
  count(*)                                                           AS "rows",
  count(*) FILTER (WHERE "image" IS NOT NULL)                        AS "imageNotNull",
  count(*) FILTER (WHERE btrim("image") = '')                        AS "imageEmpty",
  count(*) FILTER (WHERE "image" ~ '^https://')                      AS "absoluteHttps",
  count(*) FILTER (WHERE "image" LIKE 'https://images.unsplash.com/%') AS "unsplash",
  count(*) FILTER (WHERE "image" LIKE '/%')                          AS "relative"
FROM "Blog";

-- P8. No "image" can be adopted into "MediaAsset", so no row can get a
--     "coverAssetId" in this cluster. Matched three ways -- exact key, exact url,
--     and basename -- because a near-miss would be worth knowing about even
--     though it still would not license an automatic FK.
--     EXPECTED: 0 rows. "MediaAsset" holds only
--     'suite-one/1787423289561-c10a7a05-senor-avatar-final-v2.png' and
--     'uploads/1788024018255-e15fe177-download-3.jpg'.
SELECT b."slug", b."image", m."id" AS "mediaAssetId", m."key"
FROM "Blog" b
JOIN "MediaAsset" m
  ON m."key" = b."image"
  OR m."url" = b."image"
  OR m."key" = regexp_replace(b."image", '^.*/', '')
  OR regexp_replace(m."key", '^.*/', '') = regexp_replace(split_part(b."image", '?', 1), '^.*/', '');

-- P9. The FK target. "MediaAsset"."id" must exist and be the primary key, or the
--     ADD CONSTRAINT in step 4 fails. This is the one cross-table dependency in
--     the cluster.
--     EXPECTED: 1 row -> MediaAsset_pkey | p | {id}
SELECT "conname", "contype",
       (SELECT array_agg("attname" ORDER BY "attnum")
        FROM "pg_attribute"
        WHERE "attrelid" = c."conrelid" AND "attnum" = ANY (c."conkey")) AS "columns"
FROM "pg_constraint" c
WHERE c."conrelid" = '"MediaAsset"'::regclass
  AND c."contype" = 'p';

-- P10. Current indexes on "Blog". The DESC swap in step 8 has to find the ASC
--      index under exactly this name, and "Blog_coverAssetId_idx" must not exist.
--      EXPECTED: exactly 4 rows ->
--        Blog_pkey                    | CREATE UNIQUE INDEX ... ("id")
--        Blog_slug_key                | CREATE UNIQUE INDEX ... ("slug")
--        Blog_status_publishAt_idx    | CREATE INDEX ... ("status", "publishAt")
--        Blog_status_publishedAt_idx  | CREATE INDEX ... ("status", "publishedAt")   <- no DESC
SELECT "indexname", "indexdef"
FROM "pg_indexes"
WHERE "schemaname" = current_schema()
  AND "tablename" = 'Blog'
ORDER BY "indexname";

-- P11. Current constraints on "Blog". None of the four this cluster adds may
--      exist, and nothing may depend on "show" -- an index or a CHECK mentioning
--      it would make the DROP COLUMN in step 9 do more than it says.
--      EXPECTED: exactly 1 row -> Blog_pkey | p. In particular zero rows of
--      contype 'c' and zero rows of contype 'f'.
SELECT "conname", "contype", pg_get_constraintdef("oid") AS "definition"
FROM "pg_constraint"
WHERE "conrelid" = '"Blog"'::regclass
ORDER BY "contype", "conname";

-- P12. Nothing outside "Blog" may reference "Blog"."show" through a dependency
--      Postgres knows about (generated column, index, view, constraint).
--      EXPECTED: 0 rows.
SELECT d."classid"::regclass AS "dependentKind", d."objid", d."deptype"
FROM "pg_depend" d
JOIN "pg_attribute" a
  ON a."attrelid" = d."refobjid" AND a."attnum" = d."refobjsubid"
WHERE d."refobjid" = '"Blog"'::regclass
  AND a."attname" = 'show'
  AND d."deptype" <> 'a';


-- =============================================================================
-- DDL / DML. Dependency order matters and is not negotiable:
--   createdAt must be added and backfilled BEFORE "publishedAt" is nulled,
--   because the backfill reads "publishedAt" and the null-out predicate reads
--   "createdAt". Then the nullability relaxations, then the new column and its
--   FK, then the CHECKs (which must see the final data), then the index swap,
--   then the DROP COLUMN last so an aborted run leaves the old column in place.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. "createdAt", carried over from the old "publishedAt".
--
--    Added NULLABLE first so the backfill can supply the value, exactly as
--    20260822100000 -> 100100 -> 100200 did for "status". Adding it NOT NULL
--    DEFAULT CURRENT_TIMESTAMP in one statement would stamp all ten rows with
--    the migration clock, and the UPDATE that followed could no longer tell a
--    stamped row from a genuinely new one on a re-run.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);

-- The de-facto creation stamp becomes the actual creation stamp. Guarded on
-- IS NULL so a second run cannot overwrite a real createdAt with a later
-- publish date.
UPDATE "Blog"
SET "createdAt" = "publishedAt"
WHERE "createdAt" IS NULL
  AND "publishedAt" IS NOT NULL;

-- Fallback for a row with no stamp at all. Zero rows today ("publishedAt" is
-- NOT NULL on all ten, P3), so this is a guard and not a coercion. Kept because
-- the SET NOT NULL below would otherwise abort the whole transaction, and
-- "created at some unknown point before the migration" is better served by the
-- migration clock than by refusing to migrate.
UPDATE "Blog"
SET "createdAt" = CURRENT_TIMESTAMP
WHERE "createdAt" IS NULL;

-- DEFAULT CURRENT_TIMESTAMP is KEPT: the new schema says `createdAt DateTime
-- @default(now())`, so Prisma expects the default to be there.
ALTER TABLE "Blog"
  ALTER COLUMN "createdAt" SET NOT NULL,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- -----------------------------------------------------------------------------
-- 2. "publishedAt" becomes a real, optional publish stamp.
--
--    DROP DEFAULT first, then DROP NOT NULL. The default is the whole reason the
--    column was never trustworthy: every INSERT that ignored it got "now", which
--    back-dates a scheduled post and forces the second publish path that
--    schema-v2.md collapses. The new schema declares no default, so leaving
--    CURRENT_TIMESTAMP behind is drift.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog"
  ALTER COLUMN "publishedAt" DROP DEFAULT,
  ALTER COLUMN "publishedAt" DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. *** THE DELIBERATELY INFORMATION-LOSING STEP ***
--
--    Ten DRAFT rows stop claiming a publish date they never had. What is set:
--    "publishedAt" := NULL on every row whose status is DRAFT or SCHEDULED and
--    whose "publishedAt" is byte-identical to the "createdAt" just derived from
--    it -- which is the definition of "this value came from the column default,
--    not from an editor". All ten rows of this table match. Expected: 10 rows.
--
--    Why it is acceptable: the timestamp itself is NOT destroyed, it is in
--    "createdAt" to the millisecond. What is destroyed is the assertion "this
--    draft has a publish date", which was never true: all ten are 2026-03-08
--    07:24:25.xxx, within 600ms of each other, i.e. one seed loop. Keeping them
--    would mean every draft is retroactively "published in the past", which is
--    exactly the bug the nullable column exists to remove -- publish-due would
--    refuse to stamp them because the date is already in the past, and draft
--    mode would render a publication date for an unpublished post.
--
--    The DRAFT/SCHEDULED filter is not decoration. A PUBLISHED or ARCHIVED row
--    MUST keep its stamp: "Blog_publishedAt_required_check" in step 7 rejects a
--    PUBLISHED row without one, and `publicContentWhere` needs it to decide
--    visibility. P5 proves there are no such rows today.
-- -----------------------------------------------------------------------------

UPDATE "Blog"
SET "publishedAt" = NULL
WHERE "status" IN ('DRAFT', 'SCHEDULED')
  AND "publishedAt" IS NOT NULL
  AND "publishedAt" = "createdAt";

-- -----------------------------------------------------------------------------
-- 4. "coverAssetId", beside "image" rather than instead of it.
--
--    Stays NULL on all ten rows. P8 proves no "image" corresponds to a
--    "MediaAsset", and every one of them is an absolute
--    https://images.unsplash.com URL that could not be a bucket key even in
--    principle. Adopting those files into the library is the media cluster's
--    business; it can set this column later, but only after clearing "image" on
--    the same row, because of the CHECK in step 6.
--
--    onDelete: SetNull, and ON UPDATE CASCADE spelled out because that is what
--    Prisma emits for a relation that names only onDelete -- omitting it shows
--    up as drift in `migrate diff`. Drop-then-add rather than a pg_constraint
--    probe: Postgres has no ADD CONSTRAINT IF NOT EXISTS and the revalidation
--    scan over ten rows is free.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog"
  ADD COLUMN IF NOT EXISTS "coverAssetId" TEXT;

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_coverAssetId_fkey";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_coverAssetId_fkey"
  FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Declared by the new schema as @@index([coverAssetId]). It exists for the
-- SetNull sweep when a media object is deleted, not for a reader.
CREATE INDEX IF NOT EXISTS "Blog_coverAssetId_idx"
  ON "Blog" ("coverAssetId");

-- -----------------------------------------------------------------------------
-- 5. "image" becomes nullable, and '' stops counting as a value.
--
--    The new schema says `image String?`. NULL is the only way to say "this post
--    has no cover" once "coverAssetId" exists beside it, because '' would set
--    off neither the CHECK nor any `IS NULL` guard in the readers while still
--    rendering as a broken <img src="">.
--
--    Zero rows are affected in this database: all ten images are real URLs (P7).
--    The empty strings schema-v2.md warns about live in the seed script, which
--    will insert into this shape next time it runs; the UPDATE is here so the
--    invariant is enforced by the migration rather than trusted.
--    btrim() so a whitespace-only string is treated as empty too.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog"
  ALTER COLUMN "image" DROP NOT NULL;

UPDATE "Blog"
SET "image" = NULL
WHERE "image" IS NOT NULL
  AND btrim("image") = '';

-- -----------------------------------------------------------------------------
-- 6. "Blog_cover_source_check" -- at most one cover source.
--
--    Prisma cannot express a CHECK, so this lives only here and a `db push`
--    will never recreate it. Prefer `migrate deploy`.
--
--    At-most-one, not exactly-one: a post with no cover at all is legitimate
--    ("color", a pair of Tailwind gradient classes, is the fallback). Added
--    VALID immediately rather than NOT VALID + VALIDATE -- the NOT VALID dance
--    in schema-v2.md is for busy tables, and this one has ten rows.
--
--    Note the consequence, which is intended: all ten rows keep a non-NULL
--    "image", so none of them can be given a "coverAssetId" until its "image"
--    is cleared in the same statement.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_cover_source_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_cover_source_check"
  CHECK ("coverAssetId" IS NULL OR "image" IS NULL);

-- -----------------------------------------------------------------------------
-- 7. The two lifecycle CHECKs.
--
--    Straight out of the schema-v2.md inventory ("Blog, Project | status <>
--    'PUBLISHED' OR publishedAt IS NOT NULL; status <> 'SCHEDULED' OR publishAt
--    IS NOT NULL"). They are what makes step 3 safe to ship: once "publishedAt"
--    is nullable, only a constraint keeps a PUBLISHED post from going live with
--    no date, which would make `publishedAt <= now()` in publicContentWhere
--    evaluate to NULL and hide the post with no error anywhere.
--
--    The enum is cast explicitly so the comparison is unambiguous and immutable,
--    which a CHECK requires. Both are vacuously satisfied by ten DRAFT rows
--    (P6), so both are added VALID.
--
--    The identical pair on "Project" belongs to the Project cluster, along with
--    the repair UPDATE that Project needs; if that cluster names them anything
--    other than "Project_publishedAt_required_check" /
--    "Project_publishAt_required_check", the two tables end up inconsistent.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishedAt_required_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_publishedAt_required_check"
  CHECK ("status" <> 'PUBLISHED'::"ContentStatus" OR "publishedAt" IS NOT NULL);

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishAt_required_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_publishAt_required_check"
  CHECK ("status" <> 'SCHEDULED'::"ContentStatus" OR "publishAt" IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 8. The index swap: ("status", "publishedAt") -> ("status", "publishedAt" DESC).
--
--    Same NAME on purpose. Prisma builds a default index name from the table and
--    the field list and ignores the sort modifier, so
--    @@index([status, publishedAt(sort: Desc)]) still expects
--    "Blog_status_publishedAt_idx"; inventing a "_desc_" name is drift.
--
--    DESC because that is the only direction anything sorts this column --
--    newest post first, on the public blog index, the admin list and the
--    sitemap. NULLS FIRST is the Postgres default for DESC and is left alone:
--    after step 3 the ten unpublished drafts sort ahead of everything, and since
--    every reader filters status before it sorts, that costs nothing.
--
--    "Blog_status_publishAt_idx" is NOT touched -- the new schema still declares
--    @@index([status, publishAt]) in the plain ascending form, which is what the
--    publish-due sweep scans forwards.
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS "Blog_status_publishedAt_idx";
CREATE INDEX IF NOT EXISTS "Blog_status_publishedAt_idx"
  ON "Blog" ("status", "publishedAt" DESC);

-- -----------------------------------------------------------------------------
-- 9. Contract: "show" goes.
--
--    Last, so that an abort anywhere above leaves the column in place. Added by
--    20260308175836_add_blog_show_field with DEFAULT true, back-filled false on
--    every existing row, and superseded by "status" in 20260822100100, which
--    derived DRAFT from `show = false` -- so the information in this column has
--    already been migrated once, into "status", and is being dropped the second
--    time rather than the first.
--
--    No per-row value survives the DDL. All ten are false and that is recorded
--    in P3's output and in the read-only JSON dump. See the data-loss note.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog"
  DROP COLUMN IF EXISTS "show";


-- =============================================================================
-- VERIFICATION. Run every one of these before COMMIT. They are all reads.
-- =============================================================================

-- V1. The final shape. This is the query `prisma migrate diff` effectively
--     disagrees with when something is off by a default or a nullability.
--     EXPECTED: exactly 15 rows, and specifically ->
--       color            | text                        | NO  | (null)
--       content          | text                        | NO  | (null)
--       coverAssetId     | text                        | YES | (null)
--       createdAt        | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--       description      | text                        | NO  | (null)
--       id               | text                        | NO  | (null)
--       image            | text                        | YES | (null)
--       imageOrientation | ImageOrientation (USER-DEF) | NO  | 'LANDSCAPE'::"ImageOrientation"
--       publishAt        | timestamp without time zone | YES | (null)
--       publishedAt      | timestamp without time zone | YES | (null)   <- no default
--       slug             | text                        | NO  | (null)
--       sortOrder        | integer                     | NO  | (null)
--       status           | ContentStatus (USER-DEF)    | NO  | 'DRAFT'::"ContentStatus"
--       title            | text                        | NO  | (null)
--       updatedAt        | timestamp without time zone | NO  | (null)
--     No "show" row. "imageOrientation" unchanged, enum and default intact.
SELECT "column_name", "data_type", "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'Blog'
ORDER BY "column_name";

-- V2. "show" is gone and the "ImageOrientation" enum is not.
--     EXPECTED: 1 row -> showColumn=0, orientationColumn=1, orientationLabels=3.
SELECT
  (SELECT count(*) FROM "information_schema"."columns"
   WHERE "table_schema" = current_schema() AND "table_name" = 'Blog'
     AND "column_name" = 'show')                                    AS "showColumn",
  (SELECT count(*) FROM "information_schema"."columns"
   WHERE "table_schema" = current_schema() AND "table_name" = 'Blog'
     AND "column_name" = 'imageOrientation')                        AS "orientationColumn",
  (SELECT count(*) FROM "pg_enum" e JOIN "pg_type" t ON t."oid" = e."enumtypid"
   WHERE t."typname" = 'ImageOrientation')                          AS "orientationLabels";

-- V3. Nothing was lost and nothing was invented.
--     EXPECTED: 1 row -> rows=10, createdAtNull=0, publishedAtNotNull=0,
--               imageNotNull=10, imageEmpty=0, coverSet=0, draft=10,
--               orientationLandscape=5, orientationSquare=3, orientationPortrait=2.
--     The orientation split is the untouched control: 5/3/2 is exactly what
--     /tmp/v2/data-facts.txt lists, so if it moved, something overwrote rows.
SELECT
  count(*)                                                             AS "rows",
  count(*) FILTER (WHERE "createdAt" IS NULL)                          AS "createdAtNull",
  count(*) FILTER (WHERE "publishedAt" IS NOT NULL)                    AS "publishedAtNotNull",
  count(*) FILTER (WHERE "image" IS NOT NULL)                          AS "imageNotNull",
  count(*) FILTER (WHERE "image" IS NOT NULL AND btrim("image") = '')  AS "imageEmpty",
  count(*) FILTER (WHERE "coverAssetId" IS NOT NULL)                   AS "coverSet",
  count(*) FILTER (WHERE "status" = 'DRAFT')                           AS "draft",
  count(*) FILTER (WHERE "imageOrientation" = 'LANDSCAPE')             AS "orientationLandscape",
  count(*) FILTER (WHERE "imageOrientation" = 'SQUARE')                AS "orientationSquare",
  count(*) FILTER (WHERE "imageOrientation" = 'PORTRAIT')              AS "orientationPortrait"
FROM "Blog";

-- V4. The creation stamps carried across intact. These are the exact values P4
--     printed, now living in "createdAt".
--     EXPECTED: exactly 10 rows, "publishedAt" NULL on every one, and ->
--       turborepo-monorepo     | 2026-03-08 07:24:25.397
--       websocket-scaling      | 2026-03-08 07:24:25.462
--       drizzle-vs-prisma      | 2026-03-08 07:24:25.528
--       docker-dev-setup       | 2026-03-08 07:24:25.598
--       nextjs-app-router      | 2026-03-08 07:24:25.662
--       redis-caching-patterns | 2026-03-08 07:24:25.732
--       cicd-github-actions    | 2026-03-08 07:24:25.793
--       typescript-tricks      | 2026-03-08 07:24:25.855
--       jwt-auth-patterns      | 2026-03-08 07:24:25.918
--       postgres-performance   | 2026-03-08 07:24:25.981
SELECT "slug", "createdAt", "publishedAt"
FROM "Blog"
ORDER BY "createdAt";

-- V5. No stamp drifted and none was replaced by the migration clock. Every
--     "createdAt" must still sit inside the original seed window.
--     EXPECTED: 1 row -> inWindow=10, outsideWindow=0,
--               minCreatedAt=2026-03-08 07:24:25.397,
--               maxCreatedAt=2026-03-08 07:24:25.981.
SELECT
  count(*) FILTER (WHERE "createdAt" >= TIMESTAMP '2026-03-08 07:24:25.397'
                     AND "createdAt" <= TIMESTAMP '2026-03-08 07:24:25.981') AS "inWindow",
  count(*) FILTER (WHERE "createdAt" <  TIMESTAMP '2026-03-08 07:24:25.397'
                      OR "createdAt" >  TIMESTAMP '2026-03-08 07:24:25.981') AS "outsideWindow",
  min("createdAt") AS "minCreatedAt",
  max("createdAt") AS "maxCreatedAt"
FROM "Blog";

-- V6. Constraints, by exact name. These are the names a later `migrate diff`
--     and any rollback both depend on.
--     EXPECTED: exactly 5 rows ->
--       Blog_cover_source_check          | c | CHECK ((("coverAssetId" IS NULL) OR ("image" IS NULL)))
--       Blog_publishAt_required_check    | c | CHECK (((status <> 'SCHEDULED'::"ContentStatus") OR ("publishAt" IS NOT NULL)))
--       Blog_publishedAt_required_check  | c | CHECK (((status <> 'PUBLISHED'::"ContentStatus") OR ("publishedAt" IS NOT NULL)))
--       Blog_coverAssetId_fkey           | f | FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"(id) ON UPDATE CASCADE ON DELETE SET NULL
--       Blog_pkey                        | p | PRIMARY KEY (id)
--     pg_get_constraintdef only quotes what needs quoting, so lower-case "status"
--     and "id" come back bare. "Blog_slug_key" is deliberately absent: Prisma
--     builds it as a UNIQUE INDEX, not a UNIQUE CONSTRAINT, so it lives in
--     pg_indexes (V7) and never in pg_constraint. On PG17 NOT NULL is still an
--     attnotnull flag rather than a pg_constraint row, so none show up either.
--     Every CHECK must report convalidated = true; none was added NOT VALID.
SELECT "conname", "contype", "convalidated", pg_get_constraintdef("oid") AS "definition"
FROM "pg_constraint"
WHERE "conrelid" = '"Blog"'::regclass
ORDER BY "contype", "conname";

-- V7. Indexes, by exact name and definition. The DESC is the point.
--     EXPECTED: exactly 5 rows ->
--       Blog_coverAssetId_idx        | CREATE INDEX "Blog_coverAssetId_idx" ON public."Blog" USING btree ("coverAssetId")
--       Blog_pkey                    | CREATE UNIQUE INDEX "Blog_pkey" ON public."Blog" USING btree (id)
--       Blog_slug_key                | CREATE UNIQUE INDEX "Blog_slug_key" ON public."Blog" USING btree (slug)
--       Blog_status_publishAt_idx    | CREATE INDEX "Blog_status_publishAt_idx" ON public."Blog" USING btree (status, "publishAt")
--       Blog_status_publishedAt_idx  | CREATE INDEX "Blog_status_publishedAt_idx" ON public."Blog" USING btree (status, "publishedAt" DESC)
SELECT "indexname", "indexdef"
FROM "pg_indexes"
WHERE "schemaname" = current_schema()
  AND "tablename" = 'Blog'
ORDER BY "indexname";

-- V8. The DESC index is the one a newest-first scan actually gets, and it can be
--     read backwards for the ascending case too.
--     EXPECTED: 1 row -> descIndexes=1, plainPublishedAtIndexes=0.
SELECT
  count(*) FILTER (WHERE "indexdef" LIKE '%"publishedAt" DESC%')                          AS "descIndexes",
  count(*) FILTER (WHERE "indexname" = 'Blog_status_publishedAt_idx'
                     AND "indexdef" NOT LIKE '%DESC%')                                    AS "plainPublishedAtIndexes"
FROM "pg_indexes"
WHERE "schemaname" = current_schema() AND "tablename" = 'Blog';

-- V9. The FK points where it should and behaves as SetNull. Read from the
--     catalogue rather than tested destructively: confdeltype 'n' = SET NULL,
--     confupdtype 'c' = CASCADE.
--     EXPECTED: 1 row -> Blog_coverAssetId_fkey | MediaAsset | n | c
SELECT c."conname",
       c."confrelid"::regclass AS "references",
       c."confdeltype",
       c."confupdtype"
FROM "pg_constraint" c
WHERE c."conrelid" = '"Blog"'::regclass
  AND c."contype" = 'f';

-- V10. Negative probes. NOT part of the migration -- each one is expected to
--      FAIL, so run them by hand in a throwaway savepoint AFTER commit, and roll
--      the savepoint back. They are written down because a CHECK that silently
--      does nothing looks identical to one that works.
--
--      SAVEPOINT p;
--        UPDATE "Blog" SET "status" = 'PUBLISHED' WHERE "publishedAt" IS NULL;
--          -- expect: violates "Blog_publishedAt_required_check"
--      ROLLBACK TO SAVEPOINT p;
--        UPDATE "Blog" SET "status" = 'SCHEDULED' WHERE "publishAt" IS NULL;
--          -- expect: violates "Blog_publishAt_required_check"
--      ROLLBACK TO SAVEPOINT p;
--        UPDATE "Blog" SET "coverAssetId" = (SELECT "id" FROM "MediaAsset" LIMIT 1);
--          -- expect: violates "Blog_cover_source_check" (every row still has an "image")
--      ROLLBACK TO SAVEPOINT p;
--        UPDATE "Blog" SET "coverAssetId" = 'no-such-media-asset-id';
--          -- expect: violates "Blog_coverAssetId_fkey"
--      ROLLBACK TO SAVEPOINT p;
--        UPDATE "Blog" SET "createdAt" = NULL;
--          -- expect: null value in column "createdAt" violates not-null constraint
--      ROLLBACK TO SAVEPOINT p;
--        INSERT INTO "Blog" ("id","slug","title","description","content","color","sortOrder","updatedAt")
--        VALUES ('probe','probe','t','d','c','from-x to-y',99,CURRENT_TIMESTAMP);
--          -- expect: SUCCEEDS, with "createdAt" defaulted to now(), "publishedAt"
--          --         NULL, "image" NULL and "status" DRAFT. This is the row shape
--          --         the new schema promises, and the one the old NOT NULL
--          --         "image" plus NOT NULL "publishedAt" made impossible.
--      ROLLBACK TO SAVEPOINT p;
--      RELEASE SAVEPOINT p;
