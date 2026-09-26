-- ============================================================================
-- PRODUCTION CONTRACT — cluster: hero
--
-- Run ONLY after the v2 code is deployed, serving, and confirmed (the public
-- home page renders the hero and /hero saves an edit).
--
-- This cluster drops NO columns and NO tables. HeroContent keeps id, live, intro
-- and tagline; HeroTitle and SocialLink keep every column they had. The
-- name/iconKey -> skillId contraction on HeroSkillBadge is cluster 25, not here.
-- So there is no v1 SELECT that this file can break, and nothing here is
-- urgent — if it is never run, the only consequence is that
-- `prisma migrate diff` reports drift on three columns forever.
--
-- What is left to do is exactly the one statement per table that
-- hero-expand.sql deliberately postponed.
-- ============================================================================


-- ============================================================================
-- PREFLIGHT
-- ============================================================================

-- C0. Confirm v2 is actually the deployed code before running this. The cheap
--     proof is that the columns are the enum AND the site is up:
--       curl -s -o /dev/null -w '%{http_code}\n' https://www.yatindora.in/
--     EXPECTED: 4 rows, all udt_name = SiteVersion, and a 200 from the curl.
SELECT "table_name", "udt_name"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public' AND "column_name" = 'version'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'HeroSkillBadge', 'SocialLink')
 ORDER BY 1;

-- C1. The three "updatedAt" columns still carry the expand-stage default.
--     EXPECTED: 3 rows, column_default = CURRENT_TIMESTAMP.
SELECT "table_name", "column_name", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name" = 'updatedAt'
 ORDER BY 1;


-- ============================================================================
-- CONTRACT
-- ============================================================================
-- Drop the temporary default on "updatedAt". It only existed so that v1 INSERTs,
-- which never name that column (staging.ts:482/:493/:561 and
-- actions/social-links.ts:21 in git HEAD), would not hit
-- 23502 null value in column "updatedAt" violates not-null constraint.
--
-- Safe now, and only now: the v2 client always supplies the value explicitly.
-- Captured from the real generated v2 client —
--   INSERT INTO "public"."HeroTitle" ("id","version","title","sortOrder","createdAt","updatedAt")
--     VALUES ($1,CAST($2::text AS "public"."SiteVersion"),$3,$4,$5,$6)
--   UPDATE  "public"."HeroTitle" SET "title" = $1, "updatedAt" = $2 WHERE ...
-- so @updatedAt writes it on create and on every update. A lingering database
-- default is pure drift against target-ddl.sql:95/107/135, which declare
-- "updatedAt" TIMESTAMP(3) NOT NULL with no default.
--
-- "createdAt" KEEPS its CURRENT_TIMESTAMP default — that is @default(now()) and
-- it is in the canonical DDL.
--
-- Single fast transaction: three catalog-only ALTERs, no rewrite, no data touched.

SET lock_timeout = '3s';
SET statement_timeout = '30s';

BEGIN;

ALTER TABLE "HeroContent" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "HeroTitle"   ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SocialLink"  ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;

-- Deliberately NOT here:
--   * HeroSkillBadge."updatedAt" DROP DEFAULT — that table's timestamps are added
--     by cluster 25 (badges), so its contract statement belongs with it.
--   * Any DROP COLUMN. This cluster added and retyped; it removed nothing that
--     v2 still reads. HeroContent."id" and "live" are both load-bearing in v2
--     (schema-v2.md: the staging layer keys every row by a column named "id",
--     and "live" is the pointer that flips inside the staged transaction).


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- W1. The three tables now match target-ddl.sql exactly for these columns.
--     EXPECTED: 6 rows —
--       <table> | createdAt | timestamp without time zone | 3 | NO | CURRENT_TIMESTAMP
--       <table> | updatedAt | timestamp without time zone | 3 | NO | (null)
SELECT "table_name", "column_name", "data_type", "datetime_precision",
       "is_nullable", "column_default"
  FROM information_schema."columns"
 WHERE "table_schema" = 'public'
   AND "table_name" IN ('HeroContent', 'HeroTitle', 'SocialLink')
   AND "column_name" IN ('createdAt', 'updatedAt')
 ORDER BY 1, 2;

-- W2. No row lost a stamp along the way.
--     EXPECTED: 0 rows.
SELECT 'HeroContent' AS "table", "id" FROM "HeroContent" WHERE "createdAt" IS NULL OR "updatedAt" IS NULL
UNION ALL SELECT 'HeroTitle',  "id" FROM "HeroTitle"  WHERE "createdAt" IS NULL OR "updatedAt" IS NULL
UNION ALL SELECT 'SocialLink', "id" FROM "SocialLink" WHERE "createdAt" IS NULL OR "updatedAt" IS NULL;

-- W3. Prove v2 can still write. In the admin, open /hero, change one title and
--     save. Then:
--     EXPECTED: the edited row's "updatedAt" is now, not the EXPAND timestamp.
SELECT "id", "title", "version"::text AS "version", "createdAt", "updatedAt"
  FROM "HeroTitle"
 ORDER BY "updatedAt" DESC;

-- W4. Any hero row whose "updatedAt" still equals its "createdAt" to the
--     millisecond was stamped by EXPAND and has not been written since. Rows
--     edited by the v1 code DURING the expand->deploy window look the same, and
--     that history is not recoverable from these columns. Informational.
SELECT 'HeroContent' AS "table", "id", "createdAt" FROM "HeroContent" WHERE "updatedAt" = "createdAt"
UNION ALL SELECT 'HeroTitle',  "id", "createdAt" FROM "HeroTitle"  WHERE "updatedAt" = "createdAt"
UNION ALL SELECT 'SocialLink', "id", "createdAt" FROM "SocialLink" WHERE "updatedAt" = "createdAt"
 ORDER BY 1, 3;


-- ============================================================================
-- ROLLBACK of CONTRACT — safe at any time, with either code version deployed.
-- Putting the default back is what you do if you ever need to run the v1 code,
-- the HEAD seed or scripts/install-hero-v2.ts against this database again.
-- ============================================================================
-- BEGIN;
--   ALTER TABLE "HeroContent" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   ALTER TABLE "HeroTitle"   ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   ALTER TABLE "SocialLink"  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
-- COMMIT;
