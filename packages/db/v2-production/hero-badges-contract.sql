-- =====================================================================
-- CLUSTER hero-badges -- CONTRACT
-- Target: PRODUCTION Neon, Postgres 17, role = database owner (not superuser).
--
-- RUN ONLY AFTER:
--   1. hero-badges-expand.sql committed, and
--   2. the v2 code is deployed on Vercel and CONFIRMED -- meaning you have
--      actually loaded https://www.yatindora.in (hero chips render, the Golang
--      chip still reads "Golang") and the admin /hero and /icons pages, and
--      saved one badge edit successfully. Not "the build went green".
--
-- Everything here is one-way and breaks the v1 code. That is the point: v1 is
-- no longer running. Each statement says which v1 path it kills.
--
-- ROLLBACK, honestly: before COMMIT, ROLLBACK -- and every guard below is a
-- RAISE EXCEPTION precisely so a surprise aborts instead of half-applying.
-- After COMMIT, "name" is reconstructible (COALESCE(label, skill.name)) but
-- "iconKey" is NOT: it comes back only as the *skill's* icon, which equals the
-- original only for the rows preflight P7 in the expand file reported as
-- non-drifting. The authoritative undo for iconKey is the JSON dump taken
-- immediately before expand. See the reverse script at the bottom.
--
-- Not this cluster's business: the SiteVersion cast on "version" and the drop
-- of HeroSkillBadge_version_check belong to the hero-enum cluster. Ordering is
-- free either way -- if the cast runs after C6, Postgres rebuilds
-- HeroSkillBadge_version_skillId_key in place and keeps its name.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout      = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------
-- C1. Drop the bridge FIRST, and not for tidiness.
--     plpgsql is late-bound: DROP COLUMN "name" at C6 would SUCCEED with the
--     trigger still installed, and then the very next badge INSERT would die
--     with `record "new" has no field "name"` -- i.e. every v2 badge create
--     500s and nothing in the DDL warned you.
--     Because this is inside the transaction, an abort at C3/C4 restores it.
-- ---------------------------------------------------------------------
DROP TRIGGER  IF EXISTS "_migr_hero_badge_bridge" ON "HeroSkillBadge";
DROP FUNCTION IF EXISTS "_migr_hero_badge_bridge"();

-- ---------------------------------------------------------------------
-- C2. HEAL THE WINDOW. Re-run the expand backfill: a badge created by v1
--     between EXPAND and DEPLOY may still have skillId NULL if the bridge
--     could not resolve its free-text name, and a badge created by v2 already
--     has skillId set so these are all no-ops on it.
--     This MUST run before C6, because it reads "name".
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(s."name") = lower(b."name");

UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(b."name") = 'golang'
   AND s."name" = 'Go';

UPDATE "HeroSkillBadge" b
   SET "label" = b."name"
  FROM "Skill" s
 WHERE s."id" = b."skillId"
   AND b."label" IS NULL
   AND b."name" IS NOT NULL
   AND b."name" <> ''
   AND b."name" <> s."name";

-- ---------------------------------------------------------------------
-- C3. HARD GUARD: nothing unresolved. If this fires, a badge was created in
--     the window with a name that matches no Skill. Do NOT guess: the v2 admin
--     now has a skill picker, so create the missing Skill (or delete the
--     badge) and re-run this whole file. Aborting drops nothing.
--     (If it fires you will also already have noticed it: v2's public hero
--     read, apps/web/app/lib/data.ts:117-121, throws on a NULL required
--     relation, so that row 500s the homepage. Check /hero before contracting.)
-- ---------------------------------------------------------------------
DO $guard_unresolved$
DECLARE
  n      integer;
  sample text;
BEGIN
  SELECT count(*) INTO n FROM "HeroSkillBadge" WHERE "skillId" IS NULL;
  IF n > 0 THEN
    SELECT string_agg(format('%s (%s/sort %s, id %s)', "name", "version", "sortOrder", "id"), '; ')
      INTO sample FROM "HeroSkillBadge" WHERE "skillId" IS NULL;
    RAISE EXCEPTION
      'hero-badges contract aborted: % badge(s) still have no skillId -> %. Create the missing Skill in /skills (or delete the badge), then re-run. Nothing dropped.',
      n, sample;
  END IF;
END
$guard_unresolved$;

-- ---------------------------------------------------------------------
-- C4. HARD GUARD: the unique index at C6 is satisfiable. Readable message now
--     beats a raw 23505 from CREATE UNIQUE INDEX later.
-- ---------------------------------------------------------------------
DO $guard_dupes$
DECLARE
  n      integer;
  sample text;
BEGIN
  SELECT count(*), string_agg(format('%s/%s', "version", "skillId"), '; ')
    INTO n, sample
    FROM (
      SELECT "version", "skillId"
        FROM "HeroSkillBadge"
       GROUP BY "version", "skillId"
      HAVING count(*) > 1
    ) d;
  IF n > 0 THEN
    RAISE EXCEPTION
      'hero-badges contract aborted: % duplicate (version, skillId) group(s) -> %. Delete the redundant badge in /hero, then re-run. Nothing dropped.',
      n, sample;
  END IF;
END
$guard_dupes$;

-- ---------------------------------------------------------------------
-- C5. skillId becomes required.
--     Kills in v1: the badge create at apps/docs/app/lib/actions/staging.ts:493-501
--     (git HEAD), which omits skillId -> 23502. v1 is not running.
--     SET NOT NULL needs a full scan under ACCESS EXCLUSIVE; 14 rows.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "skillId" SET NOT NULL;

-- ---------------------------------------------------------------------
-- C6. The FK and the composite unique.
--     Both were withheld from expand deliberately (see the expand header).
--     Kills in v1: the FK's ON DELETE RESTRICT turns v1's bare
--     tx.skill.deleteMany (staging.ts:740-742 in HEAD) into a raw 23503 when
--     the skill is badged. Safe now because the deployed v2 counts badges
--     first and fails with a sentence (staging.ts:800-802, working tree:
--     "A hero badge still uses that skill -- delete the badge first").
--     The unique index kills v1's ability to create a second badge for the
--     same skill in one version, which nothing prevented before.
--     ADD CONSTRAINT ... FOREIGN KEY validates immediately (no NOT VALID: 14
--     rows, and NOT VALID would not buy anything here -- it skips the initial
--     scan but still installs the RESTRICT trigger). It takes SHARE ROW
--     EXCLUSIVE on both HeroSkillBadge and Skill: writes wait, SELECTs do not.
--     CREATE UNIQUE INDEX, not ADD CONSTRAINT UNIQUE -- Prisma spells @@unique
--     as an index, and a constraint would read as drift.
-- ---------------------------------------------------------------------
DO $add_fkey$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'HeroSkillBadge_skillId_fkey'
       AND conrelid = '"HeroSkillBadge"'::regclass
  ) THEN
    ALTER TABLE "HeroSkillBadge"
      ADD CONSTRAINT "HeroSkillBadge_skillId_fkey"
      FOREIGN KEY ("skillId") REFERENCES "Skill"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$add_fkey$;

CREATE UNIQUE INDEX IF NOT EXISTS "HeroSkillBadge_version_skillId_key"
  ON "HeroSkillBadge" ("version", "skillId");

-- expand already created this one; listed so the set is complete and so a
-- re-run after a partial apply converges.
CREATE INDEX IF NOT EXISTS "HeroSkillBadge_skillId_idx"
  ON "HeroSkillBadge" ("skillId");

-- ---------------------------------------------------------------------
-- C7. Drop the free-text pair. ONE-WAY.
--     "name" survives as "label" wherever it differed from the skill.
--     "iconKey" has nowhere to go by design -- Skill.iconKey is the single
--     source of truth -- so from here it exists only in the JSON dump.
--     Kills in v1, all of them SELECTs that name the columns explicitly, so
--     42703 undefined_column:
--       apps/web/app/lib/data.ts:138-149                  public hero -> 500
--       apps/docs/app/(dashboard)/hero/page.tsx:12,49     admin /hero -> 500
--       apps/docs/app/(dashboard)/icons/page.tsx:9        admin /icons -> 500
--       apps/docs/app/lib/actions/staging.ts:137          audit shadow -> every save 500s
--     Also drops the DEFAULT '' that expand put on them.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge"
  DROP COLUMN IF EXISTS "name",
  DROP COLUMN IF EXISTS "iconKey";

-- ---------------------------------------------------------------------
-- C8. Remove the scaffolding default on updatedAt. Prisma's @updatedAt
--     declares no database default, so leaving it is drift in
--     `prisma migrate diff`.
--     Kills in v1: its badge INSERT never wrote updatedAt -> 23502. Safe now:
--     the deployed v2 client writes updatedAt on every create and update.
--     createdAt KEEPS its default -- that one is @default(now()).
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------
-- VERIFICATION, still inside the transaction.
-- ---------------------------------------------------------------------

-- W1. Nothing lost. Expected ONE row: total 14 (or 14 + whatever the window
--     legitimately added), null_skill 0, labelled 2.
SELECT count(*)                                   AS total,
       count(*) FILTER (WHERE "skillId" IS NULL)   AS null_skill,
       count(*) FILTER (WHERE "label" IS NOT NULL) AS labelled
  FROM "HeroSkillBadge";

-- W2. The hero as it now renders. Expected 7 rows per version; only the Go row
--     carries label 'Golang'.
SELECT b."version", b."sortOrder", s."name" AS skill, s."iconKey", b."label"
  FROM "HeroSkillBadge" b
  JOIN "Skill" s ON s."id" = b."skillId"
 ORDER BY b."version", b."sortOrder";

-- W3. Every label is a real override, not noise. Expected 2 rows, both
--     'Golang' over skill 'Go'.
SELECT b."version", b."label", s."name" AS skill
  FROM "HeroSkillBadge" b
  JOIN "Skill" s ON s."id" = b."skillId"
 WHERE b."label" IS NOT NULL AND b."label" <> s."name"
 ORDER BY b."version";

-- W4. Columns, for a clean `prisma migrate diff`. Expected EXACTLY 7 rows and
--     no "name"/"iconKey":
--       id        text             NO   no default
--       name      -- ABSENT
--       iconKey   -- ABSENT
--       sortOrder integer          NO   no default
--       version   text|SiteVersion NO   default 'v2'   (type depends on hero-enum)
--       skillId   text             NO   no default
--       label     text             YES  no default
--       createdAt timestamp(3)     NO   default CURRENT_TIMESTAMP
--       updatedAt timestamp(3)     NO   NO DEFAULT
SELECT column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'HeroSkillBadge'
 ORDER BY ordinal_position;

-- W5. Index names exactly as the v2 Prisma schema expects. Expected 4:
--     HeroSkillBadge_pkey, HeroSkillBadge_skillId_idx,
--     HeroSkillBadge_version_skillId_key, HeroSkillBadge_version_sortOrder_idx.
SELECT indexname FROM pg_indexes
 WHERE schemaname = current_schema() AND tablename = 'HeroSkillBadge'
 ORDER BY indexname;

-- W6. Constraints. confdeltype 'r' = RESTRICT, confupdtype 'c' = CASCADE.
--     Expected: HeroSkillBadge_pkey (p); HeroSkillBadge_skillId_fkey (f,r,c);
--     HeroSkillBadge_version_skillId_key (u); plus HeroSkillBadge_version_check
--     (c) if the hero-enum cluster has not run yet -- that one is its to drop.
SELECT conname, contype, confdeltype, confupdtype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = '"HeroSkillBadge"'::regclass
 ORDER BY conname;

-- W7. The scaffolding is gone. Expected 0 rows from both.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = '"HeroSkillBadge"'::regclass AND NOT tgisinternal;
SELECT proname FROM pg_proc WHERE proname = '_migr_hero_badge_bridge';

-- W8. The '+N more' denominator is intact. Expected: 47 skills, 7 badged,
--     14 badges.
SELECT (SELECT count(*) FROM "Skill")                           AS skills,
       (SELECT count(DISTINCT "skillId") FROM "HeroSkillBadge")  AS badged_skills,
       (SELECT count(*) FROM "HeroSkillBadge")                   AS badges;

COMMIT;


-- =====================================================================
-- OPTIONAL, BY HAND, NOT PART OF THE MIGRATION. Proves RESTRICT bites and that
-- the v2 app-level guard, not the raw error, is what the operator will see.
-- Raises on purpose, so keep it out of `psql -v ON_ERROR_STOP=1 -f`.
--
--   BEGIN;
--   DELETE FROM "Skill" WHERE "name" = 'Go';
--   -- Expected: ERROR 23503 update or delete on table "Skill" violates foreign
--   -- key constraint "HeroSkillBadge_skillId_fkey" on table "HeroSkillBadge"
--   ROLLBACK;
-- =====================================================================


-- =====================================================================
-- REVERSE OF CONTRACT (lossy -- read the caveat). Only useful if you have to
-- roll the CODE back to v1 after contracting.
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "HeroSkillBadge"
--     ADD COLUMN "name" TEXT, ADD COLUMN "iconKey" TEXT;
--   UPDATE "HeroSkillBadge" b
--      SET "name"    = COALESCE(b."label", s."name"),
--          "iconKey" = s."iconKey"
--     FROM "Skill" s WHERE s."id" = b."skillId";
--   ALTER TABLE "HeroSkillBadge"
--     ALTER COLUMN "name"    SET NOT NULL,
--     ALTER COLUMN "iconKey" SET NOT NULL,
--     ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
--     ALTER COLUMN "skillId" DROP NOT NULL;
--   DROP INDEX IF EXISTS "HeroSkillBadge_version_skillId_key";
--   ALTER TABLE "HeroSkillBadge"
--     DROP CONSTRAINT IF EXISTS "HeroSkillBadge_skillId_fkey";
--   COMMIT;
--
-- Caveat: "name" comes back exactly ("label" carried the override), but
-- "iconKey" comes back as the SKILL's icon key. That equals the original only
-- for the rows expand preflight P7 reported as non-drifting.
--
-- SECOND PASS, for the true per-badge "iconKey". Run it even when P7 reported no
-- drift: it costs one transaction and removes the last guess. The columns are
-- already NOT NULL by then, so this is a plain UPDATE and cannot raise 23502.
--
--   cd packages/db
--   jq -r -f v2-production/recover-from-dump.jq \
--      --arg table HeroSkillBadge --arg key id --arg cols 'iconKey' \
--      --arg mode update backups/PRE-CUTOVER-<stamp>.json \
--      > /tmp/v2/prod/recover-badge-iconkey.sql
--   # read it, then apply it the same way you applied this file
--
-- RUNBOOK.md Step 8b rehearses that exact command against a throwaway branch.
-- Its guard aborts if a badge in the dump no longer exists; a badge created
-- AFTER the dump is simply absent from the generated file, and for those rows
-- the skill-icon value above is all there is.
-- =====================================================================
