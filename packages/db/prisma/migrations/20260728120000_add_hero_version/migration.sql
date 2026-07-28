-- Two hero layouts live side by side. HeroTitle and HeroSkillBadge rows always
-- belong to exactly one of them; SocialLink rows are shared with the contact
-- section and the footer, so there NULL means "shown in every version".
--
-- The ALTERs and the backfill share one file on purpose: Prisma wraps each
-- migration in a transaction, so there is never an instant where a live row
-- exists without a version.

ALTER TABLE "HeroTitle"      ADD COLUMN "version" TEXT;
ALTER TABLE "HeroSkillBadge" ADD COLUMN "version" TEXT;
ALTER TABLE "SocialLink"     ADD COLUMN "version" TEXT;

-- Everything in this database today IS the old hero: the rotating titles, the
-- inline badge list, and the duplicate LeetCode link. Tag it before any v2 row
-- lands, so no live row is ever version-less.
UPDATE "HeroTitle"      SET "version" = 'v1';
UPDATE "HeroSkillBadge" SET "version" = 'v1';
UPDATE "SocialLink"     SET "version" = 'v1' WHERE "name" = 'LeetCode 2';

-- Now that no row is NULL, the two hero-only tables can be tightened.
ALTER TABLE "HeroTitle"      ALTER COLUMN "version" SET NOT NULL,
                             ALTER COLUMN "version" SET DEFAULT 'v2';
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "version" SET NOT NULL,
                             ALTER COLUMN "version" SET DEFAULT 'v2';

-- Cheap database-level guard on the two allowed values. A CHECK rather than an
-- enum: adding a v3 later is one ALTER, with no CREATE TYPE gymnastics and no
-- ALTER TYPE ... ADD VALUE fighting the migration's transaction wrapper.
ALTER TABLE "HeroTitle"      ADD CONSTRAINT "HeroTitle_version_check"      CHECK ("version" IN ('v1','v2'));
ALTER TABLE "HeroSkillBadge" ADD CONSTRAINT "HeroSkillBadge_version_check" CHECK ("version" IN ('v1','v2'));
ALTER TABLE "SocialLink"     ADD CONSTRAINT "SocialLink_version_check"     CHECK ("version" IS NULL OR "version" IN ('v1','v2'));

CREATE INDEX "HeroTitle_version_sortOrder_idx"      ON "HeroTitle"("version", "sortOrder");
CREATE INDEX "HeroSkillBadge_version_sortOrder_idx" ON "HeroSkillBadge"("version", "sortOrder");
CREATE INDEX "SocialLink_version_sortOrder_idx"     ON "SocialLink"("version", "sortOrder");

-- The active hero starts as v1 — exactly what visitors see today. The v2 rows do
-- not exist yet; installing them and flipping the switch are both deliberate,
-- separate acts. That makes this migration fully backward compatible: the
-- currently-deployed code does an unfiltered findMany and gets the same rows it
-- got before, so it can be applied safely ahead of the code deploy.
INSERT INTO "SiteConfig" ("id", "key", "value")
VALUES (gen_random_uuid()::text, 'heroVersion', 'v1')
ON CONFLICT ("key") DO NOTHING;
