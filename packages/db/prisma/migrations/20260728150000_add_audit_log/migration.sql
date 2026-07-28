-- Change history for the admin: who changed what, and the exact text before and
-- after. Purely additive — nothing existing is altered, so this can be applied
-- ahead of the code deploy and rolled back by dropping two tables.
--
-- Shape: one AuditEvent per user GESTURE (a Save, a Save & Publish, a bare
-- Publish), owning N AuditChange rows that each carry one field's before/after.
-- Grouping by gesture rather than by row is what lets one entry honestly read
-- "saved, publish failed" — publishing is a network call that happens after the
-- save transaction closes and is allowed to fail without rolling it back.

CREATE TABLE "AuditEvent" (
  "id"        TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "surface"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Denormalised on purpose. Admin accounts are hard-deleted, and the history
  -- has to outlive the account that made it: a required FK would either block
  -- the delete or cascade away exactly what this table exists to keep.
  "actorId"    TEXT,
  "actorName"  TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  -- The role that AUTHORIZED the action, read from the JWT. It can be stale
  -- against AdminUser.role by up to the 7-day token life, which is the reason
  -- it is stored rather than joined.
  "actorRole"  TEXT NOT NULL,

  "publishState" TEXT NOT NULL DEFAULT 'NONE',
  "publishedAt"  TIMESTAMP(3),
  "publishError" TEXT,

  -- Denormalised so the list page never has to load children; one reorder can
  -- legitimately carry hundreds of them.
  "changeCount" INTEGER NOT NULL DEFAULT 0,
  "summary"     TEXT NOT NULL,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditChange" (
  "id"      TEXT NOT NULL,
  "eventId" TEXT NOT NULL,

  "seq"  INTEGER NOT NULL,
  "kind" TEXT NOT NULL,

  "entity"      TEXT NOT NULL,
  "entityLabel" TEXT NOT NULL,
  "rowId"       TEXT,
  "rowLabel"    TEXT,

  "field"  TEXT NOT NULL,
  "before" TEXT,
  "after"  TEXT,
  "redacted"  BOOLEAN NOT NULL DEFAULT false,
  "truncated" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "AuditChange_pkey" PRIMARY KEY ("id")
);

-- Closed value sets guarded in the database, matching the CHECK-not-enum
-- precedent set by HeroTitle_version_check: adding a fourth action later is one
-- ALTER, with no CREATE TYPE gymnastics inside the migration's transaction.
ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_action_check"
  CHECK ("action" IN ('SAVE','SAVE_AND_PUBLISH','PUBLISH'));
ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_publishState_check"
  CHECK ("publishState" IN ('NONE','OK','FAILED'));
ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_kind_check"
  CHECK ("kind" IN ('CREATE','UPDATE','DELETE','REORDER'));

-- SetNull, not Cascade: deleting an admin must not delete the record of what
-- they changed. actorName/actorEmail keep the entry readable afterwards.
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "AuditEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- This schema never relies on Postgres to index a foreign key, because it does
-- not. Every column below is one the history page filters or sorts on.
CREATE INDEX "AuditEvent_createdAt_idx"              ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_actorId_idx"                ON "AuditEvent"("actorId");
CREATE INDEX "AuditEvent_publishState_publishedAt_idx" ON "AuditEvent"("publishState", "publishedAt");
CREATE INDEX "AuditChange_eventId_seq_idx"           ON "AuditChange"("eventId", "seq");
CREATE INDEX "AuditChange_entity_rowId_idx"          ON "AuditChange"("entity", "rowId");
