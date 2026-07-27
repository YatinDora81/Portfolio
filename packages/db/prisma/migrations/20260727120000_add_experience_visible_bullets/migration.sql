-- How many bullets a role shows before the "+ N more" toggle on the site.
-- Additive with a default, so existing rows keep the previous behaviour
-- (four visible, the rest folded) until an admin tunes them per role.
ALTER TABLE "Experience" ADD COLUMN "visibleBullets" INTEGER NOT NULL DEFAULT 4;
