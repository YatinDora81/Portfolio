-- Turns ContactMessage from storage into a workspace: status, spam scoring,
-- reply history, and a Postgres rate-limit bucket. Additive — the existing
-- "read" column stays and keeps working — so it is safe ahead of the code
-- deploy and rolls back by dropping what it adds.
--
-- Before: 7 rows, all read = true. The backfill below must therefore produce
-- 7 READ and 0 UNREAD.

CREATE TYPE "MessageStatus" AS ENUM ('UNREAD', 'READ', 'REPLIED', 'ARCHIVED', 'SPAM');

ALTER TABLE "ContactMessage"
  ADD COLUMN "status"      "MessageStatus" NOT NULL DEFAULT 'UNREAD',
  ADD COLUMN "starred"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "spamScore"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "spamReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "country"     TEXT,
  ADD COLUMN "deviceType"  TEXT,
  ADD COLUMN "browser"     TEXT,
  ADD COLUMN "referrer"    TEXT,
  ADD COLUMN "notificationMessageId" TEXT,
  ADD COLUMN "readAt"      TIMESTAMP(3),
  ADD COLUMN "repliedAt"   TIMESTAMP(3),
  ADD COLUMN "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Carry the old boolean across. Guarded on the DEFAULT so a re-run cannot drag
-- an ARCHIVED or SPAM message back to READ.
UPDATE "ContactMessage"
SET "status" = CASE WHEN "read" = true THEN 'READ'::"MessageStatus"
                    ELSE 'UNREAD'::"MessageStatus" END
WHERE "status" = 'UNREAD' AND "read" = true;

-- An already-read message has a readAt of "we don't know"; createdAt is the only
-- honest stand-in and keeps it ordered sensibly.
UPDATE "ContactMessage" SET "readAt" = "createdAt" WHERE "status" = 'READ' AND "readAt" IS NULL;

CREATE INDEX "ContactMessage_status_createdAt_idx"  ON "ContactMessage" ("status", "createdAt");
CREATE INDEX "ContactMessage_starred_createdAt_idx" ON "ContactMessage" ("starred", "createdAt");
CREATE INDEX "ContactMessage_createdAt_idx"         ON "ContactMessage" ("createdAt");

CREATE TABLE "MessageReply" (
  "id"        TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "bodyHtml"  TEXT NOT NULL,
  "bodyText"  TEXT NOT NULL,
  "sentById"  TEXT,
  "sentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outboundMessageId" TEXT,
  "deliveryOk"    BOOLEAN NOT NULL DEFAULT false,
  "deliveryError" TEXT,
  CONSTRAINT "MessageReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageReply_messageId_sentAt_idx" ON "MessageReply" ("messageId", "sentAt");

ALTER TABLE "MessageReply"
  ADD CONSTRAINT "MessageReply_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReplyTemplate" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "bodyHtml"  TEXT NOT NULL,
  "useCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReplyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
  "key"      TEXT NOT NULL,
  "count"    INTEGER NOT NULL DEFAULT 0,
  "windowAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_windowAt_idx" ON "RateLimitBucket" ("windowAt");
