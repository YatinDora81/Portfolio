-- =====================================================================
-- PRODUCTION EXPAND -- cluster: analytics
-- Run this while the CURRENTLY DEPLOYED (v1) code is live. Public site up.
-- Nothing here is destructive of data. Nothing here breaks v1.
-- =====================================================================
--
-- V1 = COMMIT 0050cc9. Every `HEAD:` citation in this file means 0050cc9 and
-- nothing else. That was true when the file was written; it is NOT true now.
-- The v2 work has since been committed, so HEAD is f760425 and `git show
-- HEAD:<path>` returns the v2 file. Read every v1 claim below with
--     git show 0050cc9:<path>
-- The v1 evidence in this file was re-checked that way on 2026-09-26; the
-- results are recorded in the "V1 EVIDENCE RE-VERIFIED AT 0050cc9" block that
-- follows this header. Working-tree/v2 paths are cited bare, with no prefix.
--
-- LOCK AND STATEMENT TIMEOUTS. This file previously set neither, which made
-- RUNBOOK.md:19 ("every ALTER runs under lock_timeout = '3s'") false for it.
-- Each stage below now opens with a plain `SET` pair, matching hero-expand.sql.
-- Plain SET, not SET LOCAL: measured on a Neon branch 2026-09-26, a standalone
-- `SET LOCAL lock_timeout` — which is exactly what `psql -f` sends, one
-- statement per message — returns `WARNING: SET LOCAL can only be used in
-- transaction blocks` and leaves the session value unchanged. Plain SET was
-- measured to persist across separate queries on both the pooled and the direct
-- Neon endpoint, so it works under `psql -f` and under a node-pg runner alike.
--
-- THE ONE SENTENCE THAT MATTERS: after this whole file, a v1 collect POST
-- (apps/web/app/api/collect/route.ts) and a v1 rollup write
-- (packages/db/src/rollup.ts) both succeed unchanged, and every column and
-- table v2 reads now exists.
--
-- WHAT IS DELIBERATELY *NOT* HERE (all of it is in analytics-contract.sql):
--   DROP "AnalyticsSession"."lastSeenAt"   v1 writes it AND returns it
--   DROP "AnalyticsEvent"."meta"           a drop, deferred on principle
--   DROP "DailyStat"."id"                  v1 names it in an INSERT and a SELECT
--   narrow "EventType" 5 -> 2              not expressible additively at all
--   DROP TABLE "UtmTracker"                six live v1 call sites
--   six unread index drops                 cleanup, no urgency
--
-- STAGE ORDER
--   0  read-only preflight            no locks, run it and read it
--   1  one transaction, additive DDL  brief ACCESS EXCLUSIVE, milliseconds
--   2  VALIDATE the five CHECKs       SHARE UPDATE EXCLUSIVE, does not block
--                                     reads or writes
--   3  CREATE INDEX CONCURRENTLY      cannot be inside a transaction
--
-- OPTIONAL BUT CHEAP: before stage 1, flip the admin feature flag
-- `analytics.enabled` off. apps/web/app/api/collect/route.ts:110 and
-- apps/web/app/api/track/utm/route.ts:53 both return early on it, so no
-- analytics write reaches Postgres at all while it is off, and the public
-- site is unaffected (the flag only removes a beacon). The toggle fires a
-- cross-app revalidate of tags.flags() (apps/docs/app/lib/actions/flags.ts:64),
-- so it takes effect in a request or two. Nothing in this file needs it --
-- every statement is milliseconds on tables of 414 to 4803 rows -- but it
-- removes even the theoretical lock wait on the hottest write path.
-- Note it does NOT stop the rollup or retention: schedulePostResponseWork()
-- is called at collect/route.ts:108, BEFORE the flag check at :110.
--
-- =====================================================================
-- V1 EVIDENCE RE-VERIFIED AT 0050cc9        (spot check 1 of 5, 2026-09-26)
--
-- WHY THIS FILE IS ONE OF THE FIVE. Stage 1.4 drops a PRIMARY KEY and a UNIQUE
-- INDEX out from under a live writer that reaches Postgres from public traffic.
-- If v1's rollup named either object, EXPAND would break the deployed code --
-- and the failure is silent, because rollupDay()'s catch turns it into
-- recordRun(...,'error') and /api/collect still returns 204.
--
-- RE-CHECKED WITH `git show 0050cc9:<path>`, NOT by reading the working tree:
--
--  1. The v1 rollup INSERT supplies "id" explicitly and arbitrates on the
--     TRIPLE, not on a named constraint.
--       0050cc9:packages/db/src/rollup.ts:217
--         gen_random_uuid()::text, ${date}::date, ${r.dimension}, ${r.key},
--       0050cc9:packages/db/src/rollup.ts:225
--         "id", "date", "dimension", "key",
--       0050cc9:packages/db/src/rollup.ts:230
--         ON CONFLICT ("date", "dimension", "key") DO UPDATE SET
--     A column-list ON CONFLICT re-infers its arbiter from whatever unique
--     index covers those columns at plan time, and 1.4 adds the new PRIMARY KEY
--     BEFORE dropping the old unique, inside one transaction. Verified safe.
--     Line-number drift worth knowing: the v2 file has the same line numbers,
--     so `HEAD:rollup.ts:225` today shows the v2 list WITHOUT "id". Reading
--     that one line at HEAD instead of 0050cc9 would have inverted the whole
--     argument for the SET DEFAULT at 1.3.
--
--  2. The second v1 reader of "DailyStat"."id" is real, and is the reason the
--     column survives EXPAND instead of being dropped here.
--       0050cc9:packages/db/src/maintenance.ts:99-101
--         const anySummary = await prisma.dailyStat.findFirst({ ...
--           select: { id: true },
--     Confirmed present at 0050cc9. Dropping "id" in EXPAND would throw 42703
--     inside pruneAnalytics.
--
--  3. The compound-unique READ compiles to plain columns, so dropping the named
--     unique index cannot break it.
--       0050cc9:packages/db/src/rollup.ts:258
--         where: { date_dimension_key: { date: dayStart, dimension: "total", ... } }
--     Prisma derives the same compound input name from @@id as from @@unique and
--     emits a three-column WHERE either way; it never names the index.
--
--  4. The two tables whose ACCESS EXCLUSIVE window is public-facing, confirmed
--     unchanged between 0050cc9 and the working tree (so the lock argument is
--     the same under both versions):
--       0050cc9:apps/web/app/r/[slug]/route.ts  -- byte-identical to HEAD
--         (`git diff --quiet 0050cc9 HEAD -- apps/web/app/r/[slug]/route.ts`)
--       0050cc9:apps/web/app/api/collect/route.ts:108  schedulePostResponseWork()
--         before the flag check at :110 -- so the flag does not stop the rollup.
--
-- VERDICT: every statement in this file is safe against the code actually
-- deployed at 0050cc9. No claim needed correcting; only the `HEAD:` labels did.
-- =====================================================================


-- =====================================================================
-- STAGE 0. PREFLIGHT. Reads only. Do not proceed past a surprise.
-- =====================================================================

-- P1: the two CHECK sets that /tmp/v2/.../data-facts.txt already proves.
-- expected: 0 rows from each.
SELECT 'AnalyticsSession.channel' AS col, "channel" AS value, count(*) AS rows
FROM "AnalyticsSession"
WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                        'search','direct','unknown-referred','unknown-shared','other')
GROUP BY 1,2
UNION ALL
SELECT 'DailyStat.dimension', "dimension", count(*)
FROM "DailyStat"
WHERE "dimension" NOT IN ('channel','country','device','path','referrer','section','total')
GROUP BY 1,2
UNION ALL
SELECT 'RollupRun.status', "status", count(*)
FROM "RollupRun" WHERE "status" NOT IN ('ok','skipped','error') GROUP BY 1,2
UNION ALL
SELECT 'RollupRun.triggeredBy', "triggeredBy", count(*)
FROM "RollupRun" WHERE "triggeredBy" NOT IN ('manual','catch-up') GROUP BY 1,2
ORDER BY 1,2;

-- P2: THE ONE SET NOTHING PROVES IN ADVANCE. data-facts.txt lists the
-- distinct values of "AnalyticsSession"."channel" but NOT of
-- "TrackedLink"."channel". v1's only writer validates with
-- z.enum(CHANNELS) (apps/docs/app/lib/actions/tracked-links.ts:28) and no
-- update path writes the column, so this SHOULD be empty -- but the values
-- are operator-typed and feed utm_source into already-sent emails, so read
-- any row here before touching it.
-- expected: 0 rows
SELECT "channel", count(*) AS rows, min("slug") AS example_slug
FROM "TrackedLink"
WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                        'search','direct','unknown-referred','unknown-shared','other')
GROUP BY 1 ORDER BY 1;

-- P3: "DailyStat" can carry a primary key on the natural triple.
-- expected: 414 | 414 | 0   (dump: 414 rows, 414 distinct triples)
SELECT count(*) AS rows,
       count(DISTINCT ("date","dimension","key")) AS distinct_triples,
       count(*) FILTER (WHERE "date" IS NULL OR "dimension" IS NULL OR "key" IS NULL) AS null_in_key
FROM "DailyStat";

-- P4: "DailyStat"."id" is TEXT NOT NULL with NO database default. This is
-- the fact the whole DailyStat half of this file turns on
-- (20260822130000_add_links_rollup_media/migration.sql:45 -- Prisma's
-- @default(uuid()) is client-side only).
-- expected: 1 row -> id | text | NO | (null)
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"DailyStat"'::regclass AND a.attname = 'id';

-- P5: nothing points a foreign key at "DailyStat", so swapping its primary
-- key drags nothing with it and needs no CASCADE.
-- expected: 0 rows
SELECT c.conname, c.conrelid::regclass AS from_table
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = to_regclass('"DailyStat"');

-- P6: "DailyStat"'s key objects are the shape this file assumes -- the pkey
-- is a CONSTRAINT on ("id"), the unique on the triple is a bare INDEX
-- (20260822130000 used CREATE UNIQUE INDEX), which is why one goes by
-- DROP CONSTRAINT and the other by DROP INDEX.
-- expected: 1 row -> DailyStat_pkey | p | PRIMARY KEY (id)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = '"DailyStat"'::regclass ORDER BY conname;
-- expected: 3 rows -> DailyStat_date_dimension_key_key, DailyStat_date_idx,
--                     DailyStat_dimension_date_idx
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'DailyStat'
  AND indexname <> 'DailyStat_pkey'
ORDER BY 1;

-- P7: no view or materialised view reads these tables (a view would block
-- a later ALTER COLUMN TYPE in CONTRACT; check it now, while it is cheap).
-- expected: 0 rows
SELECT DISTINCT c.relname AS view_name, d.refobjid::regclass AS reads
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class c   ON c.oid = r.ev_class
WHERE d.refclassid = 'pg_class'::regclass AND c.relkind IN ('v','m')
  AND d.refobjid IN (to_regclass('"AnalyticsSession"'), to_regclass('"AnalyticsEvent"'),
                     to_regclass('"TrackedLink"'), to_regclass('"DailyStat"'),
                     to_regclass('"RollupRun"'), to_regclass('"UtmTracker"'))
ORDER BY 1,2;

-- P8: first-run check. None of the five CHECKs and neither new object
-- exists yet.
-- expected: 0 rows
SELECT conname AS name FROM pg_constraint
WHERE conname IN ('AnalyticsSession_channel_check','TrackedLink_channel_check',
                  'DailyStat_dimension_check','RollupRun_status_check',
                  'RollupRun_triggeredBy_check')
UNION ALL
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname = 'AnalyticsSession_rawContent_startedAt_idx'
ORDER BY 1;

-- P9: baseline row counts. Stage 1 must not change any of them.
-- expected (from the dump): events 752, daily_stats 414, utm 1461.
-- The other three are not in data-facts.txt -- write them down.
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")   AS events,
  (SELECT count(*) FROM "DailyStat")        AS daily_stats,
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "TrackedLink")      AS tracked_links,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs,
  (SELECT count(*) FROM "UtmTracker")       AS utm_rows;


-- =====================================================================
-- STAGE 1. ONE TRANSACTION. Additive DDL only.
--
-- lock_timeout = 3s is the public-safety guarantee, and on this cluster it
-- guards one genuinely live table: 1.4's primary-key swap takes ACCESS
-- EXCLUSIVE on "DailyStat" while the beacon-driven rollup can be mid-INSERT
-- (0050cc9:packages/db/src/rollup.ts:224-230, reached from
-- 0050cc9:apps/web/app/api/collect/route.ts:108 in after()), and 1.2's
-- ADD CONSTRAINT takes it on "TrackedLink", which every /r/<slug> hit reads
-- under force-dynamic (0050cc9:apps/web/app/r/[slug]/route.ts:28). Failing at
-- 3s and retrying is strictly better than queueing those reads behind us.
-- 60s statement_timeout: the largest table here is 4803 rows, so any statement
-- that runs for a minute is wedged, not slow.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

-- Fail fast rather than half-way. Mirrors P1/P2/P3 so the transaction
-- defends itself even if the preflight was skimmed.
DO $gate$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "AnalyticsSession"
  WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                          'search','direct','unknown-referred','unknown-shared','other');
  IF n > 0 THEN RAISE EXCEPTION
    'EXPAND G1: % AnalyticsSession row(s) hold a channel outside the eleven-label set (preflight P1).', n;
  END IF;

  SELECT count(*) INTO n FROM "TrackedLink"
  WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                          'search','direct','unknown-referred','unknown-shared','other');
  IF n > 0 THEN RAISE EXCEPTION
    'EXPAND G2: % TrackedLink row(s) hold a channel outside the eleven-label set (preflight P2). Operator-typed, already inside sent links -- read them before rewriting one.', n;
  END IF;

  SELECT count(*) INTO n FROM "DailyStat"
  WHERE "dimension" NOT IN ('channel','country','device','path','referrer','section','total');
  IF n > 0 THEN RAISE EXCEPTION 'EXPAND G3: % DailyStat row(s) hold an unknown dimension.', n; END IF;

  SELECT count(*) INTO n FROM "RollupRun" WHERE "status" NOT IN ('ok','skipped','error');
  IF n > 0 THEN RAISE EXCEPTION 'EXPAND G4: % RollupRun row(s) hold an unknown status.', n; END IF;

  SELECT count(*) INTO n FROM "RollupRun" WHERE "triggeredBy" NOT IN ('manual','catch-up');
  IF n > 0 THEN RAISE EXCEPTION 'EXPAND G5: % RollupRun row(s) hold an unknown triggeredBy.', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT 1 FROM "DailyStat" GROUP BY "date","dimension","key" HAVING count(*) > 1
  ) d;
  IF n > 0 THEN RAISE EXCEPTION
    'EXPAND G6: % duplicate (date, dimension, key) group(s) in DailyStat. The existing unique index should make this impossible -- investigate before swapping the primary key.', n;
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------
-- 1.1  "AnalyticsSession" gains the three columns that absorb "UtmTracker".
--
-- v1 SAFE: v1's generated Prisma client has no knowledge of these three, so
--   no v1 statement can name them. Nullable, no default => PG 17 does not
--   rewrite the table; the ACCESS EXCLUSIVE lock is a catalog update. A
--   concurrent collect INSERT (collect/route.ts:207) waits microseconds and
--   then succeeds, writing NULL into all three.
-- v2 NEEDS IT BEFORE DEPLOY: the v2 collect writes all three at session
--   create; apps/docs/app/(dashboard)/tracker/page.tsx:47-48 selects them
--   and apps/docs/app/lib/utm.ts:8-9 filters on rawContent/rawTerm. Deploy
--   before this statement and the admin tracker page is a 42703.
-- NO BACKFILL, and that is correct, not lazy: "UtmTracker" holds no session
--   identifier of any kind (source, medium, campaign, content, term,
--   messageId, path, referrer, userAgent, visitedAt), so joining a tracker
--   hit to the session that recorded the same visit would mean inventing
--   the link from a path and a timestamp. NULL is the honest value.
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsSession"
  ADD COLUMN IF NOT EXISTS "rawContent" TEXT,
  ADD COLUMN IF NOT EXISTS "rawTerm"    TEXT,
  ADD COLUMN IF NOT EXISTS "messageId"  TEXT;

-- ---------------------------------------------------------------------
-- 1.2  The five value-set CHECKs, added NOT VALID. Stage 2 validates them.
--
-- NOT VALID still enforces on every INSERT and on every UPDATE of any row,
-- including pre-existing rows. It only skips the back-scan. So the question
-- "does this break a v1 write" is real for all five, and the answer is no:
--
--  * AnalyticsSession.channel -- the only v1 writer is collect/route.ts:211,
--    fed by resolveAttribution(), whose return type is the 11-label Channel
--    union and whose every branch ends `?? "other"`
--    (packages/shared/src/attribution.ts:164,:171). It cannot emit anything
--    else. Live values: direct, linkedin, other, search, unknown-shared.
--  * TrackedLink.channel -- the only v1 writer is createTrackedLink, gated
--    by z.enum(CHANNELS) at tracked-links.ts:28; no update path writes the
--    column. Same eleven labels, because CHANNELS *is* the set.
--  * DailyStat.dimension -- the only writer is the raw upsert at
--    rollup.ts:217-230, and the seven dimensions are literals in the source:
--    channel/country/device/referrer (the GROUPED table, rollup.ts:34-37),
--    path, section, and total.
--  * RollupRun.status / .triggeredBy -- the sets come from the WRITER, not
--    from the data. Production holds only 'ok' and 'catch-up', but
--    rollup.ts emits 'ok', 'skipped' and 'error', and
--    apps/docs/app/lib/actions/analytics.ts emits 'manual'. A CHECK narrowed
--    to the observed values would reject the first skipped run -- silently,
--    because recordRun() swallows its own failure (rollup.ts:295).
--
-- DROP first because Postgres has no ADD CONSTRAINT IF NOT EXISTS; P8 proves
-- the names are free on a first run.
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsSession" DROP CONSTRAINT IF EXISTS "AnalyticsSession_channel_check";
ALTER TABLE "AnalyticsSession"
  ADD CONSTRAINT "AnalyticsSession_channel_check"
  CHECK ("channel" IN ('linkedin','github','x','leetcode','resume','email',
                       'search','direct','unknown-referred','unknown-shared','other')) NOT VALID;

ALTER TABLE "TrackedLink" DROP CONSTRAINT IF EXISTS "TrackedLink_channel_check";
ALTER TABLE "TrackedLink"
  ADD CONSTRAINT "TrackedLink_channel_check"
  CHECK ("channel" IN ('linkedin','github','x','leetcode','resume','email',
                       'search','direct','unknown-referred','unknown-shared','other')) NOT VALID;

ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_dimension_check";
ALTER TABLE "DailyStat"
  ADD CONSTRAINT "DailyStat_dimension_check"
  CHECK ("dimension" IN ('channel','country','device','path','referrer','section','total')) NOT VALID;

ALTER TABLE "RollupRun" DROP CONSTRAINT IF EXISTS "RollupRun_status_check";
ALTER TABLE "RollupRun"
  ADD CONSTRAINT "RollupRun_status_check"
  CHECK ("status" IN ('ok','skipped','error')) NOT VALID;

ALTER TABLE "RollupRun" DROP CONSTRAINT IF EXISTS "RollupRun_triggeredBy_check";
ALTER TABLE "RollupRun"
  ADD CONSTRAINT "RollupRun_triggeredBy_check"
  CHECK ("triggeredBy" IN ('manual','catch-up')) NOT VALID;

-- ---------------------------------------------------------------------
-- 1.3  THE BRIDGE STATEMENT. Give "DailyStat"."id" a database default.
--
-- This is the single statement that makes the DailyStat change additive, and
-- it is in none of the drafts, because the drafts assumed a coupled deploy.
--
-- P4 proves "id" is TEXT NOT NULL with no default: Prisma's @default(uuid())
-- is client-side, and the rollup does not go through Prisma -- it is raw SQL.
--   v1 (rollup.ts:217-230, HEAD) writes:
--       INSERT INTO "DailyStat" ("id","date",...) VALUES (gen_random_uuid()::text, ...)
--   v2 (working tree, same lines) writes:
--       INSERT INTO "DailyStat" ("date",...)      VALUES (...)
-- Without a default, the v2 insert fails at DEPLOY with 23502
-- (null value in column "id"). With it, BOTH work: v1's explicit value wins
-- over the default, v2's omission takes it. That is what lets the column
-- survive the window and die in CONTRACT.
--
-- Failure mode this prevents is worth naming, because it is silent: the v2
-- insert runs inside prisma.$transaction() inside rollupDay()'s try/catch
-- (rollup.ts:245-285), so a 23502 becomes recordRun(...,'error',...) and a
-- 204 from /api/collect. The day's `total` row never appears, and the
-- retention floor in packages/db/src/maintenance.ts:98 (summarisedThrough)
-- then pins deletion at that day forever -- so a missing default does not
-- just stop the dashboard, it freezes the 90-day event prune.
--
-- gen_random_uuid() is built into PG 13+, so this needs no extension and no
-- superuser.
-- ---------------------------------------------------------------------
ALTER TABLE "DailyStat" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- ---------------------------------------------------------------------
-- 1.4  "DailyStat": swap the primary key onto the natural triple, KEEPING
--      the "id" column. CONTRACT is then a single DROP COLUMN.
--
-- v1 SAFE, three separate reasons:
--  (a) the column survives with its NOT NULL and now a DEFAULT, so v1's
--      INSERT column list at rollup.ts:222-226 still resolves, and
--      summarisedThrough's `select: { id: true }`
--      (packages/db/src/maintenance.ts:99-102 in HEAD) still returns a row.
--      That second call site is the one nobody expects: dropping "id" in
--      EXPAND would throw 42703 inside pruneAnalytics, and because
--      MaintenanceState.lastRunAt is bumped BEFORE the task body runs, the
--      retention task would then be locked out for its full 24 hours with
--      nothing but an `error:` prefix in lastResult.
--  (b) the ON CONFLICT ("date","dimension","key") arbiter at rollup.ts:228
--      re-infers against whichever unique index covers those three columns.
--      The new PRIMARY KEY provides one. It is added BEFORE the old unique
--      index is dropped, and all of it is inside this one transaction, so no
--      other session ever observes a moment with no arbiter -- a concurrent
--      rollup INSERT blocks on the table lock and re-plans after COMMIT. Run
--      these four statements outside a transaction and you open a real
--      42P10 ("no unique or exclusion constraint matching the ON CONFLICT
--      specification") window.
--  (c) Prisma never asks the database which column it calls the primary key.
--      dailyStat.findUnique({ where: { date_dimension_key: {...} } })
--      (rollup.ts:257) compiles to a plain three-column WHERE either way --
--      Prisma derives the same compound input name from @@id as from
--      @@unique -- and findFirst({ select: { id: true } }) compiles to
--      SELECT "id". Both keep working.
--
-- Doing the swap here rather than in CONTRACT also makes EXPAND's rollback
-- LOSSLESS: the original "id" values are never destroyed, so putting the old
-- primary key back restores the exact bytes. Defer the swap to CONTRACT
-- instead and nothing breaks either -- it just means CONTRACT holds an
-- ACCESS EXCLUSIVE lock it did not need to.
--
-- The redundant unique goes by DROP INDEX, not DROP CONSTRAINT: P6 shows
-- 20260822130000 created it with CREATE UNIQUE INDEX. The DROP CONSTRAINT
-- IF EXISTS first is belt and braces -- if it ever WERE a constraint,
-- DROP INDEX alone fails with "cannot drop index ... because constraint ...
-- requires it".
--
-- "DailyStat_date_idx" goes too, and no v1 read regresses: every reader
-- filters on dimension as well (analytics-read.ts:195 date+dimension,
-- :202 aggregate on dimension, maintenance.ts:115 dimension+date range), so
-- the planner was always choosing "DailyStat_dimension_date_idx", which
-- stays.
-- ---------------------------------------------------------------------
DO $dailystat$
DECLARE
  id_attnum smallint;
BEGIN
  SELECT attnum INTO id_attnum FROM pg_attribute
  WHERE attrelid = '"DailyStat"'::regclass AND attname = 'id' AND NOT attisdropped;

  -- exact test on the key's column set, not on the rendered definition
  -- string: a second run finds the primary key on three columns and skips.
  IF id_attnum IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"DailyStat"'::regclass AND contype = 'p'
      AND conkey = ARRAY[id_attnum]
  ) THEN
    ALTER TABLE "DailyStat" DROP CONSTRAINT "DailyStat_pkey";
    ALTER TABLE "DailyStat"
      ADD CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("date", "dimension", "key");

    ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_date_dimension_key_key";
    DROP INDEX IF EXISTS "DailyStat_date_dimension_key_key";
    DROP INDEX IF EXISTS "DailyStat_date_idx";
  END IF;
END
$dailystat$;

COMMIT;


-- =====================================================================
-- STAGE 2. Validate the five CHECKs.
--
-- Separate statements on purpose, each its own transaction. VALIDATE takes
-- only SHARE UPDATE EXCLUSIVE: it does not block SELECT, INSERT or UPDATE,
-- so /api/collect keeps writing straight through it. (Inside stage 1's
-- transaction the two-step would have bought nothing -- the locks accumulate
-- to COMMIT.)
--
-- If one of these fails it is TrackedLink_channel_check and it means P2 was
-- skipped. Nothing is damaged: the constraint stays NOT VALID and still
-- enforces on new writes. Fix the row, then re-run just that VALIDATE, or
-- DROP the constraint if the value turns out to be a legitimate new channel
-- (in which case it belongs in packages/shared/src/attribution.ts and in
-- this CHECK together, before either ships).
--
-- The SET pair is repeated because stage 1's COMMIT does not clear it but a
-- reconnect does, and these five statements are the ones an operator is most
-- likely to re-run on their own later.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE "AnalyticsSession" VALIDATE CONSTRAINT "AnalyticsSession_channel_check";
ALTER TABLE "TrackedLink"      VALIDATE CONSTRAINT "TrackedLink_channel_check";
ALTER TABLE "DailyStat"        VALIDATE CONSTRAINT "DailyStat_dimension_check";
ALTER TABLE "RollupRun"        VALIDATE CONSTRAINT "RollupRun_status_check";
ALTER TABLE "RollupRun"        VALIDATE CONSTRAINT "RollupRun_triggeredBy_check";


-- =====================================================================
-- STAGE 3. The one new index. CONCURRENTLY, so it cannot be in a
-- transaction and cannot be in stage 1.
--
-- "AnalyticsSession" is written on every single visit (collect/route.ts:207),
-- which is exactly the table where a plain CREATE INDEX's SHARE lock would
-- block INSERTs. At this row count that is microseconds either way, but
-- CONCURRENTLY costs nothing and the habit is worth keeping.
--
-- A composite and not a partial WHERE "rawContent" IS NOT NULL, even though
-- partial is what the query wants: Prisma cannot declare a partial index, and
-- a raw-SQL-only index is exactly what a future `prisma db push` drops
-- silently. The name matches @@index([rawContent, startedAt]) so
-- `migrate diff` sees no drift.
--
-- Every value in the new column is NULL at this point, so the build is
-- trivial. It is here rather than in CONTRACT because v2's outreach read
-- (apps/docs/app/lib/utm.ts:8-9) uses it from the first request after DEPLOY.
--
-- If this is interrupted it leaves an INVALID index. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX it before retrying. It cannot corrupt anything.
--
-- *** THIS STATEMENT MUST BE SUBMITTED ON ITS OWN. ***
-- "cannot be in a transaction" is stronger than it reads, and the new
-- node-pg runner is exactly the shape that trips it. MEASURED on a Neon
-- branch, 2026-09-26, identically on the pooled and the direct endpoint:
--   client.query("select 1; create index concurrently ...")
--     -> 25001  CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--   client.query("commit;  create index concurrently ...")
--     -> 25001  (the leading COMMIT does NOT help: the remainder of the
--                message is a fresh implicit transaction block)
--   client.query("create index concurrently ...")            -> SUCCEEDS
-- A multi-statement simple query IS a transaction block. So a runner that
-- sends this whole file as one string cannot apply stage 3 at all, and a
-- runner that wraps the file in its own BEGIN cannot either. Stage 3 has to
-- be its own request, whether that is `psql -c`, a third `\i`, or a separate
-- client.query(). RUNBOOK.md Step 13's gate says so.
--
-- statement_timeout is deliberately 0 here, not 60s. CREATE INDEX
-- CONCURRENTLY waits for concurrent transactions to drain twice; a
-- statement_timeout that fires mid-build is the one way to manufacture the
-- INVALID index this comment warns about. lock_timeout stays at 3s -- failing
-- to take the lock costs nothing and leaves no index behind.
-- =====================================================================
SET lock_timeout = '3s';
SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AnalyticsSession_rawContent_startedAt_idx"
  ON "AnalyticsSession" ("rawContent", "startedAt");


-- =====================================================================
-- VERIFICATION. All reads except V6, which writes inside a ROLLBACK.
-- =====================================================================

-- V1: three new columns exist, TEXT, nullable -- and "lastSeenAt" is STILL
-- THERE. Its presence is the proof that v1 collect still works.
-- expected: 4 rows ->
--   lastSeenAt | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   messageId  | text                        | YES | (null)
--   rawContent | text                        | YES | (null)
--   rawTerm    | text                        | YES | (null)
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"AnalyticsSession"'::regclass
  AND a.attname IN ('rawContent','rawTerm','messageId','lastSeenAt')
  AND NOT a.attisdropped
ORDER BY a.attname;

-- V2: "AnalyticsEvent" still has "meta", and "EventType" still has FIVE
-- labels. Both are proof that EXPAND left v1's contract alone.
-- expected: meta_present 1 | eventtype_labels 5
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'AnalyticsEvent'
     AND column_name = 'meta') AS meta_present,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'EventType') AS eventtype_labels;

-- V3: "DailyStat" is keyed on the triple, and "id" survives WITH a default.
-- expected: DailyStat_pkey | p | PRIMARY KEY ("date", dimension, key)
--   (Postgres re-quotes only "date", which is reserved. Match the semantics.)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = '"DailyStat"'::regclass AND contype = 'p';
-- expected: 1 row -> id | text | NO | gen_random_uuid()::text
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"DailyStat"'::regclass AND a.attname = 'id';
-- expected: exactly 2 rows -> DailyStat_dimension_date_idx, DailyStat_pkey
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'DailyStat' ORDER BY 1;

-- V4: all five CHECKs exist and every one is validated. convalidated = f
-- means stage 2 did not finish. Postgres normalises an IN list to
-- `= ANY (ARRAY[...])`, so match on names and member sets, not on the text.
-- expected: exactly 5 rows, convalidated = t on every one
SELECT conrelid::regclass AS table_name, conname, convalidated,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('AnalyticsSession_channel_check','TrackedLink_channel_check',
                  'DailyStat_dimension_check','RollupRun_status_check',
                  'RollupRun_triggeredBy_check')
ORDER BY conname;

-- V5: the new index exists and is VALID (CONCURRENTLY can leave it invalid).
-- expected: 1 row -> AnalyticsSession_rawContent_startedAt_idx | t
SELECT i.indexrelid::regclass AS index_name, i.indisvalid
FROM pg_index i
WHERE i.indexrelid = to_regclass('"AnalyticsSession_rawContent_startedAt_idx"');

-- V6: THE PROOF OF THE WHOLE CLUSTER. Both the v1 and the v2 DailyStat
-- upsert must succeed against this one schema. Everything rolls back.
-- expected: 2 rows, id_filled = t on both.
BEGIN;
  -- v1's shape, verbatim from rollup.ts:217-230 in git HEAD
  INSERT INTO "DailyStat" ("id","date","dimension","key","pageviews","uniques",
                           "sessions","avgDurationMs","medianMs","reachedCount","computedAt")
  VALUES (gen_random_uuid()::text, DATE '1999-01-01', 'total', '—', 1,1,1,0,0,0, NOW())
  ON CONFLICT ("date","dimension","key") DO UPDATE SET "pageviews" = EXCLUDED."pageviews";

  -- v2's shape, verbatim from the working tree's rollup.ts -- no "id"
  INSERT INTO "DailyStat" ("date","dimension","key","pageviews","uniques",
                           "sessions","avgDurationMs","medianMs","reachedCount","computedAt")
  VALUES (DATE '1999-01-02', 'total', '—', 1,1,1,0,0,0, NOW())
  ON CONFLICT ("date","dimension","key") DO UPDATE SET "pageviews" = EXCLUDED."pageviews";

  SELECT "date", "id" IS NOT NULL AS id_filled, length("id") AS id_len
  FROM "DailyStat" WHERE "date" IN (DATE '1999-01-01', DATE '1999-01-02') ORDER BY 1;
ROLLBACK;

-- V7: nothing lost a row. Compare against P9.
-- expected: 752 | 414 | and sessions / tracked_links / rollup_runs / utm_rows
--           identical to the P9 baseline (utm_rows may have GROWN, because
--           v1 is still writing that table -- it must not have shrunk).
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")   AS events,
  (SELECT count(*) FROM "DailyStat")        AS daily_stats,
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "TrackedLink")      AS tracked_links,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs,
  (SELECT count(*) FROM "UtmTracker")       AS utm_rows;

-- V8: the live proof, from the application rather than the catalog. Load the
-- admin analytics dashboard (readAnalytics, apps/docs/app/lib/analytics-read.ts)
-- and the tracker page. Both are still v1 at this point and both must render.
-- Then hit the public site once and confirm a fresh row appears:
--   SELECT max("startedAt"), max("lastSeenAt") FROM "AnalyticsSession";
--   SELECT max("createdAt") FROM "AnalyticsEvent";
-- Both maxima must move. If they do not, v1 collect is failing silently --
-- it returns 204 on every error (collect/route.ts:170-173).


-- =====================================================================
-- ROLLBACK OF EXPAND. Lossless, and safe to run with v1 still live.
-- =====================================================================
--   BEGIN;
--   -- CHECKs
--   ALTER TABLE "AnalyticsSession" DROP CONSTRAINT IF EXISTS "AnalyticsSession_channel_check";
--   ALTER TABLE "TrackedLink"      DROP CONSTRAINT IF EXISTS "TrackedLink_channel_check";
--   ALTER TABLE "DailyStat"        DROP CONSTRAINT IF EXISTS "DailyStat_dimension_check";
--   ALTER TABLE "RollupRun"        DROP CONSTRAINT IF EXISTS "RollupRun_status_check";
--   ALTER TABLE "RollupRun"        DROP CONSTRAINT IF EXISTS "RollupRun_triggeredBy_check";
--   -- DailyStat: the "id" values were never destroyed, so this is exact
--   ALTER TABLE "DailyStat" DROP CONSTRAINT "DailyStat_pkey";
--   ALTER TABLE "DailyStat" ADD CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id");
--   CREATE UNIQUE INDEX "DailyStat_date_dimension_key_key" ON "DailyStat" ("date","dimension","key");
--   CREATE INDEX "DailyStat_date_idx" ON "DailyStat" ("date");
--   ALTER TABLE "DailyStat" ALTER COLUMN "id" DROP DEFAULT;   -- optional; harmless to leave
--   -- AnalyticsSession
--   ALTER TABLE "AnalyticsSession"
--     DROP COLUMN IF EXISTS "rawContent",
--     DROP COLUMN IF EXISTS "rawTerm",
--     DROP COLUMN IF EXISTS "messageId";
--   COMMIT;
--   DROP INDEX CONCURRENTLY IF EXISTS "AnalyticsSession_rawContent_startedAt_idx";
--
-- The three dropped columns lose only the values v1 never wrote. Leaving the
-- DEFAULT on "DailyStat"."id" in place is harmless -- v1 overrides it -- so
-- prefer leaving it if you intend to retry.
-- =====================================================================
