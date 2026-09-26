-- =====================================================================
-- CLUSTER hero-badges -- EXPAND
-- Target: PRODUCTION Neon, Postgres 17, role = database owner (not superuser).
-- Run this WITH THE LIVE SITE UP and the CURRENTLY DEPLOYED v1 CODE RUNNING.
--
-- v1 (git HEAD) shape:  HeroSkillBadge(id, name NOT NULL, iconKey NOT NULL,
--                       sortOrder, version TEXT NOT NULL DEFAULT 'v2'
--                       + CHECK version IN ('v1','v2'))
-- v2 target shape:      HeroSkillBadge(id, version SiteVersion, skillId NOT NULL
--                       -> Skill RESTRICT, label TEXT?, sortOrder,
--                       createdAt, updatedAt) + unique(version, skillId)
--
-- WHAT THIS FILE DOES (additive only):
--   + skillId   TEXT NULL         -- nullable on purpose, see NOTE A
--   + label     TEXT NULL
--   + createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
--   + updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP  -- default kept, see NOTE B
--   = name / iconKey KEPT, and given DEFAULT ''                  -- see NOTE C
--   + backfill skillId (12 by name, 2 Golang -> Skill 'Go')
--   + backfill label   (the 2 Golang rows)
--   + index HeroSkillBadge_skillId_idx
--   + temporary BEFORE INSERT/UPDATE bridge trigger              -- see NOTE D
--
-- WHAT IS DELIBERATELY *NOT* HERE (all in hero-badges-contract.sql):
--   - ALTER COLUMN "skillId" SET NOT NULL
--       v1 INSERT omits skillId. apps/docs/app/lib/actions/staging.ts:493-501
--       (git HEAD) writes exactly {name, iconKey, sortOrder, version}. SET NOT
--       NULL here => SQLSTATE 23502 on the next "Add badge" save, and staging
--       runs one interactive transaction per save bar, so the operator's whole
--       batch of unrelated edits rolls back.
--   - ADD CONSTRAINT HeroSkillBadge_skillId_fkey ... ON DELETE RESTRICT
--       Not needed by v2: Prisma resolves `select: { skill: {...} }`
--       (apps/web/app/lib/data.ts:117-121, working tree) with its own join; no
--       database FK is required at runtime. And RESTRICT breaks a v1 write:
--       v1's deleteRow skill branch is a bare tx.skill.deleteMany with no badge
--       count (staging.ts:740-742 in HEAD -- the count guard only exists in v2,
--       staging.ts:800-802 in the working tree), so deleting a badged skill
--       would raise a raw 23503 mid-batch.
--   - CREATE UNIQUE INDEX HeroSkillBadge_version_skillId_key
--       Also not needed by v2: nothing upserts or connectOrCreates on
--       version_skillId, so no statement emits ON CONFLICT ("version","skillId");
--       v2 enforces it in app code (assertBadgeFree, staging.ts:505-516).
--       Adding it here is *nearly* free -- Postgres treats NULLs as distinct, so
--       a window INSERT with skillId NULL never conflicts -- but combined with
--       the bridge trigger below it turns a duplicate v1 badge (permitted today)
--       into a 23505 that rolls back an unrelated batch. Contract.
--   - ALTER COLUMN "updatedAt" DROP DEFAULT
--       v1 has no updatedAt field at all, so its INSERT omits it: dropping the
--       default is 23502 on the next badge create. Contract. (The throwaway
--       draft 25-hero-badges.sql does this at DDL 9 in the same transaction as
--       everything else; on production that one statement is what turns an
--       "additive" migration into a live-write breaker.)
--   - DROP COLUMN "name", "iconKey"
--       Four deployed v1 readers name them explicitly:
--         apps/web/app/lib/data.ts:138-149            (public hero -> 500)
--         apps/docs/app/(dashboard)/hero/page.tsx:12,49
--         apps/docs/app/(dashboard)/icons/page.tsx:9
--         apps/docs/app/lib/actions/staging.ts:137    (audit shadow)
--       => 42703 undefined_column. Contract.
--   - the SiteVersion cast on "version" and the drop of
--     HeroSkillBadge_version_check. Those belong to the hero-enum cluster.
--     Nothing below reads, writes or compares a version literal, so this file
--     is correct whichever side of that cast it runs on.
--
-- NOTE A -- why skillId stays NULLABLE through expand.
--   It cannot be NOT NULL while v1 is deployed (23502, above) and it cannot
--   carry a column default without silently pointing every window-created badge
--   at an arbitrary skill. So it is nullable, the bridge trigger fills it for
--   v1 writes, and contract heals + tightens.
--
-- NOTE B -- createdAt/updatedAt carry DEFAULT CURRENT_TIMESTAMP so the v1
--   INSERT, which lists neither, still satisfies NOT NULL. Prisma's @updatedAt
--   declares no database default, so the default is drift and is dropped in
--   contract, after v2 (which always writes updatedAt) is live.
--   If the settings/timestamps cluster already added these two columns, the
--   IF NOT EXISTS below makes this a no-op -- but re-check that it used a
--   DEFAULT on updatedAt for the same reason.
--
-- NOTE C -- SET DEFAULT '' on name and iconKey is the statement that makes the
--   DEPLOY -> CONTRACT window survivable. Both are TEXT NOT NULL with no
--   default (packages/db/prisma/migrations/20260307195336_init/migration.sql:19-20)
--   and v2's create (staging.ts:537-551, working tree) writes only
--   {skillId, label, sortOrder, version}. Without a default the FIRST badge
--   created after the v2 deploy raises 23502.
--   Chosen over ALTER COLUMN ... DROP NOT NULL on purpose: Vercel keeps the
--   previous deployment alive for in-flight requests, and a v1 lambda that
--   reads a row whose name is NULL gets a null in a required String field and
--   Prisma throws (inconsistent column data) -> 500 on the public hero. With
--   NOT NULL + '' the worst case is an empty chip, and the trigger below fills
--   the real value anyway.
--   Safe for v1: a column default only applies when the column is omitted, and
--   v1 always supplies both.
--
-- NOTE D -- the bridge trigger is a two-way dual-write for the window.
--   v1 write  -> derive skillId (+ label) from name.
--   v2 write  -> derive name/iconKey from the skill (+ label), so a still
--                draining v1 lambda and the v1 audit shadow keep reading sane
--                values until contract.
--   It NEVER raises: the body ends in EXCEPTION WHEN OTHERS THEN RETURN NEW, so
--   no v1 save can fail because of it. Every consequence it can leave behind
--   (a NULL skillId, a duplicate (version, skillId)) is caught by a hard guard
--   in hero-badges-contract.sql, so this fails quiet here and loud there.
--   It is created LAST, after the backfill: if it existed during the backfill,
--   the "skillId changed" branch would rewrite name/iconKey from the Skill row
--   and clobber the live v1 hero mid-transaction.
--
-- LOCKING. Every ALTER TABLE takes ACCESS EXCLUSIVE, which blocks even SELECT
--   while it is held AND queues new SELECTs behind it while it waits. On 14
--   rows the work is microseconds; the only real risk is the wait. lock_timeout
--   below makes this transaction give up rather than stall the public hero.
--
-- CODE HALF, required in the same git push as the v2 code (nothing to do with
--   this SQL, but the deploy fails without it): the generated Prisma client is
--   gitignored (.gitignore:34, **/generated/prisma) and prisma generate is not
--   in the build graph. Fix, exactly:
--     1. packages/db/package.json -> "scripts": add "build": "prisma generate".
--        turbo's build task is dependsOn ["^build"], and package "db" has no
--        build script today, so the client is never generated.
--     2. packages/db/turbo.json (new file):
--        { "extends": ["//"], "tasks": { "build": { "outputs": ["src/generated/prisma/**"] } } }
--        (generator output is ../src/generated/prisma; a package-local override
--        keeps the root task's ".next/**" outputs out of this package.)
--     3. No env needed: the v2 datasource block declares no url, so
--        prisma generate needs no DATABASE_URL.
--     4. Only AFTER that deploy is green, simplify the Vercel dashboard's
--        custom install/build command back to the default. Until then the
--        dashboard command runs generate twice, which is idempotent.
--
-- BEFORE YOU START: re-take the dump. It is the only undo for iconKey.
--     cd packages/db && bun run db:dump --from=PROD_DATABASE_URL
-- =====================================================================


-- =====================================================================
-- PART 0 -- READ-ONLY PREFLIGHT. Run this alone, read the output, keep it.
-- Nothing here writes. Safe to run against live production at any time.
-- =====================================================================

-- P1. Shape today. Expected: v1 = 7, v2 = 7 (14 total).
SELECT "version", count(*) AS badges
  FROM "HeroSkillBadge"
 GROUP BY "version"
 ORDER BY "version";

-- P2. The two columns this cluster eventually destroys, printed for the log.
--     Expected 14 rows; per version: Next.js/Next.js, Golang/Go,
--     TypeScript/TypeScript, Node.js/Node.js, React/React, Prisma/Prisma,
--     Python/Python  (data-facts.txt "HeroSkillBadge -> Skill match check").
SELECT "version", "sortOrder", "name", "iconKey", "id"
  FROM "HeroSkillBadge"
 ORDER BY "version", "sortOrder";

-- P3. Skill.name is not unique yet in production (Skill_name_key arrives with
--     the skills cluster). An ambiguous lower(name) would make the backfill
--     pick a skill arbitrarily. Expected: 0 rows ("lower() duplicates: none").
SELECT lower("name") AS lowered, count(*) AS skills
  FROM "Skill"
 GROUP BY lower("name")
HAVING count(*) > 1;

-- P4. The Golang override target. Expected: exactly 1 row, name 'Go'.
SELECT "id", "name", "iconKey" FROM "Skill" WHERE "name" = 'Go';

-- P5. Every existing badge resolves, once Golang is allowed for.
--     Expected: 0 rows. Any row here MUST be fixed before expand, because
--     after the v2 deploy that row makes the public hero throw (v2 reads the
--     required relation, apps/web/app/lib/data.ts:117-121).
SELECT b."version", b."sortOrder", b."name", b."iconKey"
  FROM "HeroSkillBadge" b
  LEFT JOIN "Skill" s ON lower(s."name") = lower(b."name")
 WHERE s."id" IS NULL
   AND lower(b."name") <> 'golang';

-- P6. No two badges in one version collapse onto one skill.
--     Expected: 0 rows. ('Go' is not badged under its own name anywhere, so
--     folding Golang onto it collides with nothing.)
WITH mapped AS (
  SELECT b."id", b."version",
         COALESCE(s."id", g."id") AS "skillId"
    FROM "HeroSkillBadge" b
    LEFT JOIN "Skill" s ON lower(s."name") = lower(b."name")
    LEFT JOIN "Skill" g ON lower(b."name") = 'golang' AND g."name" = 'Go'
)
SELECT "version", "skillId", count(*) AS badges
  FROM mapped
 GROUP BY "version", "skillId"
HAVING count(*) > 1;

-- P7. ICON DRIFT -- the one answer data-facts.txt cannot give (it lists Skill
--     names but no Skill.iconKey). READ THIS AND RECORD IT.
--     The live hero is v1 (SiteConfig heroVersion = 'v1') and it draws
--     skillIconMap[skill.iconKey] (apps/web/app/components/landing/Hero.tsx:89
--     in HEAD). After the v2 deploy the chip's icon comes from Skill.iconKey
--     instead. 0 rows => dropping "iconKey" in contract loses no rendered
--     pixel. Any rows => those icons change at the next ISR regeneration after
--     the deploy, and the contract DROP makes the old value unrecoverable from
--     the database (only the JSON dump has it).
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

-- P8. Names that will be preserved in "label".
--     Expected: 2 rows, both 'Golang' -> 'Go', one per version.
SELECT b."version", b."name" AS badge_name, s."name" AS skill_name
  FROM "HeroSkillBadge" b
  JOIN "Skill" s
    ON s."id" = COALESCE(
         (SELECT x."id" FROM "Skill" x WHERE lower(x."name") = lower(b."name")),
         (SELECT y."id" FROM "Skill" y WHERE lower(b."name") = 'golang' AND y."name" = 'Go')
       )
 WHERE b."name" <> s."name"
 ORDER BY b."version", b."sortOrder";


-- =====================================================================
-- PART 1 -- THE EXPAND TRANSACTION. One BEGIN/COMMIT. Every statement is
-- transactional: no CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD VALUE,
-- no VACUUM, no superuser powers (no session_replication_role, no DISABLE
-- TRIGGER, no CREATE EXTENSION; plpgsql is already present).
-- Abort at any point = ROLLBACK = production is exactly as it was.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout      = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------
-- GUARD 1. Ambiguous Skill.name would make the backfill non-deterministic.
-- ---------------------------------------------------------------------
DO $guard_ambiguous$
DECLARE dupes integer;
BEGIN
  SELECT count(*) INTO dupes
    FROM (SELECT 1 FROM "Skill" GROUP BY lower("name") HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'hero-badges expand aborted: % case-insensitive duplicate Skill name group(s); the backfill would pick a skill arbitrarily. Nothing changed.',
      dupes;
  END IF;
END
$guard_ambiguous$;

-- ---------------------------------------------------------------------
-- E1. The four new columns. skillId nullable (NOTE A). Stamps defaulted
--     (NOTE B).
--     v1 after this statement: WORKS. Prisma Client never issues SELECT *; the
--     deployed v1 client emits an explicit column list built from the schema it
--     was generated against, so it cannot see these columns. Its INSERT omits
--     all four: skillId/label take NULL, the stamps take their defaults.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge"
  ADD COLUMN IF NOT EXISTS "skillId"   TEXT,
  ADD COLUMN IF NOT EXISTS "label"     TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------
-- E2. Defaults on the two doomed columns, so the v2 INSERT that omits them
--     does not hit 23502 between DEPLOY and CONTRACT (NOTE C).
--     v1 after this statement: WORKS. v1 always supplies name and iconKey
--     (staging.ts:495-496), so the default is dead code for v1. No existing
--     row changes; SET DEFAULT is catalog-only, no rewrite.
-- ---------------------------------------------------------------------
ALTER TABLE "HeroSkillBadge"
  ALTER COLUMN "name"    SET DEFAULT '',
  ALTER COLUMN "iconKey" SET DEFAULT '';

-- ---------------------------------------------------------------------
-- E3. Backfill skillId by case-insensitive name. 12 of 14.
--     v1 after this statement: WORKS. Touches only a column v1 cannot see.
--     Row locks are held for the length of this transaction; a concurrent v1
--     UPDATE of the same badge waits, it does not fail. 14 rows.
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(s."name") = lower(b."name");

-- ---------------------------------------------------------------------
-- E4. The Golang override: 2 of 14 point at Skill 'Go'.
--     v1 after this statement: WORKS (same reason as E3).
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "skillId" = s."id"
  FROM "Skill" s
 WHERE b."skillId" IS NULL
   AND lower(b."name") = 'golang'
   AND s."name" = 'Go';

-- ---------------------------------------------------------------------
-- E5. Preserve any rendered name that differs from the skill it now points
--     at, so v2's `label ?? skill.name` still prints 'Golang' and no second,
--     hidden Skill has to be minted. Today: exactly the two Golang rows.
--     v1 after this statement: WORKS (label is invisible to v1's SELECT; note
--     that v1's audit labelFor does fall through to pick("name","title","label")
--     in apps/docs/app/lib/audit.ts:92, but "name" wins and, more to the point,
--     v1's readRows shadow never selects "label" at all).
-- ---------------------------------------------------------------------
UPDATE "HeroSkillBadge" b
   SET "label" = b."name"
  FROM "Skill" s
 WHERE s."id" = b."skillId"
   AND b."label" IS NULL
   AND b."name" <> s."name";

-- ---------------------------------------------------------------------
-- GUARD 2. Every PRE-EXISTING row must now resolve. If one does not, the v2
-- deploy would 500 the public hero on it, so abort instead: the fix is to
-- create the missing Skill (or correct the badge name) in the v1 admin first.
-- Window-created rows are a different problem and are handled by the trigger
-- at E7 plus the heal in hero-badges-contract.sql.
-- ---------------------------------------------------------------------
DO $guard_resolved$
DECLARE
  unresolved integer;
  collisions integer;
  total      integer;
  sample     text;
BEGIN
  SELECT count(*) INTO unresolved FROM "HeroSkillBadge" WHERE "skillId" IS NULL;
  IF unresolved > 0 THEN
    SELECT string_agg(format('%s/%s', "version", "name"), ', ')
      INTO sample
      FROM "HeroSkillBadge" WHERE "skillId" IS NULL;
    RAISE EXCEPTION
      'hero-badges expand aborted: % badge(s) do not resolve to a Skill (%). After the v2 deploy those rows throw on the public hero. Nothing changed.',
      unresolved, sample;
  END IF;

  SELECT count(*) INTO collisions
    FROM (SELECT 1 FROM "HeroSkillBadge" GROUP BY "version", "skillId" HAVING count(*) > 1) c;
  IF collisions > 0 THEN
    RAISE EXCEPTION
      'hero-badges expand aborted: % duplicate (version, skillId) group(s); two differently-named badges collapsed onto one skill and would render twice. Nothing changed.',
      collisions;
  END IF;

  SELECT count(*) INTO total FROM "HeroSkillBadge";
  IF total <> 14 THEN
    RAISE WARNING
      'note: HeroSkillBadge holds % rows, not the 14 in data-facts.txt; both guards still passed',
      total;
  END IF;
END
$guard_resolved$;

-- ---------------------------------------------------------------------
-- E6. The plain lookup index from the v2 schema (@@index([skillId])).
--     A non-unique index constrains nothing, so it cannot reject any write.
--     CREATE INDEX takes SHARE: it blocks concurrent writes, never SELECT.
--     14 rows, so CONCURRENTLY is pointless and would have to leave this
--     transaction.
--     v1 after this statement: WORKS.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "HeroSkillBadge_skillId_idx"
  ON "HeroSkillBadge" ("skillId");

-- ---------------------------------------------------------------------
-- E7. THE BRIDGE TRIGGER (NOTE D). Created last, on purpose.
--     v1 after this statement: WORKS, and works BETTER -- a badge created or
--     renamed in the window now also gets a skillId, so it survives the deploy.
--     The function never raises.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "_migr_hero_badge_bridge"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  hit_id   text;
  hit_name text;
  hit_icon text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."skillId" IS NULL THEN
      -- a v1 INSERT: name/iconKey are authoritative, derive skillId + label
      SELECT s."id", s."name", s."iconKey" INTO hit_id, hit_name, hit_icon
        FROM "Skill" s
       WHERE lower(s."name") = lower(COALESCE(NEW."name", ''))
       ORDER BY s."id" LIMIT 1;
      IF hit_id IS NULL AND lower(COALESCE(NEW."name", '')) = 'golang' THEN
        SELECT s."id", s."name", s."iconKey" INTO hit_id, hit_name, hit_icon
          FROM "Skill" s WHERE s."name" = 'Go' ORDER BY s."id" LIMIT 1;
      END IF;
      IF hit_id IS NOT NULL THEN
        NEW."skillId" := hit_id;
        IF NEW."label" IS NULL AND NEW."name" IS DISTINCT FROM hit_name THEN
          NEW."label" := NEW."name";
        END IF;
      ELSE
        -- unresolvable free-text name (the v1 badge dialog allows any string,
        -- apps/docs/app/(dashboard)/hero/badges-table.tsx). Keep the text in
        -- "label" so nothing is lost; skillId stays NULL and the contract
        -- guard will name this row instead of silently guessing.
        NEW."label" := COALESCE(NEW."label", NEW."name");
      END IF;
    ELSE
      -- a v2 INSERT: skillId/label are authoritative, keep the v1 copy sane
      SELECT s."name", s."iconKey" INTO hit_name, hit_icon
        FROM "Skill" s WHERE s."id" = NEW."skillId";
      IF hit_name IS NOT NULL THEN
        IF COALESCE(NEW."name", '') = '' THEN
          NEW."name" := COALESCE(NULLIF(NEW."label", ''), hit_name);
        END IF;
        IF COALESCE(NEW."iconKey", '') = '' THEN
          NEW."iconKey" := hit_icon;
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW."skillId" IS DISTINCT FROM OLD."skillId" AND NEW."skillId" IS NOT NULL THEN
    -- a v2 skill change: refresh the v1 copy
    SELECT s."name", s."iconKey" INTO hit_name, hit_icon
      FROM "Skill" s WHERE s."id" = NEW."skillId";
    IF hit_name IS NOT NULL THEN
      NEW."name"    := COALESCE(NULLIF(NEW."label", ''), hit_name);
      NEW."iconKey" := hit_icon;
    END IF;

  ELSIF NEW."name" IS DISTINCT FROM OLD."name" THEN
    -- a v1 rename (staging.ts:610-616): re-resolve skillId
    SELECT s."id", s."name", s."iconKey" INTO hit_id, hit_name, hit_icon
      FROM "Skill" s
     WHERE lower(s."name") = lower(COALESCE(NEW."name", ''))
     ORDER BY s."id" LIMIT 1;
    IF hit_id IS NULL AND lower(COALESCE(NEW."name", '')) = 'golang' THEN
      SELECT s."id", s."name", s."iconKey" INTO hit_id, hit_name, hit_icon
        FROM "Skill" s WHERE s."name" = 'Go' ORDER BY s."id" LIMIT 1;
    END IF;
    IF hit_id IS NOT NULL THEN
      NEW."skillId" := hit_id;
      NEW."label"   := CASE WHEN NEW."name" IS DISTINCT FROM hit_name
                            THEN NEW."name" ELSE NULL END;
    ELSE
      -- renamed to something with no Skill. Keep the OLD skillId so the row
      -- stays readable by v2 (a wrong icon beats a 500) and carry the new text
      -- in "label" so v2's `label ?? skill.name` still prints what the
      -- operator typed.
      NEW."label" := NEW."name";
    END IF;

  ELSIF NEW."label" IS DISTINCT FROM OLD."label" AND NEW."skillId" IS NOT NULL THEN
    -- a v2 label-only edit: keep the v1 copy in step
    SELECT s."name" INTO hit_name FROM "Skill" s WHERE s."id" = NEW."skillId";
    IF hit_name IS NOT NULL THEN
      NEW."name" := COALESCE(NULLIF(NEW."label", ''), hit_name);
    END IF;
  END IF;

  -- v1 never writes updatedAt (reorder is a bare updateMany on sortOrder,
  -- staging.ts:770-772), so keep the stamp honest during the window.
  IF NEW."updatedAt" IS NOT DISTINCT FROM OLD."updatedAt" THEN
    NEW."updatedAt" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- a live admin save must never fail because of migration scaffolding
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "_migr_hero_badge_bridge" ON "HeroSkillBadge";
CREATE TRIGGER "_migr_hero_badge_bridge"
  BEFORE INSERT OR UPDATE ON "HeroSkillBadge"
  FOR EACH ROW EXECUTE FUNCTION "_migr_hero_badge_bridge"();


-- ---------------------------------------------------------------------
-- VERIFICATION, still inside the transaction so a bad answer can still be
-- rolled back.
-- ---------------------------------------------------------------------

-- V1. Nothing lost, nothing unresolved.
--     Expected ONE row: total 14, null_skill 0, labelled 2.
SELECT count(*)                                     AS total,
       count(*) FILTER (WHERE "skillId" IS NULL)     AS null_skill,
       count(*) FILTER (WHERE "label" IS NOT NULL)   AS labelled
  FROM "HeroSkillBadge";

-- V2. THE V1-STILL-WORKS PROOF. This is the exact column list the deployed v1
--     Prisma client emits for prisma.heroSkillBadge.findMany().
--     Expected: 14 rows, no error, every name/iconKey byte-identical to P2.
SELECT "id", "name", "iconKey", "sortOrder", "version"
  FROM "HeroSkillBadge"
 ORDER BY "version", "sortOrder";

-- V3. The hero as v2 will render it.
--     Expected 14 rows, 7 per version: Next.js, Go, TypeScript, Node.js,
--     React, Prisma, Python -- and only the Go row carries label 'Golang'.
SELECT b."version", b."sortOrder", s."name" AS skill, b."label", b."skillId"
  FROM "HeroSkillBadge" b
  JOIN "Skill" s ON s."id" = b."skillId"
 ORDER BY b."version", b."sortOrder";

-- V4. The defaults that keep v2's INSERT legal after the deploy.
--     Expected 2 rows: name ''::text, iconKey ''::text -- and updatedAt must
--     still show a default here (it is dropped in contract, not now).
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name = 'HeroSkillBadge'
   AND column_name IN ('name','iconKey','skillId','label','createdAt','updatedAt')
 ORDER BY column_name;

-- V5. What must NOT exist yet. Expected exactly 3 indexes --
--     HeroSkillBadge_pkey, HeroSkillBadge_skillId_idx,
--     HeroSkillBadge_version_sortOrder_idx -- and NO
--     HeroSkillBadge_version_skillId_key, and no *_skillId_fkey in
--     pg_constraint. Both arrive in contract.
SELECT indexname FROM pg_indexes
 WHERE schemaname = current_schema() AND tablename = 'HeroSkillBadge'
 ORDER BY indexname;
SELECT conname, contype FROM pg_constraint
 WHERE conrelid = '"HeroSkillBadge"'::regclass ORDER BY conname;

-- V6. The bridge is armed. Expected 1 row: _migr_hero_badge_bridge, O (enabled).
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = '"HeroSkillBadge"'::regclass AND NOT tgisinternal;

COMMIT;


-- =====================================================================
-- OPTIONAL POST-COMMIT PROBE. Proves the bridge actually bridges, using the
-- exact INSERT the deployed v1 client emits. Writes, then ROLLS BACK -- run it
-- as one paste, or not at all.
--
--   BEGIN;
--   INSERT INTO "HeroSkillBadge" ("id","name","iconKey","sortOrder","version")
--   VALUES ('probe-0000-0000-0000-000000000000','Docker','Docker',900,'v1');
--   -- Expected: 1 row, skillId = the Docker skill, label NULL,
--   --           createdAt/updatedAt set.
--   SELECT "name","iconKey","skillId","label","createdAt","updatedAt"
--     FROM "HeroSkillBadge" WHERE "id" = 'probe-0000-0000-0000-000000000000';
--   -- And the v1 rename path:
--   UPDATE "HeroSkillBadge" SET "name" = 'Golang'
--    WHERE "id" = 'probe-0000-0000-0000-000000000000';
--   -- Expected: skillId = Skill 'Go', label = 'Golang'.
--   SELECT "name","skillId","label" FROM "HeroSkillBadge"
--    WHERE "id" = 'probe-0000-0000-0000-000000000000';
--   ROLLBACK;
-- =====================================================================


-- =====================================================================
-- ROLLBACK OF EXPAND (after COMMIT). Fully reversible, no data loss: "name"
-- and "iconKey" were never touched. Run as one transaction.
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DROP TRIGGER IF EXISTS "_migr_hero_badge_bridge" ON "HeroSkillBadge";
--   DROP FUNCTION IF EXISTS "_migr_hero_badge_bridge"();
--   DROP INDEX IF EXISTS "HeroSkillBadge_skillId_idx";
--   ALTER TABLE "HeroSkillBadge"
--     ALTER COLUMN "name"    DROP DEFAULT,
--     ALTER COLUMN "iconKey" DROP DEFAULT,
--     DROP COLUMN IF EXISTS "skillId",
--     DROP COLUMN IF EXISTS "label",
--     DROP COLUMN IF EXISTS "createdAt",
--     DROP COLUMN IF EXISTS "updatedAt";
--   COMMIT;
--
-- Caveat: if the settings/timestamps cluster also wants createdAt/updatedAt on
-- this table, do not drop them here -- drop only skillId and label.
-- =====================================================================
