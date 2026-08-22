-- Section-level kill switches. Purely additive — one new table, nothing
-- existing is touched — so it can be applied ahead of the code deploy and
-- rolled back by dropping the table again. The table starts empty, and a
-- missing row reads as that flag's code default rather than as "off".
CREATE TABLE "FeatureFlag" (
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "note"        TEXT,
  "updatedById" TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);
