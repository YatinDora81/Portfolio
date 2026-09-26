-- =====================================================================
-- PRODUCTION CONTRACT -- cluster: analytics
-- Run ONLY after the v2 code is deployed to BOTH apps and confirmed working.
-- Every statement here breaks the v1 code. That is the definition of the file.
-- =====================================================================
--
-- CONFIRM BEFORE THE FIRST STATEMENT. Not optional, and not checkable in SQL:
--   1. The Vercel deployment serving yatindora.in and the admin is the v2
--      commit. Check the deployment SHA, not "I pushed".
--   2. The admin analytics dashboard renders. That page
--      (apps/docs/app/lib/analytics-read.ts, readAnalytics) is the widest
--      single reader in this cluster -- it touches DailyStat, RollupRun,
--      AnalyticsSession, AnalyticsEvent and (in v1) UtmTracker in one
--      Promise.all, so if it renders, the v2 reads are all live.
--   3. The admin tracker page renders. It is the only reader of
--      "rawContent"/"rawTerm"/"messageId" (tracker/page.tsx:47-48), so it
--      proves EXPAND's three columns are wired.
--   4. Hit the public site once, then:
--        SELECT max("startedAt") FROM "AnalyticsSession";
--        SELECT max("createdAt") FROM "AnalyticsEvent";
--      Both must move. v2 collect returns 204 on every error too, so a
--      silently failing collector looks exactly like a healthy one.
--   5. A rollup has succeeded under v2. This is the one that catches the
--      DailyStat.id default being missing or wrong:
--        SELECT "date","status","rowsWritten","triggeredBy","createdAt","error"
--        FROM "RollupRun" ORDER BY "createdAt" DESC LIMIT 5;
--      There must be at least one row with status 'ok' and a createdAt after
--      the deploy. If the newest rows say 'error', STOP -- read the error
--      column before dropping anything.
--
-- WAIT AT LEAST ONE FULL ROLLUP CYCLE between DEPLOY and this file. The
-- rollup and retention have no cron (there is no vercel.json): they ride
-- `after()` on /api/collect (collect/route.ts:100 schedulePostResponseWork).
-- On a low-traffic site "the next visit" can be hours. Do not confuse
-- "nothing has failed" with "nothing has run".
--
-- STAGE ORDER
--   0  gates, reads only
--   1  one transaction: the four column/index removals
--   2  one transaction: narrow "EventType" 5 -> 2 (the only table rewrite)
--   3  one transaction: retire "UtmTracker" by RENAME, not DROP
--
-- =====================================================================
-- STAGE 0. GATES. Reads only.
-- =====================================================================

-- G1: no surviving row carries a dropped EventType label. This is not a
-- formality and it is not settled by the earlier dump: /api/collect is
-- unauthenticated, and between EXPAND and DEPLOY the v1 build's
-- z.nativeEnum(EventType) (collect/route.ts:23 in HEAD) still had all five
-- members, so it would have PASSED validation for a CLICK and written the
-- row. After DEPLOY that door is shut -- the v2 client enum has two members,
-- so the zod parse rejects the batch at the edge before touching Postgres.
-- So this gate covers exactly the EXPAND->DEPLOY window.
-- expected: 0 rows
SELECT "type"::text AS value, count(*) AS rows, min("createdAt") AS first_seen
FROM "AnalyticsEvent"
WHERE "type"::text NOT IN ('PAGEVIEW','SECTION_DWELL')
GROUP BY 1 ORDER BY 1;
--
-- IF THIS RETURNS ROWS: delete them. It is safe. Nothing reads an individual
-- AnalyticsEvent row; the rollup counts only PAGEVIEW and SECTION_DWELL
-- (rollup.ts computeDay), so a CLICK row contributes to nothing except the
-- `total` dimension's `sessions`/`uniques`/`events` counts. Delete, then
-- re-run that day from the admin ("Resummarise", actions/analytics.ts) --
-- the upsert is idempotent.
--   DELETE FROM "AnalyticsEvent" WHERE "type"::text NOT IN ('PAGEVIEW','SECTION_DWELL');

-- G2: exactly one live column uses "EventType". A second one would survive
-- the RENAME still typed EventType_old and then block the DROP TYPE.
-- expected: 1 row -> AnalyticsEvent | type
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
WHERE a.atttypid = '"EventType"'::regtype AND NOT a.attisdropped AND a.attnum > 0
ORDER BY 1,2;

-- G3: "AnalyticsEvent"."meta" is still non-null on zero rows, so the drop
-- destroys a definition and no information. The dump said 0; v1 had no
-- writer for it at all, so this should still be 0.
-- expected: 0
SELECT count(*) AS meta_non_null FROM "AnalyticsEvent" WHERE "meta" IS NOT NULL;

-- G4: "UtmTracker" is about to become unreachable, and it is the only
-- IRREVERSIBLE loss in this cluster. The count has GROWN since the dump --
-- v1's /api/track/utm kept writing right up to DEPLOY
-- (apps/web/app/api/track/utm/route.ts:103 in HEAD). Compare against the
-- dump's 1461 and understand the difference before proceeding.
-- expected: >= 1461
SELECT count(*) AS utm_rows,
       count(*) FILTER (WHERE "content" IS NOT NULL) AS utm_with_content,
       max("visitedAt") AS newest
FROM "UtmTracker";
--
-- TAKE A FRESH DUMP NOW, not at EXPAND time:
--   cd packages/db && bun run db:dump --from=PROD_DATABASE_URL
-- The rows written during the window exist in NO earlier dump. There is no
-- backfill into "AnalyticsSession" and none is possible: "UtmTracker" holds
-- no session identifier of any kind, so linking a tracker hit to the session
-- that recorded the same visit would mean inventing the join from a path and
-- a timestamp. Stage 3 renames rather than drops precisely because of this.

-- G5: baseline, to compare against after each stage.
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")   AS events,
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "DailyStat")        AS daily_stats,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs;

-- G6: EXPAND actually landed. If "DailyStat"."id" has no default, the v2
-- rollup has been failing since DEPLOY and you are about to make it worse.
-- expected: 1 row -> id | gen_random_uuid()::text
SELECT a.attname, pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"DailyStat"'::regclass AND a.attname = 'id';
-- expected: PRIMARY KEY ("date", dimension, key)
SELECT pg_get_constraintdef(oid) AS pkey
FROM pg_constraint WHERE conrelid = '"DailyStat"'::regclass AND contype = 'p';


-- =====================================================================
-- STAGE 1. The column and index removals. One transaction.
-- =====================================================================
BEGIN;

DO $gate$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "AnalyticsEvent" WHERE "meta" IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION
    'CONTRACT G3: % AnalyticsEvent row(s) hold a non-null meta. That JSON has nowhere to go in v2 -- decide what it is before dropping the column.', n;
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------
-- 1.1  "AnalyticsSession"."lastSeenAt".
--
-- WHY IT COULD NOT GO IN EXPAND, in two independent ways, both in v1's
-- collect handler at apps/web/app/api/collect/route.ts:159-165 (git HEAD):
--   (a) it is in the SET list -- `data: { lastSeenAt: new Date(), ... }` --
--       so the UPDATE names a column that no longer exists: 42703.
--   (b) that update() has no `select`, so Prisma returns the full model and
--       enumerates every v1 scalar in the RETURNING clause, "lastSeenAt"
--       included. Even deleting line 162 would not have saved it.
-- And the blast radius is not "the timestamp goes stale". That update is the
-- second element of prisma.$transaction([createMany, update]) at :148, so
-- the failure rolls the createMany back too, and collect/route.ts:170-173
-- catches it and returns 204. Every pageview and every dwell event, silently
-- discarded, for the entire EXPAND->DEPLOY window, with nothing visible
-- except a logger.error line in the Vercel function log.
--
-- WHY IT IS SAFE NOW, and why it was also safe to leave it in place through
-- the window: the column is NOT NULL DEFAULT CURRENT_TIMESTAMP
-- (20260822120000_add_analytics_core/migration.sql:42), and v2's session
-- create uses `select: { id: true }`, so v2 never names it in either
-- direction -- the default filled it and the narrow select ignored it. v2's
-- update writes only `pageviews` and is now skipped entirely for a
-- dwell-only batch, which is the normal case. Zero readers anywhere in the
-- monorepo, in either version.
--
-- The value is gone for good. Closest proxy, if it is ever wanted:
--   max("AnalyticsEvent"."createdAt") per sessionId -- and only until the
--   90-day event retention deletes those rows.
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsSession" DROP COLUMN IF EXISTS "lastSeenAt";

-- ---------------------------------------------------------------------
-- 1.2  "AnalyticsEvent"."meta".
--
-- The honest note: this one was ALSO safe in EXPAND, and it is the only drop
-- in the cluster that was. Zero code references in v1, zero non-null rows,
-- and every v1 read of the table carries an explicit `select`
-- (analytics-read.ts:214-221, maintenance.ts:105-108, rollup.ts:301-304), so
-- no v1 statement would have named it -- `createMany` builds its column list
-- from the supplied keys and emits no RETURNING, and nothing anywhere does
-- `include: { events: true }`, which is the one construct that would have
-- pulled every AnalyticsEvent scalar implicitly.
-- It is here anyway, because "EXPAND contains no DROP" is a property worth
-- having: it makes the expand stage provably reversible, and it means a
-- missed call site cannot cost anything.
--
-- "label" is NOT dropped, here or anywhere in this file. v2 still writes it
-- (collect/route.ts, `label: e.label`) and the v2 zod schema still accepts
-- it. Dropping it now would fail every collect transaction inside the catch
-- that returns 204 -- total silent loss of analytics, the same failure shape
-- as 1.1. It belongs in a later contract, after the commit that removes the
-- three code sites.
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsEvent" DROP COLUMN IF EXISTS "meta";

-- ---------------------------------------------------------------------
-- 1.3  "DailyStat"."id". EXPAND already moved the primary key onto
--      (date, dimension, key) and gave this column a DEFAULT so both the v1
--      and the v2 rollup could write it. Now only v2 is live, and v2's raw
--      upsert (packages/db/src/rollup.ts, working tree) omits the column
--      entirely. It can go.
--
-- WHY IT COULD NOT GO IN EXPAND -- two call sites, and the second is the one
-- that surprises people:
--   (a) packages/db/src/rollup.ts:217-226 (HEAD) names "id" in the INSERT
--       column list and supplies gen_random_uuid()::text in the tuple. 42703.
--       Inside prisma.$transaction inside rollupDay's try/catch, so it
--       surfaces only as a RollupRun row with status 'error'.
--   (b) packages/db/src/maintenance.ts:99-102 (HEAD):
--         prisma.dailyStat.findFirst({ where: { dimension: "total" },
--                                      select: { id: true } })
--       inside summarisedThrough(), which is the retention FLOOR. 42703 there
--       throws out of pruneAnalytics -- and MaintenanceState.lastRunAt is
--       bumped BEFORE the task body runs, so the retention task then sits out
--       its full 24-hour interval with nothing but an `error:` prefix in
--       lastResult. v2 changed that select to `{ date: true }`, which is why
--       it is safe now.
-- Losing the values costs nothing: a gen_random_uuid() with no foreign key
-- pointing at it (stage-0 G5/preflight P5 in the expand file) and no reader
-- in either version that does anything with the value.
-- ---------------------------------------------------------------------
ALTER TABLE "DailyStat" DROP COLUMN IF EXISTS "id";

-- ---------------------------------------------------------------------
-- 1.4  Six indexes nothing reads. All six were safe in EXPAND too -- an
--      index drop cannot make a statement fail -- and all six are here
--      because dropping them before the deploy takes an ACCESS EXCLUSIVE
--      lock on the hottest write path in exchange for nothing.
--
--  AnalyticsSession[channel, startedAt]      the channel panel reads
--                                            "DailyStat", never sessions
--  AnalyticsSession[visitorHash, startedAt]  served no surviving query
--  AnalyticsEvent[section, createdAt]        both section reads are
--                                            "createdAt" ranges
--                                            (analytics-read.ts rawSections,
--                                            rollup.ts sections)
--  TrackedLink[channel, createdAt]           the admin list loads every row
--  TrackedLink[active, createdAt]            and filters in JavaScript
--  JobLock[expiresAt]                        every access has the primary
--                                            key in its WHERE; nothing scans
--                                            or prunes by expiry
--
-- AnalyticsEvent's index drop is deliberately before stage 2: ALTER COLUMN
-- TYPE rewrites the table and rebuilds every index on it, and there is no
-- point rebuilding one that is about to go.
--
-- KEPT, on purpose: "AnalyticsSession_startedAt_idx" (retention prunes by
-- it), "AnalyticsEvent_createdAt_idx", "AnalyticsEvent_type_createdAt_idx",
-- "AnalyticsEvent_sessionId_idx", "DailyStat_dimension_date_idx", both
-- LinkClick indexes, and "RollupRun_date_idx" -- that last one has no reader
-- and schema-v2.md keeps it anyway, so the inconsistency with JobLock stays
-- visible rather than being quietly resolved here.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS "AnalyticsSession_channel_startedAt_idx";
DROP INDEX IF EXISTS "AnalyticsSession_visitorHash_startedAt_idx";
DROP INDEX IF EXISTS "AnalyticsEvent_section_createdAt_idx";
DROP INDEX IF EXISTS "TrackedLink_channel_createdAt_idx";
DROP INDEX IF EXISTS "TrackedLink_active_createdAt_idx";
DROP INDEX IF EXISTS "JobLock_expiresAt_idx";

COMMIT;


-- =====================================================================
-- STAGE 2. Narrow "EventType" from five labels to two.
--
-- THIS IS THE ONE CHANGE IN THE CLUSTER THAT IS NOT ADDITIVE IN ANY FORM.
-- Postgres has no ALTER TYPE ... DROP VALUE, so the type is replaced, and
-- replacing the type of a column REWRITES the table and rebuilds every index
-- on it under ACCESS EXCLUSIVE. "AnalyticsEvent" is the table /api/collect
-- INSERTs into on every visit. At ~752 rows plus whatever the window added,
-- the rewrite is single-digit milliseconds and a concurrent INSERT simply
-- waits on the lock -- but the lock is real and the enum is the public
-- beacon contract, so read the three options before running it.
--
--  A. HERE, IN CONTRACT (this file -- recommended). v2 is live, so its
--     z.nativeEnum(EventType) already has two members and rejects a batch
--     containing CLICK at the zod parse, before Postgres is involved. No new
--     dropped-label row can appear, and G1 proved none survives.
--  B. In EXPAND. Strictly worse. The deployed v1 zod still ACCEPTS all five
--     labels, so narrowing the database first converts "one event nobody
--     emits is ignored" into "the whole $transaction fails" -- and that
--     transaction also holds the createMany, so a batch of up to 20 real
--     pageviews dies with it, inside the catch that returns 204.
--  C. Never narrow the database type at all. Leave five labels in Postgres
--     and let v2's zod be the only gate. Functionally identical, genuinely
--     zero-risk, and the honest cost is permanent drift: `prisma migrate
--     diff` will report the enum forever, and the next `db push` or
--     `migrate dev` will attempt this same cast at a moment nobody chose.
--     Acceptable as a deferral; not acceptable as a silent one.
--
-- THE RESIDUAL RISK IN OPTION A, named precisely: changing the column's type
-- changes its type OID. A Postgres backend holding a cached plan for a
-- prepared statement that references the old OID raises 0A000
-- "cached plan must not change result type" once, before re-planning. Prisma
-- uses prepared statements, and a warm Vercel function can hold a Neon
-- connection across invocations. No v2 read returns the `type` column
-- (analytics-read.ts uses count({where:{type}}) and a three-column select),
-- so the exposure is the collect INSERT's parameter, and the cost is at most
-- one dropped batch -- a 204 the browser never sees.
-- To reduce it to zero: flip the admin flag `analytics.enabled` off, wait for
-- the cross-app revalidate, run this stage, flip it back on. While it is off
-- /api/collect returns at collect/route.ts:103 without touching Postgres, and
-- the public site is unaffected -- the flag only removes a beacon.
--
-- Safe in ONE transaction because the new type is CREATEd inside it. The
-- "new enum values are not usable until commit" rule applies to
-- ALTER TYPE ... ADD VALUE on a pre-existing type, which this is not, so the
-- USING cast can name the labels immediately.
-- The column has no DEFAULT (schema.prisma declares `type EventType` bare),
-- so there is nothing to drop and re-add around the cast, and NOT NULL plus
-- the SERIAL identity survive untouched.
-- =====================================================================
BEGIN;

DO $enum$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventType_old') THEN
    RAISE EXCEPTION
      'CONTRACT: type "EventType_old" already exists. A previous run was interrupted outside a transaction. Inspect and drop it by hand before retrying.';
  END IF;

  SELECT count(*) INTO n FROM "AnalyticsEvent"
  WHERE "type"::text NOT IN ('PAGEVIEW','SECTION_DWELL');
  IF n > 0 THEN
    RAISE EXCEPTION
      'CONTRACT G1: % AnalyticsEvent row(s) carry a dropped EventType label, written by the v1 build during the EXPAND->DEPLOY window. Delete them (safe -- see stage 0) and re-summarise that day, then retry.', n;
  END IF;

  -- guard on the LABELS, not on the type's existence: after a successful run
  -- "EventType" still exists, it just has two labels, so this makes the
  -- whole stage a no-op on a re-run.
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'EventType' AND e.enumlabel NOT IN ('PAGEVIEW','SECTION_DWELL')
  ) THEN
    ALTER TYPE "EventType" RENAME TO "EventType_old";
    CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'SECTION_DWELL');
    ALTER TABLE "AnalyticsEvent"
      ALTER COLUMN "type" TYPE "EventType" USING "type"::text::"EventType";
    -- succeeds only once nothing references it, which is the point: if this
    -- errors, the message names the straggler. Do NOT reach for CASCADE --
    -- on a type, CASCADE drops the dependent COLUMNS.
    DROP TYPE "EventType_old";
  END IF;
END
$enum$;

COMMIT;


-- =====================================================================
-- STAGE 3. Retire "UtmTracker".
--
-- RENAME, NOT DROP. Deliberate, and a departure from the branch draft.
--
-- WHY IT COULD NOT GO IN EXPAND -- six live v1 call sites, and one of them is
-- not an obscure page:
--   apps/docs/app/lib/analytics-read.ts:258   prisma.utmTracker.count(), and
--     it sits inside the single Promise.all of readAnalytics(), so a 42P01
--     there takes down the ENTIRE admin analytics dashboard, not a panel.
--   apps/docs/app/(dashboard)/tracker/page.tsx:42        page 500s
--   apps/docs/app/(dashboard)/refer-emails/page.tsx:79   page 500s
--   apps/docs/app/lib/actions/refer-emails.ts:38-40      server action throws
--   apps/docs/app/lib/utm.ts:57                          reads the table
--   apps/web/app/api/track/utm/route.ts:95,:103 -- the PUBLIC one. Both sit
--     inside a try whose catch returns HTTP 500, and v1's layout renders
--     <UtmTrackerBeacon /> on every page (apps/web/app/layout.tsx:105), so
--     dropping this table under v1 means a 500 from the public origin on
--     essentially every pageview. It does not break rendering -- the beacon
--     is a client-side fetch -- but it is a 500 on the hot path, and it is
--     avoidable by waiting.
--
-- WHY RENAME. This is the only irreversible loss in the cluster (1461+ rows,
-- 455+ with a non-null "content"), and it survives nowhere in the database
-- once it is gone -- only in a JSON dump. A rename keeps a lossless, instant
-- rollback available for as long as you want one: if v2 has to be reverted to
-- v1, v1 needs this table back, and RENAME back is one statement, whereas
-- DROP plus a JSON restore is a manual recovery under pressure. Its four
-- indexes follow the rename automatically.
--
-- v2 reads nothing here: apps/web/app/api/track/utm/route.ts and
-- apps/web/app/components/UtmTrackerBeacon.tsx are DELETED in the v2 commit,
-- and apps/docs/app/lib/utm.ts now reads "AnalyticsSession"."rawContent".
--
-- What the merge costs, stated once more so it is not a surprise later:
-- "rawContent" inherits the 90-day retention "UtmTracker" never had, so
-- "did this recipient visit" becomes a rolling 90-day window rather than a
-- permanent ledger, and it starts from an empty history. The full referrer
-- and the raw user agent have no new home at all -- that is the privacy win
-- and also two columns the tracker screen can no longer fill. And the capture
-- rule changes: the old route recorded a hit whenever source, medium and
-- campaign were all present, while session attribution is written only at
-- session create, so an outreach link opened inside an existing 30-minute
-- session now records no "rawContent" at all.
-- =====================================================================
BEGIN;

ALTER TABLE IF EXISTS "UtmTracker" RENAME TO "UtmTracker__retired_v2";

COMMIT;

-- FOLLOW-UP, after v2 has run clean for a week or two and you are certain
-- there is no rollback to v1. Run it as its own deliberate act, with a fresh
-- dump in hand -- not as part of this file:
--
--   DROP TABLE IF EXISTS "UtmTracker__retired_v2";
--
-- Until then the table is inert: no code in either app names either name, and
-- nothing writes it.


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- V1: the three dropped columns are gone and "label" survives.
-- expected: 3 rows -> AnalyticsEvent | label
--                     AnalyticsSession | messageId / rawContent / rawTerm
--   and NOTHING named lastSeenAt, meta or DailyStat.id.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ((table_name = 'AnalyticsSession' AND column_name IN ('lastSeenAt','rawContent','rawTerm','messageId'))
    OR (table_name = 'AnalyticsEvent'   AND column_name IN ('meta','label'))
    OR (table_name = 'DailyStat'        AND column_name = 'id'))
ORDER BY 1,2;

-- V2: the enum is narrowed, in the order schema.prisma declares, and the
-- scratch type is gone.
-- expected: exactly 2 rows -> EventType | PAGEVIEW      | 1
--                             EventType | SECTION_DWELL | 2
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('EventType','EventType_old')
ORDER BY t.typname, e.enumsortorder;

-- V3: the cast lost no row and left the column NOT NULL, still enum-typed,
-- still without a default.
-- expected: two rows summing to the G5 baseline, one PAGEVIEW one SECTION_DWELL
SELECT "type"::text AS value, count(*) AS rows FROM "AnalyticsEvent" GROUP BY 1 ORDER BY 1;
-- expected: 1 row -> type | EventType | NO | (null)
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"AnalyticsEvent"'::regclass AND a.attname = 'type';

-- V4: the rewrite rebuilt the surviving indexes and none is invalid.
-- expected: exactly 4 rows, all indisvalid = t ->
--   AnalyticsEvent_createdAt_idx, AnalyticsEvent_pkey,
--   AnalyticsEvent_sessionId_idx, AnalyticsEvent_type_createdAt_idx
SELECT i.indexrelid::regclass AS index_name, i.indisvalid
FROM pg_index i WHERE i.indrelid = '"AnalyticsEvent"'::regclass
ORDER BY 1;

-- V5: the final index inventory across the cluster, and the six drops are
-- all gone.
-- expected for the second query: 0 rows
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename IN ('AnalyticsSession','AnalyticsEvent','TrackedLink',
                    'DailyStat','RollupRun','LinkClick','JobLock')
ORDER BY 1,2;
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND indexname IN (
  'AnalyticsSession_channel_startedAt_idx','AnalyticsSession_visitorHash_startedAt_idx',
  'AnalyticsEvent_section_createdAt_idx','TrackedLink_channel_createdAt_idx',
  'TrackedLink_active_createdAt_idx','JobLock_expiresAt_idx',
  'DailyStat_date_idx','DailyStat_date_dimension_key_key')
ORDER BY 1;

-- V6: "UtmTracker" is unreachable under its old name and its rows are intact
-- under the new one.
-- expected: 0 | >= 1461
SELECT
  (SELECT count(*) FROM information_schema.tables
   WHERE table_schema = current_schema() AND table_name = 'UtmTracker') AS old_name_left,
  (SELECT count(*) FROM "UtmTracker__retired_v2")                        AS rows_preserved;

-- V7: no row was lost. Compare against G5.
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")   AS events,
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "DailyStat")        AS daily_stats,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs;

-- V8: the live proof. Hit the public site once, then confirm the collector
-- and the rollup both still work against the fully contracted schema:
--   SELECT max("startedAt") FROM "AnalyticsSession";      -- must move
--   SELECT max("createdAt") FROM "AnalyticsEvent";        -- must move
--   SELECT "date","status","rowsWritten","error" FROM "RollupRun"
--     ORDER BY "createdAt" DESC LIMIT 3;                  -- newest must be 'ok'
-- Then load the admin analytics dashboard and the tracker page. Then, from
-- the admin, run a manual "Resummarise" for yesterday: that exercises the
-- raw DailyStat upsert against the new compound primary key and the
-- id-less column list in one action, and it writes a RollupRun with
-- triggeredBy = 'manual', which also exercises the CHECK added in EXPAND.

-- V9: prove the CHECKs bite and the compound primary key rejects a duplicate.
-- All four of these MUST error. Everything rolls back.
--   BEGIN;
--     SAVEPOINT s; INSERT INTO "RollupRun" ("id","date","status","rowsWritten","durationMs","triggeredBy")
--       VALUES (gen_random_uuid()::text, CURRENT_DATE, 'OK', 0, 0, 'catch-up');
--       -- expect: violates RollupRun_status_check  (the case-mismatch the CHECK exists for)
--     ROLLBACK TO SAVEPOINT s;
--     SAVEPOINT s; INSERT INTO "RollupRun" ("id","date","status","rowsWritten","durationMs","triggeredBy")
--       VALUES (gen_random_uuid()::text, CURRENT_DATE, 'ok', 0, 0, 'cron');
--       -- expect: violates RollupRun_triggeredBy_check
--     ROLLBACK TO SAVEPOINT s;
--     SAVEPOINT s; UPDATE "AnalyticsSession" SET "channel" = 'LinkedIn';
--       -- expect: violates AnalyticsSession_channel_check
--     ROLLBACK TO SAVEPOINT s;
--     SAVEPOINT s; INSERT INTO "DailyStat" ("date","dimension","key")
--       SELECT "date","dimension","key" FROM "DailyStat" LIMIT 1;
--       -- expect: violates DailyStat_pkey
--     ROLLBACK TO SAVEPOINT s;
--   ROLLBACK;


-- =====================================================================
-- ROLLBACK OF CONTRACT. Restores the SHAPE. Read what it does not restore.
-- Only needed if v2 has to be reverted to v1.
-- =====================================================================
--   BEGIN;
--   -- UtmTracker: exact, because stage 3 renamed rather than dropped
--   ALTER TABLE IF EXISTS "UtmTracker__retired_v2" RENAME TO "UtmTracker";
--   -- EventType: widen. ALTER TYPE ... ADD VALUE may run in a transaction on
--   -- PG 12+, but the new label cannot be USED until commit, which is fine
--   -- here -- nothing writes it.
--   ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CLICK';
--   ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'RESUME_OPEN';
--   ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'OUTBOUND';
--   -- meta: lossless, it was non-null on zero rows
--   ALTER TABLE "AnalyticsEvent" ADD COLUMN IF NOT EXISTS "meta" JSONB;
--   -- DailyStat.id: fresh values. Nothing ever referenced the old ones, which
--   -- is why dropping them was safe. v1 needs the column NOT NULL and in the
--   -- INSERT list; the DEFAULT makes both shapes work again.
--   ALTER TABLE "DailyStat" ADD COLUMN IF NOT EXISTS "id" TEXT DEFAULT gen_random_uuid()::text;
--   UPDATE "DailyStat" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
--   ALTER TABLE "DailyStat" ALTER COLUMN "id" SET NOT NULL;
--   -- lastSeenAt: NOT recoverable. Every restored value reads
--   -- CURRENT_TIMESTAMP. It has no reader in v1 either, so this is cosmetic.
--   ALTER TABLE "AnalyticsSession"
--     ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
--   -- closest approximation, if it matters:
--   --   UPDATE "AnalyticsSession" s SET "lastSeenAt" = GREATEST(s."startedAt", x.m)
--   --   FROM (SELECT "sessionId", max("createdAt") m FROM "AnalyticsEvent" GROUP BY 1) x
--   --   WHERE x."sessionId" = s."id";
--   -- indexes v1 had
--   CREATE INDEX IF NOT EXISTS "AnalyticsSession_channel_startedAt_idx"     ON "AnalyticsSession" ("channel","startedAt");
--   CREATE INDEX IF NOT EXISTS "AnalyticsSession_visitorHash_startedAt_idx" ON "AnalyticsSession" ("visitorHash","startedAt");
--   CREATE INDEX IF NOT EXISTS "AnalyticsEvent_section_createdAt_idx"       ON "AnalyticsEvent" ("section","createdAt");
--   CREATE INDEX IF NOT EXISTS "TrackedLink_channel_createdAt_idx"          ON "TrackedLink" ("channel","createdAt");
--   CREATE INDEX IF NOT EXISTS "TrackedLink_active_createdAt_idx"           ON "TrackedLink" ("active","createdAt");
--   CREATE INDEX IF NOT EXISTS "JobLock_expiresAt_idx"                      ON "JobLock" ("expiresAt");
--   COMMIT;
--
-- Note the primary key is deliberately NOT swapped back here: v1 works fine
-- with the compound key as long as "id" exists and is defaulted (see the
-- EXPAND file, 1.4). If you want the v1 shape exactly, the expand file's
-- rollback block has those four statements -- but after this the "id" values
-- are freshly minted either way.
-- =====================================================================
