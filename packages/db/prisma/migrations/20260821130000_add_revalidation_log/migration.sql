-- Revalidation becomes a recorded transaction instead of a fire-and-forget
-- fetch. Purely additive — two new tables and two new enums, nothing existing is
-- touched — so it can be applied ahead of the code deploy and rolled back by
-- dropping them again.

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

  -- Plain TEXT, not an FK: admin accounts are hard-deleted and the history stays.
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

CREATE TABLE "TagState" (
  "tag"              TEXT NOT NULL,
  "lastSuccessAt"    TIMESTAMP(3) NOT NULL,
  "lastAttemptAt"    TIMESTAMP(3) NOT NULL,
  "consecutiveFails" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "TagState_pkey" PRIMARY KEY ("tag")
);
