-- Section-level kill switches. Purely additive — one new table, nothing
-- existing is touched — so it can be applied ahead of the code deploy and
-- rolled back by dropping the table again.
--
-- Applying this alone changes nothing a visitor sees: the table starts empty,
-- and an empty table is indistinguishable from "every flag at its default"
-- because the reader falls back to FLAG_DEFINITIONS for any key it cannot find.
-- The seed that fills it (bun run flags:seed) is likewise a no-op on a second
-- run, and deliberately never writes "enabled" on update, so re-seeding cannot
-- switch a section back on that somebody turned off on purpose.
CREATE TABLE "FeatureFlag" (
  -- The key IS the identity. Code references a flag by a stable string, so a
  -- surrogate id would be a second name for the same thing and would permit two
  -- rows claiming one key.
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,

  -- Why it is off, for whoever finds it off three weeks from now.
  "note"        TEXT,

  "updatedById" TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);
