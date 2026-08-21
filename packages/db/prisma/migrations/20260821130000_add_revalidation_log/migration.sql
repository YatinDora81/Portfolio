-- Revalidation becomes a recorded transaction instead of a fire-and-forget
-- fetch. Purely additive — two new tables and two new enums, nothing existing is
-- touched — so it can be applied ahead of the code deploy and rolled back by
-- dropping them again.
--
-- What it replaces: apps/docs/app/lib/revalidate.ts caught every error and
-- returned nothing, so a wrong secret, an unreachable origin and a genuine
-- flush were indistinguishable. The site stayed stale and no surface anywhere
-- said so. Every one of those outcomes is now a row.

CREATE TYPE "RevalidationTrigger" AS ENUM (
  'MANUAL', 'CONTENT_SAVE', 'SCHEDULED_PUBLISH', 'FLAG_CHANGE', 'SYSTEM'
);

CREATE TYPE "RevalidationStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

CREATE TABLE "RevalidationLog" (
  "id"    TEXT NOT NULL,
  "paths" TEXT[],
  "tags"  TEXT[],

  "trigger"    "RevalidationTrigger" NOT NULL,
  "entityType" TEXT,
  "entityId"   TEXT,

  -- Plain TEXT, NOT a foreign key to "AdminUser". Admin accounts are
  -- hard-deleted, and a real FK would either block that delete or cascade away
  -- exactly the history this table exists to keep. Same call AuditEvent.actorId
  -- made, for the same reason.
  "actorId" TEXT,

  "status"     "RevalidationStatus" NOT NULL,
  "httpStatus" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "error"      TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RevalidationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevalidationLog_createdAt_idx" ON "RevalidationLog" ("createdAt");
CREATE INDEX "RevalidationLog_status_createdAt_idx" ON "RevalidationLog" ("status", "createdAt");
CREATE INDEX "RevalidationLog_entityType_entityId_idx" ON "RevalidationLog" ("entityType", "entityId");

-- The right-hand side of the staleness comparison: a content row whose
-- "updatedAt" is newer than its tag's "lastSuccessAt" was saved but never
-- reached the public app.
--
-- Keyed by tag rather than by entity so it covers the index tags ('blogs',
-- 'site-config') that belong to no single row.
CREATE TABLE "TagState" (
  "tag"              TEXT NOT NULL,
  "lastSuccessAt"    TIMESTAMP(3) NOT NULL,
  "lastAttemptAt"    TIMESTAMP(3) NOT NULL,
  "consecutiveFails" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "TagState_pkey" PRIMARY KEY ("tag")
);
