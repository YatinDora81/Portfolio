-- =====================================================================
-- Cluster 25-hero-badges  (plan step 14)
-- Target branch: the Neon copy-on-write clone of production. NOT production.
--
-- WHAT THIS DOES
--   HeroSkillBadge stops carrying a free-text skill and starts pointing at
--   the Skill table:
--     + "skillId"   TEXT  -> FK to Skill, RESTRICT on delete
--     + "label"     TEXT? -> per-badge display override
--     + "createdAt" / "updatedAt"
--     - "name", "iconKey"                       (dropped at the end)
--     + HeroSkillBadge_skillId_fkey             (Restrict / Cascade)
--     + HeroSkillBadge_version_skillId_key      (unique)
--     + HeroSkillBadge_skillId_idx              (index)
--     = HeroSkillBadge_version_sortOrder_idx    (already exists, 20260728120000)
--
--   Backfill rule, from /tmp/v2/data-facts.txt "HeroSkillBadge -> Skill
--   match check": 14 rows, 7 per version, and 12 of the 14 resolve on
--   lower(name) against Skill.name. The two that do not are named 'Golang'
--   with iconKey 'Go'; Skill 'Go' is the intended target. Those two get
--   skillId = Skill 'Go' and label = 'Golang', so the hero still renders the
--   word Golang without minting a duplicate, hidden Skill row.
--
--   The general label rule is "store the old name whenever it differs from
--   the resolved skill's name". On today's data that fires on exactly the
--   two Golang rows and nothing else, and it means the migration loses no
--   rendered string even if a name differs only in case.
--
-- WHAT IS NOT HERE
--   The SiteVersion cast on "version" and the drop of
--   HeroSkillBadge_version_check belong to plan step 5 (cluster
--   05-site-version). Nothing below writes or compares a version literal, so
--   this file is correct whether "version" is still TEXT or already the
--   SiteVersion enum. Retyping the column later rebuilds the unique index
--   in place and keeps its name, so the ordering is free.
--
-- TRANSACTIONALITY
--   Every statement below is transactional. No CREATE INDEX CONCURRENTLY, no
--   ALTER TYPE ... ADD VALUE, no VACUUM. Run the whole file inside one
--   BEGIN ... COMMIT. No superuser powers are used: no
--   session_replication_role, no DISABLE TRIGGER, no CREATE EXTENSION.
--
-- IDEMPOTENCY, honestly
--   Every DDL statement is guarded (IF NOT EXISTS / IF EXISTS / a pg_constraint
--   check) and every UPDATE is a no-op on a second pass, so a half-applied
--   state - which can only happen if someone ran the statements outside a
--   transaction - is safe to run over.
--   What this file is NOT is re-runnable after a successful COMMIT: preflights
--   2, 5, 7, 8 and updates DML 2, 3, 4 all read "name", which no longer
--   exists by then, so they error. That is the intended one-way door. If the
--   run aborted or was rolled back, the columns are still there and the whole
--   file runs clean from the top.
--
-- ROLLBACK
--   Before COMMIT: ROLLBACK. That is the real answer, and the hard guards
--   below are written as RAISE EXCEPTION precisely so a surprise aborts the
--   transaction instead of half-applying.
--
--   After COMMIT, cheapest path: throw the Neon branch away and re-create it
--   from production, since it serves no traffic.
--
--   After COMMIT, manual reverse (lossy, read the caveat):
--     ALTER TABLE "HeroSkillBadge"
--       ADD COLUMN "name" TEXT, ADD COLUMN "iconKey" TEXT;
--     UPDATE "HeroSkillBadge" b
--        SET "name"    = COALESCE(b."label", s."name"),
--            "iconKey" = s."iconKey"
--       FROM "Skill" s WHERE s."id" = b."skillId";
--     ALTER TABLE "HeroSkillBadge"
--       ALTER COLUMN "name" SET NOT NULL,
--       ALTER COLUMN "iconKey" SET NOT NULL;
--     DROP INDEX IF EXISTS "HeroSkillBadge_version_skillId_key";
--     DROP INDEX IF EXISTS "HeroSkillBadge_skillId_idx";
--     ALTER TABLE "HeroSkillBadge"
--       DROP CONSTRAINT IF EXISTS "HeroSkillBadge_skillId_fkey",
--       DROP COLUMN IF EXISTS "skillId",
--       DROP COLUMN IF EXISTS "label",
--       DROP COLUMN IF EXISTS "createdAt",
--       DROP COLUMN IF EXISTS "updatedAt";
--   Caveat: "name" comes back exactly (label carries the override), but
--   "iconKey" comes back as the *skill's* icon key. That is identical to the
--   original only for badges whose iconKey already equalled their skill's
--   iconKey - which is exactly what preflight 7 measures, and which
--   /tmp/v2/data-facts.txt does not answer because it lists no Skill.iconKey
--   values. Run preflight 7 and keep its output. The JSON dump taken today
--   holds both columns verbatim and is the authoritative undo source.
--
-- CODE HALF (coupled, step 14). Dropping "name"/"iconKey" breaks these until
-- they ship: apps/docs/app/(dashboard)/hero/badges-table.tsx and sections.tsx
-- (badge editor becomes a skill picker), apps/docs/app/lib/actions/staging.ts
-- (and its skill delete branch, which must count badges itself because
-- Restrict will otherwise raise a raw FK error mid-batch),
-- apps/docs/app/lib/audit.ts, apps/docs/app/components/preview/staged.tsx,
-- apps/web/app/lib/data.ts, packages/db/seed.ts and
-- packages/db/scripts/install-hero-v2.ts.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PREFLIGHT. Read every result before running the DDL. These are plain
-- SELECTs; the hard, transaction-aborting versions of the two that matter
-- are DO blocks further down, next to the statements they protect.
-- ---------------------------------------------------------------------

-- 1. Shape of the table today.
--    Expected: 14 total, 7 for 'v1' and 7 for 'v2'.
SELECT "version", count(*) AS badges
  FROM "HeroSkillBadge"
 GROUP BY "version"
 ORDER BY "version";

-- 2. The full old contents, printed before anything is dropped so the run
--    log keeps the two columns this cluster removes.
--    Expected: 14 rows. Per version: Next.js/Next.js, Golang/Go,
--    TypeScript/TypeScript, Node.js/Node.js, React/React, Prisma/Prisma,
--    Python/Python.
SELECT "version", "sortOrder", "name", "iconKey", "id"
  FROM "HeroSkillBadge"
 ORDER BY "version", "sortOrder";

-- 3. Skill.name is not yet unique on lower(name) in this branch (that index
--    arrives with the Skill cluster), and an ambiguous match would make the
--    backfill UPDATE pick a row arbitrarily.
--    Expected: 0 rows. data-facts.txt: "lower() duplicates: none".
SELECT lower("name") AS lowered, count(*) AS skills
  FROM "Skill"
 GROUP BY lower("name")
HAVING count(*) > 1;

-- 4. The Golang override target exists and is singular.
--    Expected: exactly 1 row, name 'Go'.
SELECT "id", "name", "iconKey" FROM "Skill" WHERE "name" = 'Go';

-- 5. Every badge resolves, once the Golang special case is allowed for.
--    Expected: 0 rows.
SELECT b."version", b."sortOrder", b."name", b."iconKey"
  FROM "HeroSkillBadge" b
  LEFT JOIN "Skill" s ON lower(s."name") = lower(b."name")
 WHERE s."id" IS NULL
   AND lower(b."name") <> 'golang';

-- 6. The @@unique([version, skillId]) is satisfiable: no two badges in one
--    version resolve to the same skill. Note Skill 'Go' is not badged under
--    its own name anywhere, so folding Golang onto it collides with nothing.
--    Expected: 0 rows.
WITH mapped AS (
  SELECT b."id",
         b."version",
         COALESCE(s."id", g."id") AS "skillId"
    FROM "HeroSkillBadge" b
    LEFT JOIN "Skill" s ON lower(s."name") = lower(b."name")
    LEFT JOIN "Skill" g ON lower(b."name") = 'golang' AND g."name" = 'Go'
)
SELECT "version", "skillId", count(*) AS badges
  FROM mapped
 GROUP BY "version", "skillId"
HAVING count(*) > 1;

-- 7. Icon drift. After this cluster the chip's icon comes from
--    Skill.iconKey, so any badge whose iconKey differs from its skill's
--    iconKey changes appearance, and the rollback above cannot restore that
--    value from the live database.
--    Expected: UNKNOWN. /tmp/v2/data-facts.txt lists Skill *names* but no
--    Skill.iconKey values, so this cannot be predicted from the facts file -
--    it has to be read off the branch. 0 rows means the drop of "iconKey"
--    is information-preserving. Any rows means those icons change; that is
--    the intended "one source of truth" behaviour, but record the pairs.
SELECT b."version", b."sortOrder", b."name", b."iconKey" AS badge_icon,
       s."name" AS skill_name, s."iconKey" AS skill_icon
  FROM "HeroSkillBadge" b
  JOIN "Skill" s
    ON s."id" = COALESCE(
         (SELECT x."id" FROM "Skill" x WHERE lower(x."name") = lower(b."name")),
         (SELECT y."id" FROM "Skill" y WHERE lower(b."name") = 'golang' AND y."name" = 'Go')
       )
 WHERE b."iconKey" <> s."iconKey"
 ORDER BY b."version", b."sortOrder";

-- 8. Names that will be preserved in "label" because they differ from the
--    resolved skill's name.
--    Expected: 2 rows, both 'Golang' -> 'Go', one per version.
SELECT b."version", b."name" AS badge_name, s."name" AS skill_name
  FROM "HeroSkillBadge" b
  JOIN "Skill" s
    ON s."id" = COALESCE(
         (SELECT x."id" FROM "Skill" x WHERE lower(x."name") = lower(b."name")),
         (SELECT y."id" FROM "Skill" y WHERE lower(b."name") = 'golang' AND y."name" = 'Go')
       )
 WHERE b."name" <> s."name"
 ORDER BY b."version", b."sortOrder";

-- ---------------------------------------------------------------------
-- HARD GUARD before any write: an ambiguous Skill.name makes the backfill
-- non-deterministic. Aborts the transaction rather than guessing.
-- ---------------------------------------------------------------------
DO $guard_ambiguous$
DECLARE
  dupes integer;
BEGIN
  SELECT count(*) INTO dupes
    FROM (
      SELECT 1 FROM "Skill" GROUP BY lower("name") HAVING count(*) > 1
    ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'aborting 25-hero-badges: % case-insensitive duplicate Skill name group(s); the backfill would pick a skill arbitrarily',
      dupes;
  END IF;
END
$guard_ambiguous$;

-- ---------------------------------------------------------------------
-- DDL 1. The new columns. skillId stays nullable until the backfill has
-- proven itself. updatedAt takes a temporary default so the existing 14 rows
-- can satisfy NOT NULL; it is dropped at the end because Prisma's @updatedAt
-- declares no database default and a lingering one would read as drift.
-- createdAt keeps its default: @default(now()).
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge"
  ADD COLUMN IF NOT EXISTS "skillId"   TEXT,
  ADD COLUMN IF NOT EXISTS "label"     TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------
-- DML 2. Backfill skillId, exact case-insensitive name match. 12 of 14.
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(s."name") = lower(b."name");

-- ---------------------------------------------------------------------
-- DML 3. The Golang override. 2 of 14, one per version. Skill 'Go' is the
-- intended target; the word 'Golang' survives in "label" at DML 4.
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(b."name") = 'golang'
   AND s."name" = 'Go';

-- ---------------------------------------------------------------------
-- DML 4. Preserve any rendered name that differs from the skill it now
-- points at. Today: the two Golang rows, and nothing else.
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "label" = b."name"
  FROM "Skill" s
 WHERE s."id" = b."skillId"
   AND b."label" IS NULL
   AND b."name" <> s."name";

-- ---------------------------------------------------------------------
-- HARD GUARD before the drop: every badge resolved, and the unique index is
-- satisfiable. Nothing destructive happens if either fails.
-- ---------------------------------------------------------------------
DO $guard_resolved$
DECLARE
  unresolved integer;
  collisions integer;
  total      integer;
BEGIN
  SELECT count(*) INTO unresolved FROM "HeroSkillBadge" WHERE "skillId" IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION
      'aborting 25-hero-badges: % HeroSkillBadge row(s) did not resolve to a Skill; nothing dropped',
      unresolved;
  END IF;

  SELECT count(*) INTO collisions
    FROM (
      SELECT 1
        FROM "HeroSkillBadge"
       GROUP BY "version", "skillId"
      HAVING count(*) > 1
    ) c;
  IF collisions > 0 THEN
    RAISE EXCEPTION
      'aborting 25-hero-badges: % duplicate (version, skillId) group(s); HeroSkillBadge_version_skillId_key would fail',
      collisions;
  END IF;

  SELECT count(*) INTO total FROM "HeroSkillBadge";
  IF total <> 14 THEN
    RAISE WARNING
      'note: HeroSkillBadge holds % rows, not the 14 recorded in data-facts.txt; the guards above still passed',
      total;
  END IF;
END
$guard_resolved$;

-- ---------------------------------------------------------------------
-- DDL 5. skillId is proven; make it required.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "skillId" SET NOT NULL;

-- ---------------------------------------------------------------------
-- DDL 6. Drop the free-text pair. "name" survives as "label" wherever it
-- differed from the skill; "iconKey" has nowhere to go in the new schema by
-- design - Skill.iconKey is the single source of truth - so it is gone from
-- this branch and lives only in today's JSON dump (see preflight 7).
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge"
  DROP COLUMN IF EXISTS "name",
  DROP COLUMN IF EXISTS "iconKey";

-- ---------------------------------------------------------------------
-- DDL 7. The foreign key. Restrict, so deleting a badged skill fails loudly
-- instead of silently emptying the hero. Prisma's onDelete: Restrict with
-- the implicit onUpdate: Cascade, and its constraint name.
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

-- ---------------------------------------------------------------------
-- DDL 8. The indexes. Prisma spells @@unique as a unique index, hence
-- CREATE UNIQUE INDEX rather than ADD CONSTRAINT UNIQUE - a constraint here
-- would show up as drift. version_sortOrder_idx already exists from
-- 20260728120000_add_hero_version and is listed only so the set is complete.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "HeroSkillBadge_version_skillId_key"
  ON "HeroSkillBadge" ("version", "skillId");

CREATE INDEX IF NOT EXISTS "HeroSkillBadge_version_sortOrder_idx"
  ON "HeroSkillBadge" ("version", "sortOrder");

CREATE INDEX IF NOT EXISTS "HeroSkillBadge_skillId_idx"
  ON "HeroSkillBadge" ("skillId");

-- ---------------------------------------------------------------------
-- DDL 9. Remove the scaffolding default on updatedAt. @updatedAt is written
-- by the client; a database default would be drift.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------
-- VERIFICATION. Still inside the transaction, so a bad result can still be
-- rolled back.
-- ---------------------------------------------------------------------

-- V1. Nothing lost, nothing unresolved.
--     Expected: one row, total 14, null_skill 0, labelled 2.
SELECT count(*) AS total,
       count(*) FILTER (WHERE "skillId" IS NULL)   AS null_skill,
       count(*) FILTER (WHERE "label" IS NOT NULL) AS labelled
  FROM "HeroSkillBadge";

-- V2. The hero, as it will now render.
--     Expected: 14 rows, 7 per version. Per version the skills are Next.js,
--     Go, TypeScript, Node.js, React, Prisma, Python; the Go row - and only
--     the Go row - carries label 'Golang', so the chip still reads Golang.
--     (sortOrder values are not asserted: data-facts.txt records the order
--     of the badges, not their numbers.)
SELECT b."version", b."sortOrder", s."name" AS skill, b."label", b."skillId"
  FROM "HeroSkillBadge" b
  JOIN "Skill" s ON s."id" = b."skillId"
 ORDER BY b."version", b."sortOrder";

-- V3. Every label that exists is a real override, i.e. it differs from the
--     skill's own name. A label equal to the skill name would be noise.
--     Expected: 2 rows, both label 'Golang' / skill 'Go'.
SELECT b."version", b."label", s."name" AS skill
  FROM "HeroSkillBadge" b
  JOIN "Skill" s ON s."id" = b."skillId"
 WHERE b."label" IS NOT NULL
   AND b."label" <> s."name"
 ORDER BY b."version";

-- V4. The unique holds in fact as well as in DDL.
--     Expected: 0 rows.
SELECT "version", "skillId", count(*)
  FROM "HeroSkillBadge"
 GROUP BY "version", "skillId"
HAVING count(*) > 1;

-- V5. Columns, for a clean prisma migrate diff.
--     Expected: exactly 7 rows, in this order -
--       id        text            NO   (no default)
--       sortOrder integer         NO   (no default)
--       version   text|SiteVersion NO  default 'v2' (type and default text
--                                      depend on whether 05-site-version ran)
--       skillId   text            NO   (no default)
--       label     text            YES  (no default)
--       createdAt timestamp(3)    NO   default CURRENT_TIMESTAMP
--       updatedAt timestamp(3)    NO   (no default)
--     and no "name" or "iconKey" row. The last four may appear in the order
--     createdAt, updatedAt, skillId, label instead if a timestamps cluster
--     (step 10) added the stamps to this table first; physical column order
--     is not something prisma migrate diff looks at.
SELECT column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name = 'HeroSkillBadge'
 ORDER BY ordinal_position;

-- V6. Index names, exactly as the new Prisma schema expects.
--     Expected: 4 rows -
--       HeroSkillBadge_pkey
--       HeroSkillBadge_skillId_idx
--       HeroSkillBadge_version_skillId_key
--       HeroSkillBadge_version_sortOrder_idx
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = current_schema()
   AND tablename = 'HeroSkillBadge'
 ORDER BY indexname;

-- V7. Constraints. confdeltype 'r' is RESTRICT, confupdtype 'c' is CASCADE.
--     Expected: HeroSkillBadge_pkey (p);
--               HeroSkillBadge_skillId_fkey (f, r, c);
--               HeroSkillBadge_version_skillId_key (u);
--               plus HeroSkillBadge_version_check (c) while 05-site-version
--               has not run yet - that one is step 5's to drop, not this
--               cluster's.
SELECT conname, contype, confdeltype, confupdtype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = '"HeroSkillBadge"'::regclass
 ORDER BY conname;

-- V8. No Skill lost its badges, and the '+N more' denominator is unchanged.
--     Expected: 47 skills, 7 of them badged (6 + Go), 14 badges.
SELECT (SELECT count(*) FROM "Skill")                        AS skills,
       (SELECT count(DISTINCT "skillId") FROM "HeroSkillBadge") AS badged_skills,
       (SELECT count(*) FROM "HeroSkillBadge")               AS badges;

COMMIT;

-- ---------------------------------------------------------------------
-- OPTIONAL, RUN BY HAND, NOT PART OF THE MIGRATION. Proves Restrict bites.
-- Deliberately left commented out: it raises an error on purpose, which
-- would abort the file under psql -v ON_ERROR_STOP=1.
--
--   BEGIN;
--   SAVEPOINT restrict_probe;
--   DELETE FROM "Skill" WHERE "name" = 'Go';
--   -- Expected: ERROR 23503, update or delete on table "Skill" violates
--   -- foreign key constraint "HeroSkillBadge_skillId_fkey" on table
--   -- "HeroSkillBadge".
--   ROLLBACK TO SAVEPOINT restrict_probe;
--   ROLLBACK;
-- ---------------------------------------------------------------------
