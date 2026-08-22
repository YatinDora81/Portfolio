-- Cookieless analytics with session-level attribution. Purely additive — three
-- new tables and one enum — so it is safe ahead of the code deploy and rolls
-- back by dropping them.
--
-- The salt table is the privacy mechanism: IP and user-agent are hashed with a
-- salt that rotates daily and is then deleted, so yesterday's hashes cannot be
-- linked to today's even by us. Neither the IP nor the raw UA is ever stored.

CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'SECTION_DWELL', 'CLICK', 'RESUME_OPEN', 'OUTBOUND');

CREATE TABLE "AnalyticsSalt" (
  "dateKey"   TEXT NOT NULL,
  "salt"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSalt_pkey" PRIMARY KEY ("dateKey")
);

CREATE TABLE "AnalyticsSession" (
  "id"          TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "visitorHash" TEXT NOT NULL,

  -- Written once, on creation. An UPDATE here is the bug this table is shaped to
  -- prevent: re-resolving attribution on a later event lets an internal click
  -- overwrite the source the visitor actually arrived from.
  "channel"      TEXT NOT NULL,
  "rawSource"    TEXT,
  "rawMedium"    TEXT,
  "rawCampaign"  TEXT,
  "referrerHost" TEXT,
  "landingPath"  TEXT NOT NULL,
  "linkSlug"     TEXT,

  "country"    TEXT,
  "region"     TEXT,
  "city"       TEXT,
  "deviceType" TEXT,
  "browser"    TEXT,
  "os"         TEXT,

  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pageviews"  INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsSession_sessionHash_key" ON "AnalyticsSession" ("sessionHash");
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession" ("startedAt");
CREATE INDEX "AnalyticsSession_channel_startedAt_idx" ON "AnalyticsSession" ("channel", "startedAt");
CREATE INDEX "AnalyticsSession_visitorHash_startedAt_idx" ON "AnalyticsSession" ("visitorHash", "startedAt");

-- INTEGER, not BIGINT: BigInt does not serialise to JSON without extra work, and
-- 90-day retention keeps this table small enough that the range is never reached.
CREATE TABLE "AnalyticsEvent" (
  "id"        SERIAL NOT NULL,
  "sessionId" TEXT NOT NULL,

  "type"       "EventType" NOT NULL,
  "path"       TEXT NOT NULL,
  "section"    TEXT,
  "label"      TEXT,
  "durationMs" INTEGER,
  "meta"       JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent" ("createdAt");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent" ("type", "createdAt");
CREATE INDEX "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent" ("sessionId");
CREATE INDEX "AnalyticsEvent_section_createdAt_idx" ON "AnalyticsEvent" ("section", "createdAt");

ALTER TABLE "AnalyticsEvent"
  ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
