-- Tracked short links, pre-computed daily summaries, maintenance bookkeeping and
-- the media asset registry. Purely additive — six new tables — so it is safe
-- ahead of the code deploy and rolls back by dropping them.

CREATE TABLE "TrackedLink" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "channel"     TEXT NOT NULL,
  "campaign"    TEXT,
  "destination" TEXT NOT NULL,
  "notes"       TEXT,
  "clickCount"  INTEGER NOT NULL DEFAULT 0,
  "lastClickAt" TIMESTAMP(3),
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackedLink_slug_key" ON "TrackedLink" ("slug");
CREATE INDEX "TrackedLink_channel_createdAt_idx" ON "TrackedLink" ("channel", "createdAt");
CREATE INDEX "TrackedLink_active_createdAt_idx" ON "TrackedLink" ("active", "createdAt");

CREATE TABLE "LinkClick" (
  "id"           SERIAL NOT NULL,
  "linkId"       TEXT NOT NULL,
  "visitorHash"  TEXT,
  "country"      TEXT,
  "deviceType"   TEXT,
  "referrerHost" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkClick_linkId_createdAt_idx" ON "LinkClick" ("linkId", "createdAt");
CREATE INDEX "LinkClick_createdAt_idx" ON "LinkClick" ("createdAt");

ALTER TABLE "LinkClick"
  ADD CONSTRAINT "LinkClick_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyStat" (
  "id"            TEXT NOT NULL,
  "date"          DATE NOT NULL,
  "dimension"     TEXT NOT NULL,
  "key"           TEXT NOT NULL,
  "pageviews"     INTEGER NOT NULL DEFAULT 0,
  "uniques"       INTEGER NOT NULL DEFAULT 0,
  "sessions"      INTEGER NOT NULL DEFAULT 0,
  "avgDurationMs" INTEGER NOT NULL DEFAULT 0,
  "medianMs"      INTEGER NOT NULL DEFAULT 0,
  "reachedCount"  INTEGER NOT NULL DEFAULT 0,
  "computedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id")
);

-- The constraint the whole rollup design rests on: every write is an upsert
-- keyed on it, so running a day's aggregation ten times gives the same numbers
-- as running it once.
CREATE UNIQUE INDEX "DailyStat_date_dimension_key_key" ON "DailyStat" ("date", "dimension", "key");
CREATE INDEX "DailyStat_date_idx" ON "DailyStat" ("date");
CREATE INDEX "DailyStat_dimension_date_idx" ON "DailyStat" ("dimension", "date");

CREATE TABLE "RollupRun" (
  "id"          TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "status"      TEXT NOT NULL,
  "rowsWritten" INTEGER NOT NULL DEFAULT 0,
  "durationMs"  INTEGER NOT NULL DEFAULT 0,
  "error"       TEXT,
  "triggeredBy" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RollupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RollupRun_date_idx" ON "RollupRun" ("date");
CREATE INDEX "RollupRun_createdAt_idx" ON "RollupRun" ("createdAt");

CREATE TABLE "MaintenanceState" (
  "key"        TEXT NOT NULL,
  "lastRunAt"  TIMESTAMP(3) NOT NULL,
  "lastResult" TEXT,
  CONSTRAINT "MaintenanceState_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "MediaAsset" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "filename"    TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "bytes"       INTEGER NOT NULL,
  "width"       INTEGER,
  "height"      INTEGER,
  "blurDataUrl" TEXT,

  -- NOT NULL with no default on purpose. This is the alt-text layer that no
  -- seed script, bulk import or future code path can bypass.
  "altText" TEXT NOT NULL,
  "folder"  TEXT NOT NULL DEFAULT 'uploads',

  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset" ("key");
CREATE INDEX "MediaAsset_folder_createdAt_idx" ON "MediaAsset" ("folder", "createdAt");
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset" ("createdAt");
