-- Add UTM tracker table for attribution analytics (additive-only, no data-destructive changes).
CREATE TABLE IF NOT EXISTS "UtmTracker" (
    "id" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "messageId" TEXT,
    "path" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UtmTracker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UtmTracker_content_idx" ON "UtmTracker"("content");
CREATE INDEX IF NOT EXISTS "UtmTracker_campaign_idx" ON "UtmTracker"("campaign");
CREATE INDEX IF NOT EXISTS "UtmTracker_messageId_idx" ON "UtmTracker"("messageId");
CREATE INDEX IF NOT EXISTS "UtmTracker_visitedAt_idx" ON "UtmTracker"("visitedAt");
