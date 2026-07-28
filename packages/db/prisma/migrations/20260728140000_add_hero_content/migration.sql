-- The hero's copy and the switch deciding which version ships move out of
-- SiteConfig and into one row per version.
--
-- Why: `heroVersion` was a SiteConfig row written immediately by the site-config
-- form, while the hero's titles and badges stage in the browser and commit
-- through applyStagedChanges. Publishing a flip while those were still staged
-- served the new hero against the old rows. As a column on a row with a real id,
-- the flip is an ordinary staged update and commits inside the same transaction
-- as the rows it depends on.
--
-- This migration is ADDITIVE and backward compatible: the old SiteConfig rows
-- are left exactly where they are, so the currently-deployed apps/web keeps
-- reading them and this can be applied ahead of the code deploy. A later
-- migration deletes those five keys, once both apps are running the new code.

CREATE TABLE "HeroContent" (
  "id"      TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "intro"   TEXT NOT NULL DEFAULT '',
  "tagline" TEXT NOT NULL DEFAULT '',
  -- Holds the sentinel 'live' on the serving row, NULL on the other. A unique
  -- index over a nullable column is Postgres's way of spelling "at most one",
  -- and unlike a partial index on a boolean it is a constraint Prisma declares
  -- itself — so no future `migrate dev` can quietly diff it away.
  "live"    TEXT,

  CONSTRAINT "HeroContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HeroContent_version_key" ON "HeroContent"("version");
CREATE UNIQUE INDEX "HeroContent_live_key" ON "HeroContent"("live");

-- Cheap database-level guards on the two closed value sets, in the same spirit
-- as HeroTitle_version_check. Prisma has no representation for a CHECK, so
-- these live only here — that is already this repo's pattern.
ALTER TABLE "HeroContent" ADD CONSTRAINT "HeroContent_version_check" CHECK ("version" IN ('v1','v2'));
ALTER TABLE "HeroContent" ADD CONSTRAINT "HeroContent_live_check"    CHECK ("live" IS NULL OR "live" = 'live');

-- Exactly two rows, written as literal VALUES with scalar subqueries rather than
-- INSERT…SELECT: the row count must not depend on which SiteConfig keys happen
-- to exist. A database that never ran the v2 install script has no `introV2`,
-- and a missing row would leave that version's copy uneditable in the admin.
--
-- NULLIF is load-bearing. The site-config form posts every key on every save, so
-- '' is a real stored value, and `introV2 = ''` must still fall through to
-- `intro` — the same `||` chain apps/web/app/lib/data.ts resolves at read time.
-- Resolving it once, here, is what lets that chain be deleted from all four
-- places that currently duplicate it.
--
-- `live` reproduces the "anything not exactly v1 is v2" coercion the code uses.
-- The heroVersion row it reads is the one inserted by
-- 20260728120000_add_hero_version — do not remove that INSERT: on a fresh
-- database it is the only reason v1 comes out live rather than v2.
INSERT INTO "HeroContent" ("id", "version", "intro", "tagline", "live")
VALUES (
  gen_random_uuid()::text,
  'v1',
  COALESCE((SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'intro'), ''),
  COALESCE((SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'tagline'), ''),
  CASE WHEN COALESCE((SELECT "value" FROM "SiteConfig" WHERE "key" = 'heroVersion'), 'v2') = 'v1'
       THEN 'live' END
);

INSERT INTO "HeroContent" ("id", "version", "intro", "tagline", "live")
VALUES (
  gen_random_uuid()::text,
  'v2',
  COALESCE(
    (SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'introV2'),
    (SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'intro'),
    ''
  ),
  COALESCE(
    (SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'taglineV2'),
    (SELECT NULLIF("value", '') FROM "SiteConfig" WHERE "key" = 'tagline'),
    ''
  ),
  CASE WHEN COALESCE((SELECT "value" FROM "SiteConfig" WHERE "key" = 'heroVersion'), 'v2') <> 'v1'
       THEN 'live' END
);
