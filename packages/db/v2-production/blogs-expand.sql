-- =============================================================================
-- PRODUCTION CUTOVER -- cluster: blogs -- STAGE 1 of 2: EXPAND
--
-- Run this while the LIVE v1 code is still deployed and serving traffic.
-- Postgres 17 on Neon. Role is the database owner, NOT superuser. Nothing here
-- needs superuser: every statement touches "Blog" (owned) and adds one FK that
-- REFERENCES "MediaAsset" (also owned).
--
-- AFTER THIS FILE COMMITS, EVERY v1 CODE PATH STILL WORKS UNCHANGED.
-- That is the whole design constraint, and it is why three statements from
-- packages/db/v2-migration-draft/55-blogs.sql are NOT in this file:
--
--     * UPDATE "Blog" SET "publishedAt" = NULL ...   -> blogs-contract.sql
--     * ALTER COLUMN "publishedAt" DROP DEFAULT      -> blogs-contract.sql
--     * ALTER TABLE "Blog" DROP COLUMN "show"        -> blogs-contract.sql
--     * UPDATE "Blog" SET "image" = NULL WHERE ''    -> blogs-contract.sql
--
-- Why, in one line each (git HEAD = 0050cc9 = what is deployed):
--
--   publishedAt := NULL
--     apps/docs/app/lib/actions/publishing.ts:157-159 is
--         function blogPublishStamp(current: Date, now: Date) {
--           return current.getTime() > now.getTime() ? { publishedAt: now } : {};
--         }
--     `current: Date`, not `Date | null`, and it is dereferenced unconditionally.
--     Called at publishing.ts:193 (publishBlogNow) and :272 (setBlogStatus).
--     With publishedAt NULL those two server actions throw
--     `TypeError: Cannot read properties of null (reading 'getTime')` BEFORE the
--     updateMany, so the admin's only two paths to publish a post are dead for
--     the whole EXPAND->DEPLOY window. Same dereference at
--     packages/db/src/publish-due.ts:35 (`blog.publishedAt.getTime()`), which
--     runs inside after() on the PUBLIC beacon
--     (apps/web/app/api/collect/route.ts:81) -- the throw is caught at :100, but
--     it happens before catchUpRollups() and runPeriodicMaintenance() in the same
--     try block, so one SCHEDULED row with a NULL stamp silently stalls the
--     analytics rollup and retention on every single beacon.
--
--   publishedAt DROP DEFAULT
--     v1 createBlog (apps/docs/app/lib/actions/blogs.ts:19-42) never names
--     publishedAt. Prisma 7 does pass @default(now()) as a bind parameter, so in
--     principle the column default is dead weight -- but that cannot be proved
--     here without connecting to a database, and if the assumption is wrong a
--     v1-created post lands with publishedAt NULL and walks straight into the
--     TypeError above. The default costs nothing to keep for one deploy.
--     v2 is unaffected either way: v2 createBlog names the column explicitly
--     (`publishedAt: lifecycle.status === "PUBLISHED" ? new Date() : null`), and
--     an explicit NULL overrides a column DEFAULT.
--
--   DROP COLUMN "show"
--     Five v1 reads. Four send `WHERE "show" = true`:
--       apps/docs/app/(dashboard)/dashboard/page.tsx:37
--       apps/docs/app/(dashboard)/site-config/page.tsx:18
--       apps/docs/app/(dashboard)/terminal/page.tsx:45
--       apps/docs/app/lib/stale.ts:34-35
--     and the fifth, apps/docs/app/(dashboard)/blogs/page.tsx:40, is a bare
--     `prisma.blog.findMany({ orderBy })` whose generated SELECT enumerates
--     "show" like every other v1 scalar. All five become 42703
--     (Prisma P2022) the instant the column goes: the admin home, the site-config
--     screen, the terminal screen, stale detection and the blogs list itself.
--     Zero public readers -- apps/web/app/lib/data.ts:274-292 and :315-335 use
--     explicit selects that never mention it -- so this is admin-only, but there
--     is no reason to eat it early.
--
--   image '' -> NULL
--     Zero rows in production (all ten images are absolute
--     https://images.unsplash.com URLs), so it is a no-op wherever it runs. Kept
--     in CONTRACT because v1 types Blog.image as non-nullable `string`, and the
--     one thing that must never happen in the window is a NULL arriving in a
--     column v1's generated client promises is a string.
--
-- WHAT *IS* IN HERE, AND WHY EACH ONE IS v1-SAFE
--
--   1. createdAt: new column, nullable -> backfilled -> NOT NULL *with* a DEFAULT.
--      v1's Prisma client does not know the column exists, so it never appears in
--      a v1 SELECT (Prisma always enumerates columns; it never emits SELECT *)
--      and never appears in a v1 INSERT column list, which is exactly why the
--      DEFAULT is load-bearing rather than cosmetic: SET NOT NULL without
--      SET DEFAULT makes the next v1 createBlog fail with 23502.
--      The two are issued in ONE ALTER TABLE, so no v1 INSERT can land between
--      them.
--   2. coverAssetId + FK + index: new nullable column. v1 never writes it, so it
--      is NULL on every row and the FK is never checked on a v1 INSERT (NULL
--      always satisfies a FK). Required BEFORE the deploy because v2
--      apps/docs/app/lib/media-references.ts:31 selects
--      `cover: { select: { key: true } }`, a relation traversal that compiles to
--      a read of "Blog"."coverAssetId" -- without the column the v2 media library
--      500s on 42703.
--   3. image DROP NOT NULL: a relaxation. No v1 writer can produce NULL (v1's
--      generated client types image as non-nullable String and rejects null
--      client-side before any SQL is sent), so v1 readers keep receiving the
--      strings they receive today. Required BEFORE the deploy because v2
--      createBlog/updateBlog write `image: (formData.get("image") as string) || null`.
--   4. publishedAt DROP NOT NULL: a relaxation, and after it no v1 path can
--      actually produce a NULL -- createBlog omits the column (default/engine
--      supplies now()), updateBlog never names it, publishBlogNow and
--      setBlogStatus only ever set it to `now`, publishDueContent only ever sets
--      it to `now`. Required BEFORE the deploy because v2 createBlog writes an
--      explicit NULL for any non-PUBLISHED post.
--   5. Blog_cover_source_check: v1 always writes a non-empty image and never
--      writes coverAssetId, so the constraint cannot fire on a v1 write.
--   6. Blog_publishedAt_required_check: cannot fire while publishedAt is non-null
--      on every row, which stays true for the whole window (see 4). It is worth
--      adding NOW rather than later because it is the thing that turns the one
--      dangerous v1 path into a loud failure instead of a silent one: v1
--      updateBlog (blogs.ts:45-68) deliberately does NOT stamp publishedAt when
--      the status becomes PUBLISHED, so on a row with no stamp it would create a
--      PUBLISHED post that `publicContentWhere` (packages/db/src/visibility.ts:5-10)
--      filters out on `publishedAt <= now` -> invisible post, no error anywhere.
--      With the CHECK the save fails and says so.
--   7. Blog_publishAt_required_check: v1 validates SCHEDULED => publishAt on the
--      server in both writers -- apps/docs/app/lib/lifecycle.ts:104-112
--      (resolveLifecycle, used by createBlog/updateBlog) and
--      apps/docs/app/lib/actions/publishing.ts:57-67 (StatusInput.superRefine,
--      used by setBlogStatus). Not client-only. So v1 cannot violate it.
--   8. Index ("status","publishedAt") -> ("status","publishedAt" DESC), same
--      name. No application code reads an index. Neutral for v1 and v2.
--
-- NOT TOUCHED ANYWHERE IN THIS CUTOVER: "imageOrientation" and the
-- "ImageOrientation" enum (apps/web/app/lib/data.ts:283 and :324 select it, so a
-- drop is a 42703 on the public homepage, every /blog/<slug>, the sitemap, the OG
-- route and the public JSON endpoint), "Blog_slug_key", "Blog_pkey",
-- "Blog_status_publishAt_idx", "updatedAt", "ContentStatus".
--
-- @updatedAt IS CLIENT-SIDE. Prisma implements it in the query engine, not as a
-- database trigger (preflight P6 below asserts there is no trigger on the
-- table). So the raw UPDATE in step 1 does NOT bump "updatedAt", which matters:
-- apps/docs/app/lib/stale.ts compares updatedAt against the last successful tag
-- flush, and a migration that bumped it would report all ten posts stale.
--
-- TRANSACTIONALITY AND LOCKS
--   Run the whole file as ONE transaction. Nothing here needs CONCURRENTLY, none
--   of it is superuser, and an abort therefore leaves production exactly as it
--   was. Ten rows, so every scan is microseconds -- but SET NOT NULL, ADD
--   CONSTRAINT and DROP INDEX all take ACCESS EXCLUSIVE, and a *queued*
--   ACCESS EXCLUSIVE request blocks every SELECT behind it. That, not the scan,
--   is the only way this file can cause public downtime. The lock_timeout below
--   makes a blocked ALTER fail in 3s instead of stalling the site; if it fires,
--   find the long-running query and re-run.
--
-- IDEMPOTENT. Safe to re-run: ADD COLUMN IF NOT EXISTS, the backfill is guarded
-- on IS NULL, every constraint is DROP IF EXISTS then ADD, the index is DROP IF
-- EXISTS then CREATE IF NOT EXISTS, SET NOT NULL / DROP NOT NULL / SET DEFAULT
-- are naturally idempotent.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';


-- -----------------------------------------------------------------------------
-- PREFLIGHT. Written as assertions, not as SELECTs to eyeball: any one of them
-- failing aborts the transaction and leaves production untouched.
-- -----------------------------------------------------------------------------

-- P1. The old schema is still the old schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Blog'
      AND column_name = 'show'
  ) THEN
    RAISE EXCEPTION 'P1: "Blog"."show" is already gone -- this database is not v1';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Blog'
      AND column_name IN ('createdAt', 'coverAssetId')
  ) THEN
    RAISE EXCEPTION 'P1: "createdAt" or "coverAssetId" already exists -- a sibling cluster or a stray db push has been here, and ADD COLUMN IF NOT EXISTS would skip the backfill that belongs with it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Blog'
      AND column_name = 'publishedAt' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'P1: "publishedAt" is already nullable -- EXPAND has already run';
  END IF;
END $$;

-- P2. Lifecycle census. Expect 10 rows, all DRAFT, publishedAt non-null on all
--     ten, publishAt null on all ten, show=false on all ten.
DO $$
DECLARE r RECORD;
BEGIN
  SELECT count(*) AS n,
         count(*) FILTER (WHERE "status" <> 'DRAFT')        AS notdraft,
         count(*) FILTER (WHERE "publishedAt" IS NULL)      AS pubnull,
         count(*) FILTER (WHERE "publishAt" IS NOT NULL)    AS atset,
         count(*) FILTER (WHERE "show")                     AS shown
    INTO r FROM "Blog";

  RAISE NOTICE 'P2: rows=% notDraft=% publishedAtNull=% publishAtSet=% showTrue=%',
    r.n, r.notdraft, r.pubnull, r.atset, r.shown;

  IF r.pubnull <> 0 THEN
    RAISE EXCEPTION 'P2: % rows already have a NULL publishedAt -- v1 cannot produce that, so something else has written here', r.pubnull;
  END IF;
  IF r.n <> 10 OR r.notdraft <> 0 OR r.atset <> 0 OR r.shown <> 0 THEN
    RAISE WARNING 'P2: the table has moved since the dump (expected 10/0/0/0). Read the notice above and decide before continuing -- nothing below depends on the counts, only on publishedAtNull=0.';
  END IF;
END $$;

-- P3. The two lifecycle CHECKs are added VALID, so they re-scan. Assert they
--     cannot fail. (Both are vacuous on ten DRAFT rows.)
DO $$
DECLARE bad_pub INT; bad_at INT;
BEGIN
  SELECT count(*) FILTER (WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL),
         count(*) FILTER (WHERE "status" = 'SCHEDULED' AND "publishAt"  IS NULL)
    INTO bad_pub, bad_at FROM "Blog";
  IF bad_pub <> 0 THEN
    RAISE EXCEPTION 'P3: % PUBLISHED rows have no publishedAt -- repair them before adding Blog_publishedAt_required_check', bad_pub;
  END IF;
  IF bad_at <> 0 THEN
    RAISE EXCEPTION 'P3: % SCHEDULED rows have no publishAt -- repair them before adding Blog_publishAt_required_check', bad_at;
  END IF;
END $$;

-- P4. No row can be given a coverAssetId in this cluster, and none is invented.
--     Every image is an absolute https URL; "MediaAsset" holds two bucket keys,
--     neither of them one of these. Matched three ways so a near-miss is visible.
DO $$
DECLARE hits INT;
BEGIN
  SELECT count(*) INTO hits
  FROM "Blog" b JOIN "MediaAsset" m
    ON m."key" = b."image"
    OR m."url" = b."image"
    OR regexp_replace(m."key", '^.*/', '')
       = regexp_replace(split_part(b."image", '?', 1), '^.*/', '');
  IF hits <> 0 THEN
    RAISE WARNING 'P4: % Blog.image values look like MediaAsset rows. This file still leaves coverAssetId NULL; adopting them is the media cluster''s job, and Blog_cover_source_check will require clearing "image" in the same statement.', hits;
  END IF;
END $$;

-- P5. The FK target exists and is the primary key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"MediaAsset"'::regclass AND contype = 'p'
  ) THEN
    RAISE EXCEPTION 'P5: "MediaAsset" has no primary key -- Blog_coverAssetId_fkey cannot be added';
  END IF;
END $$;

-- P6. No trigger on "Blog". If one existed, the raw UPDATE in step 1 could bump
--     "updatedAt" and make apps/docs/app/lib/stale.ts report all ten posts as
--     stale content that never got flushed.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger
  WHERE tgrelid = '"Blog"'::regclass AND NOT tgisinternal;
  IF n <> 0 THEN
    RAISE EXCEPTION 'P6: % user trigger(s) on "Blog" -- inspect before running any UPDATE here', n;
  END IF;
END $$;

-- P7. Nothing Postgres knows about depends on "show" (index, view, generated
--     column, constraint). Asserted here, not in CONTRACT, so the operator finds
--     out before the deploy rather than after it.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
  FROM pg_depend d
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  WHERE d.refobjid = '"Blog"'::regclass AND a.attname = 'show' AND d.deptype <> 'a';
  IF n <> 0 THEN
    RAISE EXCEPTION 'P7: % dependency/ies on "Blog"."show" -- the CONTRACT DROP COLUMN would cascade into them', n;
  END IF;
END $$;

-- P8. Record, in the migration log, the exact values CONTRACT will later
--     discard, so they exist somewhere other than the JSON dump.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "slug", "status", "publishedAt" FROM "Blog"
           WHERE "status" IN ('DRAFT','SCHEDULED') ORDER BY "publishedAt" LOOP
    RAISE NOTICE 'P8: % (%) publishedAt=% -> will become NULL in CONTRACT, instant preserved in createdAt', r.slug, r.status, r."publishedAt";
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 1. "createdAt". The old "publishedAt" has carried DEFAULT CURRENT_TIMESTAMP
--    since 20260307195336_init and nothing in the admin has ever written it
--    except the publish stamp, so today it IS the creation stamp. Copying it
--    across preserves the instant to the millisecond and is what makes nulling
--    the old column safe later.
--
--    Nullable -> backfill -> NOT NULL + DEFAULT, the house three-step from
--    20260822100000/100100/100200. Adding it NOT NULL DEFAULT CURRENT_TIMESTAMP
--    in one shot would stamp all ten rows with the migration clock and destroy
--    the March 8 creation times.
--
--    v1 safety: invisible to every v1 SELECT (Prisma enumerates columns) and
--    filled by the DEFAULT on every v1 INSERT.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);

UPDATE "Blog"
   SET "createdAt" = "publishedAt"
 WHERE "createdAt" IS NULL
   AND "publishedAt" IS NOT NULL;

-- Guard, not a coercion: zero rows today (P2 asserts publishedAtNull = 0).
-- Without it SET NOT NULL would abort the whole transaction.
UPDATE "Blog"
   SET "createdAt" = CURRENT_TIMESTAMP
 WHERE "createdAt" IS NULL;

-- ONE statement: the DEFAULT must be in place before NOT NULL is enforced, or a
-- v1 createBlog landing in between fails with 23502.
ALTER TABLE "Blog"
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "createdAt" SET NOT NULL;


-- -----------------------------------------------------------------------------
-- 2. "publishedAt" becomes optional. DROP NOT NULL only -- the DEFAULT stays
--    until CONTRACT (see the header). This is a relaxation: no v1 writer can
--    produce a NULL, so every v1 reader keeps seeing the non-null Date its
--    generated types promise.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" ALTER COLUMN "publishedAt" DROP NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. "coverAssetId", BESIDE "image" and not instead of it. Left NULL on all ten
--    rows: every image is an absolute https://images.unsplash.com URL and
--    "MediaAsset" holds two bucket keys, neither of them one of those (P4).
--    There is no honest id to put here, so none is invented.
--
--    ON UPDATE CASCADE is spelled out because that is what Prisma emits for a
--    relation that names only onDelete; omitting it shows up as drift in
--    `prisma migrate diff`.
--
--    Added VALID rather than NOT VALID + VALIDATE: the revalidation scan is ten
--    all-NULL rows.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" ADD COLUMN IF NOT EXISTS "coverAssetId" TEXT;

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_coverAssetId_fkey";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_coverAssetId_fkey"
  FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- @@index([coverAssetId]). Exists for the SetNull sweep when a media object is
-- deleted, not for a reader. Without it, every v1 media delete in the window
-- would seq-scan "Blog" -- ten rows, so this is correctness-of-shape, not speed.
CREATE INDEX IF NOT EXISTS "Blog_coverAssetId_idx" ON "Blog" ("coverAssetId");


-- -----------------------------------------------------------------------------
-- 4. "image" becomes nullable. Required before the deploy: v2 createBlog and
--    updateBlog both write `image: (formData.get("image") as string) || null`,
--    so the first v2 save with an empty image field would hit 23502 against a
--    NOT NULL column and surface as "The post was not saved."
--
--    The '' -> NULL normalisation is deliberately NOT here. It affects zero rows
--    either way, and v1's generated client types this column as a non-nullable
--    string.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" ALTER COLUMN "image" DROP NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. "Blog_cover_source_check" -- at most one cover source. Named after
--    "Experience_logo_source_check", the same shape.
--
--    At-most-one, not exactly-one: a post with no cover is legitimate ("color",
--    a pair of Tailwind gradient classes, is the fallback, and both
--    apps/web/app/components/landing/Blogs.tsx:28-33 and the admin preview
--    branch on `if (blog.image)`).
--
--    v1 cannot violate it: createBlog/updateBlog always write a non-empty
--    "image" string and never name "coverAssetId". Intended consequence: all ten
--    rows keep a non-NULL "image", so none can be given a "coverAssetId" until
--    its "image" is cleared in the same statement.
--
--    Prisma cannot express a CHECK, so this lives only in SQL and a `db push`
--    will never recreate it. Use `migrate deploy`, never `db push`.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_cover_source_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_cover_source_check"
  CHECK ("coverAssetId" IS NULL OR "image" IS NULL);


-- -----------------------------------------------------------------------------
-- 6. The two lifecycle CHECKs. Both vacuous on today's ten DRAFT rows (P3), both
--    added VALID.
--
--    Blog_publishedAt_required_check earns its place in EXPAND rather than
--    CONTRACT: it is the guard on the one v1 path that can now do something
--    silently wrong. v1 updateBlog (apps/docs/app/lib/actions/blogs.ts:45-68)
--    sets status without ever stamping publishedAt -- the comment at :63 says so
--    -- so once the column is nullable a PUBLISHED row with no stamp becomes
--    possible, and publicContentWhere's `publishedAt <= now`
--    (packages/db/src/visibility.ts:5-10) evaluates to NULL and hides the post
--    with no error anywhere. With the CHECK, the save fails loudly instead.
--    It also keeps apps/docs/app/lib/tracked-links.ts:52-56
--    (status=PUBLISHED, orderBy publishedAt desc) free of NULLS-FIRST rows.
--
--    Blog_publishAt_required_check cannot fire under v1: both writers validate
--    SCHEDULED => publishAt server-side, at lifecycle.ts:104-112 and
--    publishing.ts:57-67.
--
--    The enum is cast explicitly: a CHECK expression must be immutable.
-- -----------------------------------------------------------------------------

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishedAt_required_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_publishedAt_required_check"
  CHECK ("status" <> 'PUBLISHED'::"ContentStatus" OR "publishedAt" IS NOT NULL);

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishAt_required_check";
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_publishAt_required_check"
  CHECK ("status" <> 'SCHEDULED'::"ContentStatus" OR "publishAt" IS NOT NULL);


-- -----------------------------------------------------------------------------
-- 7. ("status","publishedAt") -> ("status","publishedAt" DESC), SAME NAME.
--    Prisma derives an index name from table + field list and ignores the sort
--    modifier, so @@index([status, publishedAt(sort: Desc)]) still expects
--    "Blog_status_publishedAt_idx"; a "_desc_" name would read as drift.
--
--    No application code reads an index, so this is neutral for v1 and for v2.
--    It is the only non-additive statement in this file -- there is a moment with
--    no index on those two columns -- and at ten rows the planner seq-scans
--    either way. If you would rather have zero non-additive statements before the
--    deploy, move these two lines to blogs-contract.sql; nothing depends on them.
--
--    DESC defaults to NULLS FIRST. After CONTRACT nulls out the ten drafts they
--    sort ahead of everything, which costs nothing because every reader filters
--    "status" before it sorts.
--
--    "Blog_status_publishAt_idx" is NOT touched: v2 still declares it ascending,
--    which is the direction the publish-due sweep scans.
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS "Blog_status_publishedAt_idx";
CREATE INDEX IF NOT EXISTS "Blog_status_publishedAt_idx"
  ON "Blog" ("status", "publishedAt" DESC);


-- -----------------------------------------------------------------------------
-- VERIFICATION, inside the transaction, before COMMIT. Any RAISE EXCEPTION here
-- rolls the whole thing back.
-- -----------------------------------------------------------------------------

DO $$
DECLARE r RECORD;
BEGIN
  SELECT count(*)                                                   AS n,
         count(*) FILTER (WHERE "createdAt" IS NULL)                AS cnull,
         count(*) FILTER (WHERE "publishedAt" IS NULL)              AS pnull,
         count(*) FILTER (WHERE "createdAt" = "publishedAt")        AS carried,
         count(*) FILTER (WHERE "image" IS NOT NULL)                AS img,
         count(*) FILTER (WHERE "coverAssetId" IS NOT NULL)         AS cover,
         count(*) FILTER (WHERE "show")                             AS shown,
         min("createdAt") AS lo, max("createdAt") AS hi
    INTO r FROM "Blog";

  RAISE NOTICE 'V: rows=% createdAtNull=% publishedAtNull=% carried=% imageNotNull=% coverSet=% showTrue=% window=%..%',
    r.n, r.cnull, r.pnull, r.carried, r.img, r.cover, r.shown, r.lo, r.hi;

  IF r.cnull <> 0 THEN
    RAISE EXCEPTION 'V: createdAt is NULL on % rows', r.cnull;
  END IF;
  -- THE LOAD-BEARING ASSERTION OF THIS STAGE. EXPAND must not have changed one
  -- byte of data that v1 can see. If publishedAt is NULL anywhere, the null-out
  -- has leaked out of CONTRACT and publishBlogNow/setBlogStatus are now throwing
  -- TypeErrors in production.
  IF r.pnull <> 0 THEN
    RAISE EXCEPTION 'V: publishedAt is NULL on % rows -- the CONTRACT null-out must not run in this stage', r.pnull;
  END IF;
  IF r.carried <> r.n THEN
    RAISE EXCEPTION 'V: createdAt <> publishedAt on % rows -- the backfill did not carry the instant across', r.n - r.carried;
  END IF;
  IF r.cover <> 0 THEN
    RAISE EXCEPTION 'V: coverAssetId was set on % rows -- this file invents none', r.cover;
  END IF;
END $$;

-- Final shape: publishedAt nullable and STILL defaulted, createdAt NOT NULL and
-- defaulted, image nullable, show still present.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT column_name, is_nullable, coalesce(column_default,'(none)') AS dflt
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'Blog'
             AND column_name IN ('createdAt','publishedAt','publishAt','image','coverAssetId','show','imageOrientation')
           ORDER BY column_name LOOP
    RAISE NOTICE 'V shape: % nullable=% default=%', r.column_name, r.is_nullable, r.dflt;
  END LOOP;
END $$;
-- EXPECTED notices:
--   coverAssetId     nullable=YES default=(none)
--   createdAt        nullable=NO  default=CURRENT_TIMESTAMP
--   image            nullable=YES default=(none)
--   imageOrientation nullable=NO  default='LANDSCAPE'::"ImageOrientation"
--   publishAt        nullable=YES default=(none)
--   publishedAt      nullable=YES default=CURRENT_TIMESTAMP   <- default kept ON PURPOSE
--   show             nullable=NO  default=true                <- still here ON PURPOSE

-- Constraints must be exactly these five, every CHECK convalidated.
DO $$
DECLARE n INT; bad INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE contype = 'c' AND NOT convalidated)
    INTO n, bad FROM pg_constraint WHERE conrelid = '"Blog"'::regclass;
  IF n <> 5 THEN
    RAISE EXCEPTION 'V: expected 5 constraints on "Blog" (pkey + 3 checks + 1 fkey), found %', n;
  END IF;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'V: % CHECK(s) are NOT VALID', bad;
  END IF;
END $$;

-- The DESC index is the one that exists.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = current_schema() AND tablename = 'Blog'
    AND indexname = 'Blog_status_publishedAt_idx' AND indexdef LIKE '%"publishedAt" DESC%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'V: Blog_status_publishedAt_idx is not the DESC form';
  END IF;
END $$;

COMMIT;


-- =============================================================================
-- AFTER COMMIT: smoke-test the LIVE v1 admin before you deploy anything.
--   1. /blogs                 -> ten rows, dates still read 08 Mar 2026, the
--                                "Nothing is published" banner still shows.
--   2. /dashboard             -> loads (it still reads "show"), "live posts" still
--                                reads 0. That 0 is the pre-existing bug
--                                schema-v2.md documents, not something EXPAND did.
--   3. Edit any post, Update  -> saves.
--   4. Row action -> Publish now on a THROWAWAY post, then set it back to Draft.
--                                This is the path that would be dead if the
--                                null-out had leaked into EXPAND.
--   5. /media                 -> loads (v1 still scans image + content as strings).
-- Then deploy.
--
-- DO NOT publish or schedule a real post between EXPAND and DEPLOY. It is not
-- unsafe, but v1 publishBlogNow (publishing.ts:157-159, 193) leaves the seed
-- 2026-03-08 stamp in place because it only ever pulls a FUTURE date back to
-- now, and CONTRACT will not null it out either (it skips PUBLISHED rows by
-- design), so the post would print "08 mar 2026" on the live site permanently.
--
-- ROLLBACK OF THIS STAGE. Exact, because EXPAND changed no v1-visible data:
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishAt_required_check";
--   ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_publishedAt_required_check";
--   ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_cover_source_check";
--   ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_coverAssetId_fkey";
--   DROP INDEX IF EXISTS "Blog_coverAssetId_idx";
--   ALTER TABLE "Blog" DROP COLUMN IF EXISTS "coverAssetId";
--   UPDATE "Blog" SET "image" = '' WHERE "image" IS NULL;   -- 0 rows unless v2 wrote one
--   ALTER TABLE "Blog" ALTER COLUMN "image" SET NOT NULL;
--   ALTER TABLE "Blog" ALTER COLUMN "publishedAt" SET NOT NULL;  -- 0 NULLs, so this succeeds
--   DROP INDEX IF EXISTS "Blog_status_publishedAt_idx";
--   CREATE INDEX "Blog_status_publishedAt_idx" ON "Blog" ("status", "publishedAt");
--   ALTER TABLE "Blog" DROP COLUMN IF EXISTS "createdAt";
--   COMMIT;
-- Roll the CODE back first (Vercel instant rollback to the v1 deployment), then
-- this, in that order: a v2 lambda that writes image=NULL or publishedAt=NULL
-- while the SQL rollback is running makes SET NOT NULL abort.
-- =============================================================================
