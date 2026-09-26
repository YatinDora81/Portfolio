-- =============================================================================
-- PRODUCTION CUTOVER -- cluster: blogs -- STAGE 2 of 2: CONTRACT
--
-- RUN THIS ONLY AFTER the v2 code is deployed AND you have confirmed it serving:
--   * https://www.yatindora.in/          200, homepage renders (blogs section is
--                                        absent today because nothing is PUBLISHED)
--   * https://www.yatindora.in/sitemap.xml   200
--   * the admin /blogs, /dashboard, /site-config, /terminal, /media all 200
--   * the admin /blogs list prints "no date yet" for the ten drafts -- that string
--     (apps/docs/app/(dashboard)/blogs/page.tsx:199 in the working tree) is v2's
--     null branch and is proof the deployed bundle is the v2 one
--
-- ONE-WAY DOOR. The moment `DROP COLUMN "show"` commits, Vercel's instant
-- rollback to the v1 deployment stops being an option: v1 reads "show" in five
-- places (dashboard/page.tsx:37, site-config/page.tsx:18, terminal/page.tsx:45,
-- lib/stale.ts:34-35, and the bare findMany at blogs/page.tsx:40 whose generated
-- SELECT enumerates it) and all five become 42703 / Prisma P2022. If you are not
-- yet willing to give up the rollback, run everything in this file EXCEPT the
-- last statement; the "show" drop can wait days and costs nothing but drift.
--
-- Postgres 17 on Neon, database owner, no superuser. One transaction, ten rows.
-- Admin-only blast radius. No public page reads any of the columns touched here.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';


-- -----------------------------------------------------------------------------
-- PREFLIGHT
-- -----------------------------------------------------------------------------

-- C0. EXPAND must already have run. Otherwise the null-out below hits a NOT NULL
--     column and there is no "createdAt" to preserve the instant in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Blog'
      AND column_name = 'createdAt' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'C0: "createdAt" is missing or nullable -- run blogs-expand.sql first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Blog'
      AND column_name = 'publishedAt' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'C0: "publishedAt" is still NOT NULL -- run blogs-expand.sql first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Blog"'::regclass AND conname = 'Blog_publishedAt_required_check'
  ) THEN
    RAISE EXCEPTION 'C0: Blog_publishedAt_required_check is missing -- run blogs-expand.sql first';
  END IF;
END $$;

-- C1. Print every stamp about to be discarded, and the status census, so the run
--     log holds them. Rows created during the window appear here too.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "slug", "status", "publishedAt", "createdAt" FROM "Blog"
           WHERE "status" IN ('DRAFT','SCHEDULED') AND "publishedAt" IS NOT NULL
           ORDER BY "createdAt" LOOP
    RAISE NOTICE 'C1: % (%) discarding publishedAt=% keeping createdAt=%',
      r.slug, r.status, r."publishedAt", r."createdAt";
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 1. Preserve the earlier of the two instants as the creation stamp.
--
--    For the ten seed rows this is a no-op: EXPAND copied publishedAt into
--    createdAt byte for byte, so they are equal.
--
--    It exists for a row CREATED BY v1 DURING THE EXPAND->DEPLOY WINDOW. That
--    row's "publishedAt" came from Prisma's engine clock (v1 createBlog,
--    apps/docs/app/lib/actions/blogs.ts:19-42, never names the column) and its
--    "createdAt" came from the database DEFAULT CURRENT_TIMESTAMP added in
--    EXPAND. The two are milliseconds apart, not equal. LEAST keeps the earlier
--    one, so nothing is lost by step 2.
-- -----------------------------------------------------------------------------

UPDATE "Blog"
   SET "createdAt" = LEAST("createdAt", COALESCE("publishedAt", "createdAt"))
 WHERE "publishedAt" IS NOT NULL
   AND "publishedAt" < "createdAt";


-- -----------------------------------------------------------------------------
-- 2. *** THE ONE INFORMATION-LOSING STATEMENT IN THIS CLUSTER ***
--
--    Unpublished posts stop claiming a publish date they never had.
--
--    THE PREDICATE IS STATUS-BASED, NOT `"publishedAt" = "createdAt"` as the
--    draft (v2-migration-draft/55-blogs.sql step 3) had it. The draft's
--    predicate is correct for a throwaway branch where nothing writes between
--    the two steps, and WRONG here: it would silently skip every post created by
--    v1 during the EXPAND->DEPLOY window, because those two stamps come from two
--    different clocks (step 1 above) and are never equal. Such a post would keep
--    a spurious "published" date forever.
--
--    A status-based predicate is safe because under v1 a DRAFT or SCHEDULED row
--    CANNOT hold an editorial publishedAt. Proof, from the deployed code:
--      * createBlog / updateBlog never name the column
--        (apps/docs/app/lib/actions/blogs.ts:19-42 and :45-68; the comment at
--        :63 says so out loud)
--      * publishBlogNow and setBlogStatus only write it while setting
--        status = PUBLISHED (publishing.ts:193, :272)
--      * publishDueContent only writes it while setting status = PUBLISHED
--        (packages/db/src/publish-due.ts:36-43)
--      * there is no other writer, and schema-v2.md records that the "editorial
--        date" the admin advertises has no UI at all
--    So every publishedAt on a DRAFT/SCHEDULED row is a creation stamp, and the
--    instant itself survives in "createdAt".
--
--    PUBLISHED and ARCHIVED rows MUST keep their stamp, which is why the filter
--    is not a blanket `IS NOT NULL`: Blog_publishedAt_required_check rejects a
--    PUBLISHED row without one, and publicContentWhere
--    (packages/db/src/visibility.ts:5-10) needs it to decide visibility. A post
--    the operator published during the window is therefore left exactly as it is.
--
--    Expect 10 rows today, plus one per post created during the window.
-- -----------------------------------------------------------------------------

UPDATE "Blog"
   SET "publishedAt" = NULL
 WHERE "status" IN ('DRAFT','SCHEDULED')
   AND "publishedAt" IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. "publishedAt" loses DEFAULT CURRENT_TIMESTAMP.
--
--    EXPAND kept it so that a v1 createBlog, which never names the column, could
--    not possibly insert a NULL and walk into blogPublishStamp's unguarded
--    `current.getTime()` (publishing.ts:157-159). v2 names the column on every
--    create -- `publishedAt: lifecycle.status === "PUBLISHED" ? new Date() : null`
--    -- and an explicit NULL overrides a column DEFAULT, so v2 has never used it.
--
--    It goes now because the new schema declares `publishedAt DateTime?` with no
--    default, and a leftover default is exactly the drift
--    `prisma migrate diff` reports. It is also the last thing that could quietly
--    re-create the bug this column change exists to remove: any future INSERT
--    that omits the column would otherwise back-date a draft to "now".
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" ALTER COLUMN "publishedAt" DROP DEFAULT;


-- -----------------------------------------------------------------------------
-- 4. '' stops counting as a cover.
--
--    ZERO ROWS in production: all ten images are absolute
--    https://images.unsplash.com URLs. The empty strings schema-v2.md warns
--    about live in packages/db/seed.ts, which will insert into this shape the
--    next time it runs. The statement is here so the invariant is enforced by
--    the migration rather than trusted, and it is HERE rather than in EXPAND
--    because v1's generated client types Blog.image as a non-nullable `string`
--    and a NULL would have reached, among others,
--    apps/docs/app/lib/media-references.ts:33, which interpolates it into a
--    template literal and would scan the seven-character text "null".
--
--    btrim so a whitespace-only string counts as empty too.
-- -----------------------------------------------------------------------------

UPDATE "Blog"
   SET "image" = NULL
 WHERE "image" IS NOT NULL
   AND btrim("image") = '';


-- -----------------------------------------------------------------------------
-- 5. "show" goes. LAST, so an abort anywhere above leaves the rollback door open.
--
--    Added by 20260308175836_add_blog_show_field with DEFAULT true, back-filled
--    false on every existing row, then superseded by "status" in
--    20260822100100_backfill_content_status, which derived DRAFT from
--    `show = false`. The information in this column was migrated once already,
--    into "status"; this is the second drop, not the first.
--
--    Production holds false on all ten rows -- not the schema default of true --
--    which is why the admin's "live posts" tile reads 0 while ten posts exist.
--    The v2 code repoints all four counters at the shared visibility predicate
--    (dashboard/page.tsx:38, site-config/page.tsx:21, terminal/page.tsx:46 and stale.ts:33-37 now
--    pass `publicContentWhere()`), which is what makes the drop safe AND fixes
--    the count. Without the deploy having landed first, this statement takes down
--    five admin screens.
--
--    No per-row value survives the DDL. All ten were false; that is in the
--    read-only JSON dump and in this file.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" DROP COLUMN IF EXISTS "show";


-- -----------------------------------------------------------------------------
-- VERIFICATION, before COMMIT.
-- -----------------------------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  SELECT count(*)                                                              AS n,
         count(*) FILTER (WHERE "status" IN ('DRAFT','SCHEDULED')
                            AND "publishedAt" IS NOT NULL)                     AS leftover,
         count(*) FILTER (WHERE "status" = 'PUBLISHED'
                            AND "publishedAt" IS NULL)                         AS unstamped,
         count(*) FILTER (WHERE "createdAt" IS NULL)                           AS cnull,
         count(*) FILTER (WHERE "image" IS NOT NULL AND btrim("image") = '')    AS empties,
         count(*) FILTER (WHERE "coverAssetId" IS NOT NULL AND "image" IS NOT NULL) AS both,
         count(*) FILTER (WHERE "imageOrientation" = 'LANDSCAPE')              AS land,
         count(*) FILTER (WHERE "imageOrientation" = 'SQUARE')                 AS sq,
         count(*) FILTER (WHERE "imageOrientation" = 'PORTRAIT')               AS por,
         min("createdAt") AS lo, max("createdAt") AS hi
    INTO r FROM "Blog";

  RAISE NOTICE 'V: rows=% leftoverStamps=% unstampedPublished=% createdAtNull=% emptyImages=% bothCovers=% orientation=%L/%S/%P createdAt=%..%',
    r.n, r.leftover, r.unstamped, r.cnull, r.empties, r.both, r.land, r.sq, r.por, r.lo, r.hi;

  IF r.leftover <> 0 THEN
    RAISE EXCEPTION 'V: % DRAFT/SCHEDULED rows still carry a publishedAt', r.leftover;
  END IF;
  IF r.unstamped <> 0 THEN
    RAISE EXCEPTION 'V: % PUBLISHED rows lost their stamp -- step 2 over-reached', r.unstamped;
  END IF;
  IF r.cnull <> 0 OR r.empties <> 0 OR r.both <> 0 THEN
    RAISE EXCEPTION 'V: invariant broken (createdAtNull=%, emptyImages=%, bothCovers=%)', r.cnull, r.empties, r.both;
  END IF;
  -- The untouched control. 5 LANDSCAPE / 3 SQUARE / 2 PORTRAIT is what the dump
  -- records; if it moved, something overwrote rows.
  IF r.n = 10 AND (r.land <> 5 OR r.sq <> 3 OR r.por <> 2) THEN
    RAISE EXCEPTION 'V: the orientation split moved (%L/%S/%P, expected 5/3/2)', r.land, r.sq, r.por;
  END IF;
END $$;

-- The ten seed creation stamps survived both stages, to the millisecond.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM "Blog"
  WHERE "createdAt" BETWEEN TIMESTAMP '2026-03-08 07:24:25.397'
                        AND TIMESTAMP '2026-03-08 07:24:25.981';
  IF n <> 10 THEN
    RAISE EXCEPTION 'V: expected the 10 seed rows inside the 2026-03-08 07:24:25.397..981 window, found %', n;
  END IF;
END $$;

-- "show" gone, "imageOrientation" and its enum intact.
DO $$
DECLARE shown INT; orient INT; labels INT;
BEGIN
  SELECT count(*) FILTER (WHERE column_name = 'show'),
         count(*) FILTER (WHERE column_name = 'imageOrientation')
    INTO shown, orient FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'Blog';
  SELECT count(*) INTO labels FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'ImageOrientation';
  IF shown <> 0 THEN RAISE EXCEPTION 'V: "show" is still present'; END IF;
  IF orient <> 1 OR labels <> 3 THEN
    RAISE EXCEPTION 'V: imageOrientation/enum damaged (col=%, labels=%)', orient, labels;
  END IF;
END $$;

-- Final shape matches target-ddl.sql lines 280-298: 15 columns, publishedAt
-- nullable WITH NO DEFAULT, createdAt NOT NULL DEFAULT CURRENT_TIMESTAMP.
DO $$
DECLARE n INT; dflt TEXT;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'Blog';
  IF n <> 15 THEN RAISE EXCEPTION 'V: expected 15 columns on "Blog", found %', n; END IF;

  SELECT column_default INTO dflt FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'Blog'
     AND column_name = 'publishedAt';
  IF dflt IS NOT NULL THEN
    RAISE EXCEPTION 'V: publishedAt still defaults to % -- drift against the v2 schema', dflt;
  END IF;
END $$;

COMMIT;


-- =============================================================================
-- AFTER COMMIT
--
-- No cache flush is needed for this cluster. All ten posts are DRAFT, so none of
-- them is in any public ISR entry or Next data-cache payload: getBlogs caches
-- `readBlogs(false)` under the tag blog:index and readBlogs filters on
-- publicContentWhere, which requires status = PUBLISHED AND publishedAt <= now.
-- Nothing this file changed is reachable from a cached public page. If you DID
-- publish a post during the window, flush it: the admin's Revalidation screen, or
-- revalidateTag('blog:index') and revalidateTag('blog:<slug>').
--
-- NEGATIVE PROBES. Not part of the migration -- each of these is expected to
-- FAIL, and they are written down because a CHECK that silently does nothing
-- looks identical to one that works. Run them by hand, then roll back.
--
--   BEGIN;
--     UPDATE "Blog" SET "status" = 'PUBLISHED' WHERE "publishedAt" IS NULL;
--       -- expect: violates "Blog_publishedAt_required_check"
--   ROLLBACK;
--   BEGIN;
--     UPDATE "Blog" SET "status" = 'SCHEDULED' WHERE "publishAt" IS NULL;
--       -- expect: violates "Blog_publishAt_required_check"
--   ROLLBACK;
--   BEGIN;
--     UPDATE "Blog" SET "coverAssetId" = (SELECT "id" FROM "MediaAsset" LIMIT 1);
--       -- expect: violates "Blog_cover_source_check" (every row still has an image)
--   ROLLBACK;
--   BEGIN;
--     UPDATE "Blog" SET "coverAssetId" = 'no-such-id';
--       -- expect: violates "Blog_coverAssetId_fkey"
--   ROLLBACK;
--   BEGIN;
--     INSERT INTO "Blog" ("id","slug","title","description","content","color","sortOrder","updatedAt")
--     VALUES ('probe','probe','t','d','c','from-x to-y',99,CURRENT_TIMESTAMP);
--       -- expect: SUCCEEDS, createdAt defaulted to now, publishedAt NULL, image
--       --         NULL, status DRAFT. That row shape is what the new schema
--       --         promises and what the old NOT NULL image + NOT NULL publishedAt
--       --         made impossible.
--   ROLLBACK;
--
-- ROLLBACK OF THIS STAGE. Roll the CODE back first, then this. It is faithful for
-- today's data and only for today's data.
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "show" BOOLEAN NOT NULL DEFAULT true;
--   UPDATE "Blog" SET "show" = false;                -- what production actually held
--   UPDATE "Blog" SET "image" = '' WHERE "image" IS NULL;
--   ALTER TABLE "Blog" ALTER COLUMN "publishedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   UPDATE "Blog" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;
--   COMMIT;
--   -- and then blogs-expand.sql's own rollback block if you are going all the way
--   -- back to v1.
-- Caveats, stated because they are the parts DDL cannot undo:
--   * "show" cannot be restored per row. All ten were false, so the blanket
--     UPDATE is exact today; per-row values also live in the read-only JSON dump.
--   * "publishedAt" comes back from "createdAt", which is where EXPAND put it, so
--     the ten seed stamps return identical. A post PUBLISHED after CONTRACT is not
--     touched by the null-out and so is not touched by this restore either.
--   * image '' vs NULL: no empty strings exist today, so the reverse UPDATE is a
--     no-op. Once a NULL exists, rollback cannot tell "was empty" from "was never
--     set" and turns both into ''.
-- =============================================================================
