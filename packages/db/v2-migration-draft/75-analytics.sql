-- =====================================================================
-- cluster 75-analytics
-- target: the Neon child branch only. NOT production.
-- =====================================================================
--
-- WHAT THIS DOES
--
-- The analytics half of v2. Seven tables, in this order:
--
--   1. "AnalyticsSession"  gains "rawContent", "rawTerm", "messageId" (the
--                          three useful columns of "UtmTracker"), loses
--                          "lastSeenAt", loses two unread indexes, gains
--                          the outreach index, gains the channel CHECK.
--   2. "AnalyticsEvent"    loses "meta" and the [section, createdAt] index.
--                          "label" is KEPT. "EventType" is narrowed from
--                          five labels to two through the
--                          rename / create / cast / drop dance.
--   3. "TrackedLink"       gains the same channel CHECK, loses two unread
--                          indexes.
--   4. "DailyStat"         loses the surrogate "id" and the now-redundant
--                          unique, gains the natural compound primary key
--                          (date, dimension, key), gains the dimension
--                          CHECK, loses the standalone [date] index.
--   5. "RollupRun"         gains the "status" and "triggeredBy" CHECKs.
--   6. "UtmTracker"        is DROPPED. 1461 rows. See DATA LOSS.
--   7. "JobLock"           loses [expiresAt].
--
-- The order is deliberate in exactly one place: the three replacement
-- columns on "AnalyticsSession" are added in step 1, long before
-- "UtmTracker" is dropped in step 6, so there is no instant inside this
-- transaction where neither the old table nor its replacement columns
-- exist.
--
-- WHY EACH PIECE EXISTS (schema-v2.md, "AnalyticsSession" through "JobLock")
--
--   * "lastSeenAt": one writer, on the hottest public path
--     (apps/web/app/api/collect/route.ts:162), zero readers anywhere in the
--     repo. Confirmed by grep: that line is the only hit in the whole
--     monorepo.
--   * "meta": no reference anywhere in the repo, and non-null on ZERO rows
--     (/tmp/v2/data-facts.txt, "analytics slimming checks"). Dropping it
--     destroys no value, only a column.
--   * "label" is KEPT, reversing the audit draft. The collector DOES write
--     it (collect/route.ts:155) and the zod schema accepts it, so dropping
--     the column while that code ships fails every collect transaction
--     inside a catch that returns 204 -- total silent loss of analytics.
--     It waits for its own commit. This file does not touch it.
--   * "EventType" narrows to PAGEVIEW | SECTION_DWELL. CLICK, RESUME_OPEN
--     and OUTBOUND have never had an emitter. This enum IS the public
--     beacon contract (the collect route validates with z.nativeEnum), so
--     the migration asserts zero surviving rows carry a dropped label
--     before the cast -- the unauthenticated endpoint has accepted them for
--     a month.
--   * Five pseudo-enum string columns stay TEXT with a CHECK rather than
--     becoming Postgres enums, because a @map'd lowercase enum hands the
--     Prisma client the member NAME while the database keeps the LABEL:
--     the Channels panel would double every row, the rollup table would
--     render an amber badge reading "OK", and outreach links would go out
--     as ?utm_source=LINKEDIN. This is the convention the repo already
--     chose and wrote down (20260728120000/migration.sql:26-31).
--   * "DailyStat"'s natural triple was already UNIQUE and every write is an
--     upsert keyed on it, so the surrogate "id" was never identity, only
--     bytes. Prisma derives the same compound input name from @@id as from
--     @@unique, so findUnique({ where: { date_dimension_key: ... } }) needs
--     no edit.
--   * "JobLock"[expiresAt]: every access has the primary key in its WHERE,
--     and nothing scans or prunes by expiry.
--
-- REAL DATA THIS IS WRITTEN AGAINST (/tmp/v2/data-facts.txt)
--
--   AnalyticsEvent.type distinct          : PAGEVIEW, SECTION_DWELL
--   AnalyticsEvent rows                   : 752
--   AnalyticsEvent.label non-null         : 0
--   AnalyticsEvent.meta  non-null         : 0
--   AnalyticsSession.channel distinct     : direct, linkedin, other,
--                                           search, unknown-shared
--   DailyStat.dimension distinct          : channel, country, device, path,
--                                           referrer, section, total
--   DailyStat rows / distinct(d,dim,key)  : 414 / 414
--   RollupRun.status distinct             : ok
--   RollupRun.triggeredBy distinct        : catch-up
--   UtmTracker rows / with content        : 1461 / 455
--
-- Every one of those distinct sets already sits inside its new CHECK, so
-- none of the five CHECKs needs a USING CASE rewrite, and none is written.
-- These sets have been stable since they were introduced: a stray value
-- would be information, not noise, which is why each CHECK is preceded by
-- its own assertion instead of a coercion.
--
-- ONE FACT THIS FILE DOES NOT HAVE. /tmp/v2/data-facts.txt lists the
-- distinct values of AnalyticsSession.channel but NOT of
-- TrackedLink.channel. Nothing in the facts file proves the tracked-link
-- rows sit inside the eleven-label set. Preflight P4 is therefore a real
-- abort gate here rather than a formality, and gate G2 raises on it. The
-- risk is concrete: this column is operator-typed in the admin form and
-- feeds utm_source in the URL the operator copies into emails.
--
-- THE ELEVEN-LABEL CHANNEL SET is packages/shared/src/attribution.ts:1-13,
-- verbatim and in source order:
--   linkedin, github, x, leetcode, resume, email, search, direct,
--   unknown-referred, unknown-shared, other
-- THE SEVEN-LABEL DIMENSION SET is packages/db/src/rollup.ts:34-37 plus
-- the section and total writers:
--   channel, country, device, path, referrer, section, total
-- Two traps for whoever reads DailyStat next: the key of a 'total' row is
-- an em dash, not the word "total"; and 'unknown' / '(other)' are
-- synthesised keys, never values seen in a session. Neither affects the
-- dimension CHECK, which constrains the axis and not the key.
-- ROLLUP STATUS / TRIGGER sets are packages/db/src/rollup.ts:262-274
-- ("ok", "skipped", "error") and its two callers, rollup.ts:323
-- ("catch-up") and apps/docs/app/lib/actions/analytics.ts:81 ("manual").
--
-- DATA LOSS. Three things leave and one of them is real.
--
--   1. "UtmTracker", 1461 rows, of which 455 carry a non-null "content".
--      REAL AND IRREVERSIBLE from inside the database. It survives only in
--      the JSON dump taken today. There is no backfill into
--      "AnalyticsSession" and none is attempted: "UtmTracker" holds no
--      session identifier of any kind -- its columns are source, medium,
--      campaign, content, term, messageId, path, referrer, userAgent,
--      visitedAt -- so joining a tracker hit to the session that recorded
--      the same visit would mean inventing the link from a path and a
--      timestamp. schema-v2.md says so plainly: the outreach match "starts
--      from an empty history". Its "referrer" (full URL) and "userAgent"
--      (raw UA) have no new home at ALL, by design: that is the privacy
--      win, and also two columns the tracker screen can no longer fill.
--      Gate G7 refuses to run if the branch holds a row count other than
--      the 1461 the dump captured.
--   2. "AnalyticsSession"."lastSeenAt", one value per session. No column in
--      the new schema holds it. For any session that emitted at least one
--      event, max("AnalyticsEvent"."createdAt") over that session is a
--      close proxy -- but only until the 90-day event retention deletes
--      those rows. Accepted because the value has no reader today.
--   3. The enum labels CLICK, RESUME_OPEN and OUTBOUND. Zero rows carry
--      them (gate G6 proves it), so no row data is lost; what is lost is
--      the endpoint's willingness to ACCEPT them. After this, a batch
--      containing a CLICK stops being one ignored event and becomes a
--      rejected batch of up to 20.
--
--   "meta" is NOT in this list: non-null on zero rows, so the column drop
--   destroys a definition and no information. Same for "DailyStat"."id",
--   a gen_random_uuid() with no FK pointing at it (preflight P10) and no
--   reader in the repo (grep: every dailyStat call site selects date /
--   dimension / key / the measures, never id).
--
-- TRANSACTIONALITY
--
-- Every statement in this file is transactional. There is no CREATE INDEX
-- CONCURRENTLY, no ALTER TYPE ... ADD VALUE, no VACUUM, no DROP DATABASE.
-- Run the whole file inside the single BEGIN/COMMIT below. Nothing here
-- needs superuser: no session_replication_role, no DISABLE TRIGGER ALL, no
-- CREATE EXTENSION.
--
-- Two notes for whoever runs it:
--
--   * The file contains three dollar-quoted DO blocks ($gate$, $enum$,
--     $dailystat$). Feed it to psql, or to a splitter that understands
--     dollar quoting -- not to a naive split-on-semicolon.
--   * The five CHECKs are added NOT VALID and then validated in the same
--     transaction. On the branch that buys nothing: the locks accumulate
--     until COMMIT, so the two-step does NOT give the weaker-lock benefit
--     it would give across two production migrations. It is written this
--     way so the statement text is identical to what production will
--     eventually run, and because it leaves convalidated = t either way.
--
-- Re-running the DDL after a successful commit is a no-op. Every
-- destructive statement carries IF EXISTS, every ADD COLUMN and CREATE
-- INDEX carries IF NOT EXISTS, every ADD CONSTRAINT is preceded by a DROP
-- CONSTRAINT IF EXISTS of the same name (Postgres has no ADD CONSTRAINT IF
-- NOT EXISTS), the enum dance is skipped when the type already has exactly
-- two labels, and the DailyStat primary-key swap is skipped once "id" is
-- gone. Catalog lookups use to_regclass rather than a bare ::regclass cast,
-- which would ERROR rather than return NULL once "UtmTracker" is gone.
--
-- The exceptions are two preflights that read things this file removes: P1
-- counts "UtmTracker" (42P01 on a second run) and P8 counts
-- "AnalyticsEvent"."meta" (42703). Both are reads, and both sit before any
-- DDL, so a second run aborts with the database unchanged. Skip those two
-- on a re-run, or accept the error.
--
-- ROLLBACK
--
-- The branch is a copy-on-write clone, so the cheap and correct rollback is
-- to reset or delete the Neon branch and re-clone from production. Use
-- that. It is the only rollback that restores "UtmTracker".
--
-- A logical rollback restores the shape but NOT the tracker data:
--
--   BEGIN;
--   -- CHECKs
--   ALTER TABLE "AnalyticsSession" DROP CONSTRAINT IF EXISTS "AnalyticsSession_channel_check";
--   ALTER TABLE "TrackedLink"      DROP CONSTRAINT IF EXISTS "TrackedLink_channel_check";
--   ALTER TABLE "DailyStat"        DROP CONSTRAINT IF EXISTS "DailyStat_dimension_check";
--   ALTER TABLE "RollupRun"        DROP CONSTRAINT IF EXISTS "RollupRun_status_check";
--   ALTER TABLE "RollupRun"        DROP CONSTRAINT IF EXISTS "RollupRun_triggeredBy_check";
--   -- AnalyticsSession
--   DROP INDEX IF EXISTS "AnalyticsSession_rawContent_startedAt_idx";
--   CREATE INDEX IF NOT EXISTS "AnalyticsSession_channel_startedAt_idx"     ON "AnalyticsSession" ("channel", "startedAt");
--   CREATE INDEX IF NOT EXISTS "AnalyticsSession_visitorHash_startedAt_idx" ON "AnalyticsSession" ("visitorHash", "startedAt");
--   ALTER TABLE "AnalyticsSession"
--     ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     DROP COLUMN IF EXISTS "rawContent",
--     DROP COLUMN IF EXISTS "rawTerm",
--     DROP COLUMN IF EXISTS "messageId";
--   -- every restored "lastSeenAt" reads CURRENT_TIMESTAMP, not the real
--   -- last-seen time. The original values are gone. Closest recovery:
--   --   UPDATE "AnalyticsSession" s SET "lastSeenAt" = GREATEST(s."startedAt", x.m)
--   --   FROM (SELECT "sessionId", max("createdAt") m FROM "AnalyticsEvent" GROUP BY 1) x
--   --   WHERE x."sessionId" = s."id";
--   -- AnalyticsEvent + EventType
--   ALTER TABLE "AnalyticsEvent" ADD COLUMN IF NOT EXISTS "meta" JSONB;
--   CREATE INDEX IF NOT EXISTS "AnalyticsEvent_section_createdAt_idx" ON "AnalyticsEvent" ("section", "createdAt");
--   ALTER TYPE "EventType" RENAME TO "EventType_new";
--   CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'SECTION_DWELL', 'CLICK', 'RESUME_OPEN', 'OUTBOUND');
--   ALTER TABLE "AnalyticsEvent" ALTER COLUMN "type" TYPE "EventType" USING "type"::text::"EventType";
--   DROP TYPE "EventType_new";
--   -- TrackedLink
--   CREATE INDEX IF NOT EXISTS "TrackedLink_channel_createdAt_idx" ON "TrackedLink" ("channel", "createdAt");
--   CREATE INDEX IF NOT EXISTS "TrackedLink_active_createdAt_idx"  ON "TrackedLink" ("active", "createdAt");
--   -- DailyStat
--   ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_pkey";
--   ALTER TABLE "DailyStat" ADD COLUMN IF NOT EXISTS "id" TEXT;
--   UPDATE "DailyStat" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
--   ALTER TABLE "DailyStat" ALTER COLUMN "id" SET NOT NULL;
--   ALTER TABLE "DailyStat" ADD CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id");
--   CREATE UNIQUE INDEX IF NOT EXISTS "DailyStat_date_dimension_key_key" ON "DailyStat" ("date", "dimension", "key");
--   CREATE INDEX IF NOT EXISTS "DailyStat_date_idx" ON "DailyStat" ("date");
--   -- the restored "id" values are freshly minted. Nothing referenced the
--   -- old ones, which is why dropping them was safe in the first place.
--   -- JobLock
--   CREATE INDEX IF NOT EXISTS "JobLock_expiresAt_idx" ON "JobLock" ("expiresAt");
--   -- UtmTracker: shape only. Restore the rows from the JSON dump.
--   CREATE TABLE IF NOT EXISTS "UtmTracker" (
--     "id" TEXT NOT NULL, "source" TEXT, "medium" TEXT, "campaign" TEXT,
--     "content" TEXT, "term" TEXT, "messageId" TEXT, "path" TEXT,
--     "referrer" TEXT, "userAgent" TEXT,
--     "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT "UtmTracker_pkey" PRIMARY KEY ("id")
--   );
--   CREATE INDEX IF NOT EXISTS "UtmTracker_content_idx"   ON "UtmTracker"("content");
--   CREATE INDEX IF NOT EXISTS "UtmTracker_campaign_idx"  ON "UtmTracker"("campaign");
--   CREATE INDEX IF NOT EXISTS "UtmTracker_messageId_idx" ON "UtmTracker"("messageId");
--   CREATE INDEX IF NOT EXISTS "UtmTracker_visitedAt_idx" ON "UtmTracker"("visitedAt");
--   COMMIT;
--
-- CODE HALF (not this file's job, but this cluster breaks it)
--
-- Every one of these must ship in the same deploy as the migration:
--   apps/web/app/api/collect/route.ts:162      writes "lastSeenAt". Dropping
--     the column makes the update object literally {} for a dwell-only
--     batch, which is the normal case, so the write site needs
--     restructuring and not just a deleted line.
--   apps/web/app/api/collect/route.ts:23       z.nativeEnum(EventType) is
--     the public contract that narrows with the enum.
--   apps/web/app/api/track/utm/route.ts        the whole route goes.
--   apps/web/app/components/UtmTrackerBeacon.tsx + layout.tsx:12,:105
--   apps/docs/app/lib/utm.ts:57                reads "UtmTracker".
--   apps/docs/app/(dashboard)/tracker/page.tsx:42
--   apps/docs/app/(dashboard)/refer-emails/page.tsx:79
--   apps/docs/app/lib/actions/refer-emails.ts:38-40
--   apps/docs/app/lib/analytics-read.ts:258,:467  counts "UtmTracker".
--   packages/db/src/rollup.ts:217-230          the raw DailyStat upsert.
--     Both the tuple (gen_random_uuid()::text, ...) and the column list
--     ("id", "date", ...) must lose "id", or every rollup write fails with
--     42703 and a failed rollup silently freezes event retention.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PREFLIGHT. Reads only. Run them, read them, then let the DDL run.
-- Gates G1..G7 below re-assert the load-bearing ones and abort.
-- ---------------------------------------------------------------------

-- P1: the tables are the size the facts file says they are.
-- expected: 752 | 414 | 1461 | 455
-- AnalyticsSession, TrackedLink, RollupRun, LinkClick and JobLock counts
-- are NOT in /tmp/v2/data-facts.txt, so they are reported for the record
-- in P2 rather than asserted.
-- This is the only statement in the file that is not re-runnable: after the
-- migration "UtmTracker" is gone and this returns 42P01. See the header.
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")                             AS events,
  (SELECT count(*) FROM "DailyStat")                                  AS daily_stats,
  (SELECT count(*) FROM "UtmTracker")                                 AS utm_rows,
  (SELECT count(*) FROM "UtmTracker" WHERE "content" IS NOT NULL)     AS utm_with_content;

-- P2: baseline counts for the tables whose sizes the facts file does not
-- state. Write these down; verification V10 compares against them.
-- expected: informational. None of these tables loses a row in this file.
SELECT
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "TrackedLink")      AS tracked_links,
  (SELECT count(*) FROM "LinkClick")        AS link_clicks,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs,
  (SELECT count(*) FROM "JobLock")          AS job_locks;

-- P3: no "AnalyticsSession"."channel" outside the eleven-label set.
-- expected: 0 rows
SELECT "channel", count(*) AS rows
FROM "AnalyticsSession"
WHERE "channel" NOT IN (
  'linkedin','github','x','leetcode','resume','email','search','direct',
  'unknown-referred','unknown-shared','other')
GROUP BY 1 ORDER BY 1;

-- P4: no "TrackedLink"."channel" outside the same set. THIS ONE IS NOT
-- PRE-PROVEN. The facts file does not list this column's distinct values,
-- and the column is operator-typed in the admin form. If it returns rows,
-- stop and decide per value: a typo gets an UPDATE, a genuinely new channel
-- belongs in packages/shared/src/attribution.ts and in the CHECK first.
-- expected: 0 rows
SELECT "channel", count(*) AS rows
FROM "TrackedLink"
WHERE "channel" NOT IN (
  'linkedin','github','x','leetcode','resume','email','search','direct',
  'unknown-referred','unknown-shared','other')
GROUP BY 1 ORDER BY 1;

-- P5: no "DailyStat"."dimension" outside the seven-label set.
-- expected: 0 rows
SELECT "dimension", count(*) AS rows
FROM "DailyStat"
WHERE "dimension" NOT IN ('channel','country','device','path','referrer','section','total')
GROUP BY 1 ORDER BY 1;

-- P6: no "RollupRun"."status" or "triggeredBy" outside their sets.
-- expected: 0 rows
SELECT 'status' AS col, "status" AS value, count(*) AS rows
FROM "RollupRun" WHERE "status" NOT IN ('ok','skipped','error') GROUP BY 1,2
UNION ALL
SELECT 'triggeredBy', "triggeredBy", count(*)
FROM "RollupRun" WHERE "triggeredBy" NOT IN ('manual','catch-up') GROUP BY 1,2
ORDER BY 1,2;

-- P7: the zero-row assertion the enum narrowing rests on. The collect
-- endpoint is unauthenticated and has accepted CLICK, RESUME_OPEN and
-- OUTBOUND for a month, so this is checked against the branch and not
-- trusted from the facts file.
-- expected: 0 rows
SELECT "type"::text AS value, count(*) AS rows
FROM "AnalyticsEvent"
WHERE "type"::text NOT IN ('PAGEVIEW','SECTION_DWELL')
GROUP BY 1 ORDER BY 1;

-- P8: "meta" is non-null nowhere, so DROP COLUMN destroys no value. If this
-- ever returns more than 0, the JSON in those rows has nowhere to go in the
-- new schema and belongs in the data-loss note before the drop runs.
-- expected: 0
SELECT count(*) AS meta_non_null FROM "AnalyticsEvent" WHERE "meta" IS NOT NULL;

-- P9: the natural triple is already unique and fully populated, so it can
-- carry the primary key. A PRIMARY KEY also demands NOT NULL on all three;
-- all three are NOT NULL today, and the second query proves the data too.
-- expected: 414 | 414 | 0
SELECT count(*) AS rows,
       count(DISTINCT ("date", "dimension", "key")) AS distinct_triples,
       count(*) FILTER (
         WHERE "date" IS NULL OR "dimension" IS NULL OR "key" IS NULL
       ) AS null_in_key
FROM "DailyStat";

-- P10: nothing points a foreign key at "DailyStat"."id" or at
-- "UtmTracker", so dropping the column and the table drags nothing with it
-- and needs no CASCADE.
-- to_regclass, not ::regclass: the cast throws 42P01 on a missing table,
-- which would make this preflight fail on a second run instead of passing.
-- expected: 0 rows
SELECT c.conname, c.conrelid::regclass AS from_table, c.confrelid::regclass AS to_table
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid IN (to_regclass('"DailyStat"'), to_regclass('"UtmTracker"'));

-- P11: exactly one live column in the database uses "EventType", and it is
-- the one being cast. A second user would survive the RENAME and then block
-- the DROP TYPE.
-- expected: 1 row -> AnalyticsEvent | type
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
WHERE a.atttypid = '"EventType"'::regtype
  AND NOT a.attisdropped
  AND a.attnum > 0
ORDER BY 1, 2;

-- P12: no view or materialised view reads these tables. A view would block
-- both the column drops and the ALTER COLUMN TYPE.
-- expected: 0 rows
SELECT DISTINCT c.relname AS view_name, d.refobjid::regclass AS reads
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class c   ON c.oid = r.ev_class
WHERE d.refclassid = 'pg_class'::regclass
  AND c.relkind IN ('v','m')
  AND d.refobjid IN (
    to_regclass('"AnalyticsSession"'), to_regclass('"AnalyticsEvent"'),
    to_regclass('"TrackedLink"'), to_regclass('"DailyStat"'),
    to_regclass('"RollupRun"'), to_regclass('"UtmTracker"'),
    to_regclass('"JobLock"'))
ORDER BY 1, 2;

-- P13: every index this file drops exists under the name it expects. A
-- missing name here means drift, and the IF EXISTS would hide it.
-- expected: exactly 8 rows, in this order ->
--   AnalyticsEvent_section_createdAt_idx
--   AnalyticsSession_channel_startedAt_idx
--   AnalyticsSession_visitorHash_startedAt_idx
--   DailyStat_date_dimension_key_key
--   DailyStat_date_idx
--   JobLock_expiresAt_idx
--   TrackedLink_active_createdAt_idx
--   TrackedLink_channel_createdAt_idx
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN (
    'AnalyticsEvent_section_createdAt_idx',
    'AnalyticsSession_channel_startedAt_idx',
    'AnalyticsSession_visitorHash_startedAt_idx',
    'DailyStat_date_dimension_key_key',
    'DailyStat_date_idx',
    'JobLock_expiresAt_idx',
    'TrackedLink_active_createdAt_idx',
    'TrackedLink_channel_createdAt_idx')
ORDER BY indexname;

-- P14: "DailyStat"'s primary key is still the surrogate, and the unique on
-- the triple is a bare index rather than a constraint (the original
-- migration used CREATE UNIQUE INDEX). That is why the swap below uses
-- DROP CONSTRAINT for the pkey and DROP INDEX for the unique.
-- expected: 1 row -> DailyStat_pkey | p | PRIMARY KEY (id)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = '"DailyStat"'::regclass
ORDER BY conname;

-- P15: none of the five CHECKs and neither new object exists yet, so this
-- is a first run. All five names free and one index name free.
-- expected: 0 rows
SELECT conname FROM pg_constraint
WHERE conname IN (
  'AnalyticsSession_channel_check','TrackedLink_channel_check',
  'DailyStat_dimension_check','RollupRun_status_check',
  'RollupRun_triggeredBy_check')
UNION ALL
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname = 'AnalyticsSession_rawContent_startedAt_idx'
ORDER BY 1;

-- ---------------------------------------------------------------------
-- GATES. The preflight is for a human; this block is for the file. It
-- aborts the transaction before a single destructive statement runs.
-- No plpgsql variable is named after a column, so every bare identifier
-- below resolves as a column.
-- ---------------------------------------------------------------------
DO $gate$
DECLARE
  n_session_channel bigint;
  n_link_channel    bigint;
  n_dimension       bigint;
  n_status          bigint;
  n_trigger         bigint;
  n_event_type      bigint;
  n_dup_triple      bigint;
  n_utm             bigint;
  n_enum_users      bigint;
BEGIN
  -- G1: AnalyticsSession.channel inside the eleven-label set.
  SELECT count(*) INTO n_session_channel FROM "AnalyticsSession"
  WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                          'search','direct','unknown-referred','unknown-shared','other');
  IF n_session_channel > 0 THEN
    RAISE EXCEPTION
      '75-analytics G1: % AnalyticsSession row(s) hold a channel outside the eleven-label set. Run preflight P3 to see them. Fix the values or widen packages/shared/src/attribution.ts AND this CHECK together.',
      n_session_channel;
  END IF;

  -- G2: TrackedLink.channel likewise. This is the gate that is NOT
  -- pre-proven by /tmp/v2/data-facts.txt.
  SELECT count(*) INTO n_link_channel FROM "TrackedLink"
  WHERE "channel" NOT IN ('linkedin','github','x','leetcode','resume','email',
                          'search','direct','unknown-referred','unknown-shared','other');
  IF n_link_channel > 0 THEN
    RAISE EXCEPTION
      '75-analytics G2: % TrackedLink row(s) hold a channel outside the eleven-label set. Run preflight P4 to see them. These values are operator-typed and feed utm_source in already-sent links, so do not rewrite one without reading it.',
      n_link_channel;
  END IF;

  -- G3: DailyStat.dimension inside the seven-label set.
  SELECT count(*) INTO n_dimension FROM "DailyStat"
  WHERE "dimension" NOT IN ('channel','country','device','path','referrer','section','total');
  IF n_dimension > 0 THEN
    RAISE EXCEPTION
      '75-analytics G3: % DailyStat row(s) hold a dimension outside the seven-label set. Run preflight P5.',
      n_dimension;
  END IF;

  -- G4 / G5: RollupRun value sets.
  SELECT count(*) INTO n_status FROM "RollupRun" WHERE "status" NOT IN ('ok','skipped','error');
  IF n_status > 0 THEN
    RAISE EXCEPTION '75-analytics G4: % RollupRun row(s) hold a status outside ok/skipped/error.', n_status;
  END IF;
  SELECT count(*) INTO n_trigger FROM "RollupRun" WHERE "triggeredBy" NOT IN ('manual','catch-up');
  IF n_trigger > 0 THEN
    RAISE EXCEPTION '75-analytics G5: % RollupRun row(s) hold a triggeredBy outside manual/catch-up.', n_trigger;
  END IF;

  -- G6: the zero-row assertion for the enum narrowing. A surviving CLICK,
  -- RESUME_OPEN or OUTBOUND row has nowhere to go in the two-label enum,
  -- and the cast below would fail anyway -- with a worse message.
  SELECT count(*) INTO n_event_type FROM "AnalyticsEvent"
  WHERE "type"::text NOT IN ('PAGEVIEW','SECTION_DWELL');
  IF n_event_type > 0 THEN
    RAISE EXCEPTION
      '75-analytics G6: % AnalyticsEvent row(s) carry a dropped EventType label. The unauthenticated collect endpoint accepted them. Decide per row (delete, or remap to PAGEVIEW) before narrowing the enum.',
      n_event_type;
  END IF;

  -- G6b: exactly one live column uses "EventType". A second one would
  -- survive the RENAME still typed EventType_old and block the DROP TYPE.
  SELECT count(*) INTO n_enum_users
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  WHERE a.atttypid = '"EventType"'::regtype AND NOT a.attisdropped AND a.attnum > 0;
  IF n_enum_users <> 1 THEN
    RAISE EXCEPTION
      '75-analytics G6b: expected exactly 1 column typed "EventType", found %. Run preflight P11.',
      n_enum_users;
  END IF;

  -- G6c: the natural triple can carry a primary key.
  SELECT count(*) INTO n_dup_triple FROM (
    SELECT 1 FROM "DailyStat" GROUP BY "date", "dimension", "key" HAVING count(*) > 1
  ) d;
  IF n_dup_triple > 0 THEN
    RAISE EXCEPTION
      '75-analytics G6c: % duplicate (date, dimension, key) group(s) in DailyStat. The existing unique index should make this impossible; investigate before touching the primary key.',
      n_dup_triple;
  END IF;

  -- G7: the only irreversible statement in this file. "UtmTracker" survives
  -- nowhere but the JSON dump taken today, which captured 1461 rows. A
  -- different count means the branch and the dump disagree and the excess
  -- rows would be destroyed with no copy anywhere.
  --
  -- If this fires and you have decided the excess is worth losing, say so
  -- deliberately: comment out this one IF, and move the number into the
  -- data-loss note. Do not "fix" it by re-running with the gate removed
  -- and no note.
  -- EXECUTE rather than a static SELECT so the statement is never even
  -- parsed on a re-run, when the table no longer exists.
  IF to_regclass('"UtmTracker"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "UtmTracker"' INTO n_utm;
    IF n_utm <> 1461 THEN
      RAISE EXCEPTION
        '75-analytics G7: UtmTracker holds % rows, the dump captured 1461. DROP TABLE would destroy the difference with no copy anywhere. Re-take the dump, or accept the loss explicitly.',
        n_utm;
    END IF;
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------
-- 1. "AnalyticsSession"
--
-- The three new columns absorb "UtmTracker". All nullable, no default and
-- no backfill: attribution is written once at session create, so every
-- existing 30-minute session record legitimately holds no rawContent at
-- all, and NULL is the honest value. NOT the same thing as "we lost it".
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsSession"
  ADD COLUMN IF NOT EXISTS "rawContent" TEXT,
  ADD COLUMN IF NOT EXISTS "rawTerm"    TEXT,
  ADD COLUMN IF NOT EXISTS "messageId"  TEXT;

-- One writer (collect/route.ts:162), zero readers. Gone.
ALTER TABLE "AnalyticsSession" DROP COLUMN IF EXISTS "lastSeenAt";

-- Two indexes nothing reads. The channel dashboard reads "DailyStat", not
-- sessions; the visitor-hash composite served no query that survived.
DROP INDEX IF EXISTS "AnalyticsSession_channel_startedAt_idx";
DROP INDEX IF EXISTS "AnalyticsSession_visitorHash_startedAt_idx";

-- The index the inherited outreach read needs: "has this recipient visited",
-- windowed. A composite and not a partial WHERE "rawContent" IS NOT NULL,
-- because Prisma cannot declare a partial index and a raw-SQL-only one is
-- exactly what `db push` silently drops. Name matches @@index([rawContent,
-- startedAt]).
CREATE INDEX IF NOT EXISTS "AnalyticsSession_rawContent_startedAt_idx"
  ON "AnalyticsSession" ("rawContent", "startedAt");

-- "AnalyticsSession_startedAt_idx" is kept as-is: retention prunes by it.

-- Channel stays TEXT with a CHECK. Set is attribution.ts:1-13 verbatim.
-- The DROP first is the idempotency guard: Postgres has no ADD CONSTRAINT IF
-- NOT EXISTS. On a first run it is a no-op with a NOTICE (P15 proves the
-- name is free); on a re-run it replaces the constraint with an identical
-- one inside this same transaction.
ALTER TABLE "AnalyticsSession" DROP CONSTRAINT IF EXISTS "AnalyticsSession_channel_check";
ALTER TABLE "AnalyticsSession"
  ADD CONSTRAINT "AnalyticsSession_channel_check"
  CHECK ("channel" IN (
    'linkedin','github','x','leetcode','resume','email','search','direct',
    'unknown-referred','unknown-shared','other')) NOT VALID;
ALTER TABLE "AnalyticsSession" VALIDATE CONSTRAINT "AnalyticsSession_channel_check";

-- ---------------------------------------------------------------------
-- 2. "AnalyticsEvent" and "EventType"
--
-- "label" is deliberately untouched. Dropping it needs the three code
-- sites deleted first; see the header.
--
-- The column drop and the index drop come BEFORE the enum cast on purpose:
-- ALTER COLUMN TYPE rewrites the table and rebuilds every index on it, so
-- there is no point rebuilding one that is about to be dropped.
-- ---------------------------------------------------------------------
ALTER TABLE "AnalyticsEvent" DROP COLUMN IF EXISTS "meta";

-- Both section reads are "createdAt" ranges.
DROP INDEX IF EXISTS "AnalyticsEvent_section_createdAt_idx";

-- The rename / create / cast / drop dance. Postgres cannot remove a label
-- from an existing enum, so the type is replaced rather than altered.
--
-- Guarded so a second run is a no-op instead of an error. The guard tests
-- the labels, not the existence of the type: after a successful run
-- "EventType" still exists, it just has two labels.
--
-- Safe in one transaction because the type is CREATEd here, in this same
-- transaction. The "new enum values are not usable until commit" rule
-- applies to ALTER TYPE ... ADD VALUE on a pre-existing type, which this is
-- not, so the USING cast below can name the labels immediately.
--
-- The column has no DEFAULT (schema.prisma declares `type EventType` bare),
-- so there is no default to drop and re-add around the cast. NOT NULL,
-- "AnalyticsEvent_type_createdAt_idx" and the SERIAL identity all survive
-- ALTER COLUMN TYPE untouched.
DO $enum$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventType_old') THEN
    RAISE EXCEPTION
      '75-analytics: type "EventType_old" already exists. A previous run was interrupted outside a transaction. Inspect it and drop it by hand before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'EventType'
      AND e.enumlabel NOT IN ('PAGEVIEW','SECTION_DWELL')
  ) THEN
    ALTER TYPE "EventType" RENAME TO "EventType_old";

    CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'SECTION_DWELL');

    ALTER TABLE "AnalyticsEvent"
      ALTER COLUMN "type" TYPE "EventType" USING "type"::text::"EventType";

    -- Succeeds only once nothing references it, which is the point: if this
    -- errors, the message names the straggler. Do NOT reach for CASCADE --
    -- on a type, CASCADE drops the dependent COLUMNS.
    DROP TYPE "EventType_old";
  END IF;
END
$enum$;

-- ---------------------------------------------------------------------
-- 3. "TrackedLink"
--
-- Same channel set as the session table, and for a sharper reason: this
-- column is interpolated into utm_source in the URL the operator copies
-- into an email, so a bad value escapes into artifacts that cannot be
-- recalled.
--
-- NOTE, deliberately not done here: the new schema also wants
-- "TrackedLink_createdById_fkey" (SetNull to "AdminUser") and
-- "TrackedLink_createdById_idx". Neither exists today and neither is in
-- this cluster's brief -- they belong with the rest of the AdminUser
-- foreign keys. Until that cluster runs, `prisma migrate diff` against the
-- schema will report exactly those two objects for this table.
-- ---------------------------------------------------------------------
-- Two unused indexes: the admin list page loads every row and filters in
-- JavaScript.
DROP INDEX IF EXISTS "TrackedLink_channel_createdAt_idx";
DROP INDEX IF EXISTS "TrackedLink_active_createdAt_idx";

ALTER TABLE "TrackedLink" DROP CONSTRAINT IF EXISTS "TrackedLink_channel_check";
ALTER TABLE "TrackedLink"
  ADD CONSTRAINT "TrackedLink_channel_check"
  CHECK ("channel" IN (
    'linkedin','github','x','leetcode','resume','email','search','direct',
    'unknown-referred','unknown-shared','other')) NOT VALID;
ALTER TABLE "TrackedLink" VALIDATE CONSTRAINT "TrackedLink_channel_check";

-- ---------------------------------------------------------------------
-- 4. "DailyStat": the natural key becomes the primary key.
--
-- Guarded on "id" still being present, so a second run skips the whole
-- swap rather than dropping and rebuilding the new primary key.
--
-- Order inside the block matters. DROP CONSTRAINT before DROP COLUMN so the
-- pkey goes by name rather than as a side effect (P10 proved nothing
-- references it, so no CASCADE is needed either way). ADD PRIMARY KEY last,
-- reusing the name "DailyStat_pkey" that @@id([date, dimension, key])
-- derives. All three columns are already NOT NULL, which PRIMARY KEY
-- requires.
--
-- The redundant unique goes by DROP INDEX, not DROP CONSTRAINT, because
-- 20260822130000 created it with CREATE UNIQUE INDEX (see P14). The
-- DROP CONSTRAINT IF EXISTS first is belt and braces: if it ever WERE a
-- constraint, DROP INDEX alone would fail with "cannot drop index ...
-- because constraint ... requires it".
--
-- The ON CONFLICT ("date","dimension","key") in rollup.ts keeps working
-- across the swap: it resolves against whichever unique index covers those
-- columns, and the new primary key's index does.
-- ---------------------------------------------------------------------
DO $dailystat$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'DailyStat' AND column_name = 'id'
  ) THEN
    ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_pkey";
    ALTER TABLE "DailyStat" DROP COLUMN IF EXISTS "id";

    ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_date_dimension_key_key";
    DROP INDEX IF EXISTS "DailyStat_date_dimension_key_key";

    -- Every reader filters on "dimension" or on both columns; the
    -- date-only index was never chosen.
    DROP INDEX IF EXISTS "DailyStat_date_idx";

    ALTER TABLE "DailyStat"
      ADD CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("date", "dimension", "key");
  END IF;
END
$dailystat$;

-- "DailyStat_dimension_date_idx" is kept as-is: it serves the dashboard's
-- windowed reads.

ALTER TABLE "DailyStat" DROP CONSTRAINT IF EXISTS "DailyStat_dimension_check";
ALTER TABLE "DailyStat"
  ADD CONSTRAINT "DailyStat_dimension_check"
  CHECK ("dimension" IN ('channel','country','device','path','referrer','section','total')) NOT VALID;
ALTER TABLE "DailyStat" VALIDATE CONSTRAINT "DailyStat_dimension_check";

-- ---------------------------------------------------------------------
-- 5. "RollupRun": two value-set CHECKs.
--
-- Sets come from the writer, not from the data: the branch has only 'ok'
-- and 'catch-up' today, but rollup.ts:262-274 emits all three statuses and
-- actions/analytics.ts:81 emits 'manual'. A CHECK narrowed to what happens
-- to be present would reject the first skipped run and the first manual
-- one.
--
-- Both indexes stay. [date] is kept even though no reader uses it, which is
-- inconsistent with dropping JobLock[expiresAt] for that same reason;
-- schema-v2.md keeps it on purpose so the inconsistency stays visible, and
-- the schema is the destination here.
-- ---------------------------------------------------------------------
ALTER TABLE "RollupRun" DROP CONSTRAINT IF EXISTS "RollupRun_status_check";
ALTER TABLE "RollupRun"
  ADD CONSTRAINT "RollupRun_status_check"
  CHECK ("status" IN ('ok','skipped','error')) NOT VALID;
ALTER TABLE "RollupRun" VALIDATE CONSTRAINT "RollupRun_status_check";

ALTER TABLE "RollupRun" DROP CONSTRAINT IF EXISTS "RollupRun_triggeredBy_check";
ALTER TABLE "RollupRun"
  ADD CONSTRAINT "RollupRun_triggeredBy_check"
  CHECK ("triggeredBy" IN ('manual','catch-up')) NOT VALID;
ALTER TABLE "RollupRun" VALIDATE CONSTRAINT "RollupRun_triggeredBy_check";

-- ---------------------------------------------------------------------
-- 6. "UtmTracker" goes.
--
-- The one irreversible statement in this file. 1461 rows, 455 of them with
-- a non-null "content". Gate G7 above refuses to run unless the count
-- matches the dump. No CASCADE: P10 proved nothing references it, so a
-- plain DROP TABLE is enough and an unqualified CASCADE would hide a
-- reference if one appeared.
--
-- Its four indexes (content, campaign, messageId, visitedAt) go with it.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS "UtmTracker";

-- ---------------------------------------------------------------------
-- 7. "JobLock": drop the expiry index.
--
-- Every access has the primary key in its WHERE (acquireLock inserts and
-- catches the conflict; release deletes by key), and nothing scans or
-- prunes by expiry. Note nothing prunes this table at all, so an abandoned
-- lock row survives until that same key is rolled again -- unchanged by
-- this file, and not a problem the index was solving.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS "JobLock_expiresAt_idx";

-- =====================================================================
-- VERIFICATION. Run these before COMMIT; every one is a read.
-- =====================================================================

-- V1: the three new columns exist, are TEXT and are nullable; "lastSeenAt"
-- is gone.
-- expected: exactly 3 rows ->
--   messageId  | text | YES
--   rawContent | text | YES
--   rawTerm    | text | YES
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'AnalyticsSession'
  AND column_name IN ('rawContent','rawTerm','messageId','lastSeenAt')
ORDER BY column_name;

-- V2: "AnalyticsSession" index inventory matches the new schema exactly
-- (@@index([startedAt]), @@index([rawContent, startedAt]), @unique on
-- sessionHash, and the primary key). Nothing on [messageId] -- the brief
-- says not to add one, so an extra row here is drift.
-- expected: exactly 4 rows ->
--   AnalyticsSession_pkey
--   AnalyticsSession_rawContent_startedAt_idx
--   AnalyticsSession_sessionHash_key
--   AnalyticsSession_startedAt_idx
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'AnalyticsSession'
ORDER BY indexname;

-- V3: "AnalyticsEvent" keeps "label", has no "meta".
-- expected: 1 row -> label | text | YES
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'AnalyticsEvent'
  AND column_name IN ('label','meta')
ORDER BY column_name;

-- V4: "AnalyticsEvent" index inventory matches @@index([createdAt]),
-- @@index([type, createdAt]) and @@index([sessionId]) plus the pkey. The
-- [section, createdAt] index is gone, and the type index survived the
-- column rewrite.
-- expected: exactly 4 rows ->
--   AnalyticsEvent_createdAt_idx
--   AnalyticsEvent_pkey
--   AnalyticsEvent_sessionId_idx
--   AnalyticsEvent_type_createdAt_idx
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'AnalyticsEvent'
ORDER BY indexname;

-- V5: the enum is narrowed, in the order the schema declares, and the
-- scratch type is gone.
-- expected: exactly 2 rows -> EventType | PAGEVIEW | 1
--                             EventType | SECTION_DWELL | 2
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('EventType','EventType_old')
ORDER BY t.typname, e.enumsortorder;

-- V6: no event row was lost or re-typed by the cast, and the column is
-- still NOT NULL and still typed by the enum.
-- expected: two rows summing to 752, one PAGEVIEW and one SECTION_DWELL.
-- The split is not in the facts file, so only the total is pinned.
SELECT "type"::text AS value, count(*) AS rows
FROM "AnalyticsEvent" GROUP BY 1 ORDER BY 1;

-- expected: 1 row -> type | EventType | NO | (null)
SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = '"AnalyticsEvent"'::regclass AND a.attname = 'type';

-- V7: "TrackedLink" index inventory. Two rows only. The absent
-- "TrackedLink_createdById_idx" is the other cluster's job, as flagged
-- above -- it is expected to be missing here and expected to exist before
-- the branch is called done.
-- expected: exactly 2 rows -> TrackedLink_pkey, TrackedLink_slug_key
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'TrackedLink'
ORDER BY indexname;

-- V8: "DailyStat" is keyed on the natural triple, "id" is gone, and the two
-- retired indexes are gone.
-- expected: 1 row -> DailyStat_pkey | p | PRIMARY KEY ("date", dimension, key)
-- (Postgres re-spells the definition: "date" stays quoted because it is a
-- reserved word, the other two come back bare. Match the semantics.)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = '"DailyStat"'::regclass AND contype = 'p';

-- expected: 0
SELECT count(*) AS id_column_left
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'DailyStat'
  AND column_name = 'id';

-- expected: exactly 2 rows -> DailyStat_dimension_date_idx, DailyStat_pkey
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'DailyStat'
ORDER BY indexname;

-- V9: every row survived the primary-key swap, and the triple is still
-- unique -- now by the primary key rather than by a separate index.
-- expected: 414 | 414
SELECT count(*) AS rows, count(DISTINCT ("date","dimension","key")) AS distinct_triples
FROM "DailyStat";

-- V10: nothing else lost a row. Compare against P1 and P2.
-- expected: 752 events, and sessions / tracked_links / link_clicks /
-- rollup_runs / job_locks identical to the P2 baseline.
SELECT
  (SELECT count(*) FROM "AnalyticsEvent")   AS events,
  (SELECT count(*) FROM "AnalyticsSession") AS sessions,
  (SELECT count(*) FROM "TrackedLink")      AS tracked_links,
  (SELECT count(*) FROM "LinkClick")        AS link_clicks,
  (SELECT count(*) FROM "RollupRun")        AS rollup_runs,
  (SELECT count(*) FROM "JobLock")          AS job_locks;

-- V11: all five CHECKs exist under their expected names and every one is
-- validated. convalidated = f on any row means the VALIDATE did not run.
-- expected: exactly 5 rows ->
--   AnalyticsSession_channel_check | ... | t
--   DailyStat_dimension_check      | ... | t
--   RollupRun_status_check         | ... | t
--   RollupRun_triggeredBy_check    | ... | t
--   TrackedLink_channel_check      | ... | t
-- Postgres normalises the bodies (an IN list of 11 literals comes back as
-- `= ANY (ARRAY[...])` with ::text casts), so match on the names and the
-- member sets, not on the exact string.
SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition, convalidated
FROM pg_constraint
WHERE conname IN (
  'AnalyticsSession_channel_check','TrackedLink_channel_check',
  'DailyStat_dimension_check','RollupRun_status_check',
  'RollupRun_triggeredBy_check')
ORDER BY conname;

-- V12: "UtmTracker" is gone, table and indexes.
-- expected: 0 | 0
SELECT
  (SELECT count(*) FROM information_schema.tables
   WHERE table_schema = current_schema() AND table_name = 'UtmTracker') AS table_left,
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = current_schema() AND tablename = 'UtmTracker')    AS indexes_left;

-- V13: "JobLock" keeps only its primary key.
-- expected: 1 row -> JobLock_pkey
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'JobLock'
ORDER BY indexname;

-- V14: every index this file dropped is actually gone. Catches a typo in a
-- DROP INDEX IF EXISTS, which otherwise passes in silence.
-- expected: 0 rows
SELECT indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN (
    'AnalyticsEvent_section_createdAt_idx',
    'AnalyticsSession_channel_startedAt_idx',
    'AnalyticsSession_visitorHash_startedAt_idx',
    'DailyStat_date_dimension_key_key',
    'DailyStat_date_idx',
    'JobLock_expiresAt_idx',
    'TrackedLink_active_createdAt_idx',
    'TrackedLink_channel_createdAt_idx')
ORDER BY indexname;

-- V15: the CHECKs actually bite, and the new primary key rejects a
-- duplicate triple. All four of these must ERROR. Run them in a throwaway
-- SAVEPOINT, or skip them -- they are writes, unlike everything else here,
-- and the third one touches a real row.
--
--   SAVEPOINT chk;
--     INSERT INTO "RollupRun" ("id","date","status","rowsWritten","durationMs","triggeredBy")
--     VALUES (gen_random_uuid()::text, CURRENT_DATE, 'OK', 0, 0, 'catch-up');
--                                    -- expect: violates RollupRun_status_check
--   ROLLBACK TO SAVEPOINT chk;
--   SAVEPOINT chk;
--     INSERT INTO "RollupRun" ("id","date","status","rowsWritten","durationMs","triggeredBy")
--     VALUES (gen_random_uuid()::text, CURRENT_DATE, 'ok', 0, 0, 'cron');
--                                    -- expect: violates RollupRun_triggeredBy_check
--   ROLLBACK TO SAVEPOINT chk;
--   SAVEPOINT chk;
--     UPDATE "AnalyticsSession" SET "channel" = 'LinkedIn';
--                                    -- expect: violates AnalyticsSession_channel_check
--                                    -- (this is the case-mismatch the CHECK exists for)
--   ROLLBACK TO SAVEPOINT chk;
--   SAVEPOINT chk;
--     INSERT INTO "DailyStat" ("date","dimension","key")
--     SELECT "date","dimension","key" FROM "DailyStat" LIMIT 1;
--                                    -- expect: violates DailyStat_pkey
--   ROLLBACK TO SAVEPOINT chk;

COMMIT;
