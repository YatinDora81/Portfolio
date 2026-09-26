-- ============================================================================
-- PRODUCTION CUTOVER · cluster "settings" · EXPAND
-- SiteConfig (26 key/value rows)  ->  SiteSettings (one typed row, id = 1)
--
-- RUN THIS WITH THE LIVE SITE UP. Nothing here removes or retypes anything the
-- currently deployed v1 code touches.
--
-- Target: Postgres 17 on Neon, connected as the database OWNER (not superuser).
-- Nothing below needs superuser: no session_replication_role, no CREATE
-- EXTENSION, no ALTER SYSTEM. CREATE TYPE / CREATE TABLE / CREATE FUNCTION /
-- CREATE TRIGGER on an owned table are all owner-level.
--
-- ----------------------------------------------------------------------------
-- WHY EVERY STATEMENT IS SAFE WHILE v1 IS SERVING
-- ----------------------------------------------------------------------------
-- The v1 code (git HEAD) touches "SiteConfig" in exactly six places:
--
--   READ   HEAD:apps/web/app/lib/data.ts:72          prisma.siteConfig.findMany()
--          HEAD:apps/docs/app/(dashboard)/site-config/page.tsx:17
--          HEAD:apps/docs/app/(dashboard)/background/page.tsx:10
--          HEAD:apps/docs/app/(dashboard)/cat/page.tsx:65
--          HEAD:apps/docs/app/(dashboard)/contact-purposes/page.tsx:15
--          HEAD:apps/docs/app/(dashboard)/hero/page.tsx:15
--          HEAD:apps/docs/app/(dashboard)/projects/page.tsx:37
--          HEAD:apps/docs/app/(dashboard)/about/page.tsx:31
--          HEAD:apps/docs/app/lib/media-references.ts:25
--   WRITE  HEAD:apps/docs/app/lib/actions/site-config.ts:104-111   upsert/update
--          HEAD:apps/docs/app/lib/actions/links.ts:11-15           resumeUrl upsert
--
-- Every one of those is SELECT id,key,value / INSERT (key,value) / UPDATE value
-- on "SiteConfig". This file:
--   * adds two enum TYPES that no v1 column uses,
--   * adds one TABLE that no v1 query names,
--   * adds ten CHECKs to that new table only,
--   * SELECTs "SiteConfig" (ACCESS SHARE — does not block a reader or a writer),
--   * adds one statement-level AFTER trigger to "SiteConfig".
-- No column on "SiteConfig" is added, dropped, retyped, renamed, defaulted or
-- made NOT NULL, so no v1 SELECT loses a column and no v1 INSERT loses a
-- default. v1 never mentions "SiteSettings", so the new NOT NULL columns and
-- the new CHECKs are unreachable from v1 and cannot break a v1 write.
--
-- The one statement that touches an existing object's BEHAVIOUR is the trigger
-- in STEP B. It is additive: it does not change what a v1 write stores in
-- "SiteConfig", it only mirrors that write into "SiteSettings" so the write is
-- not lost at DEPLOY. See the note above STEP B for its failure modes.
--
-- ----------------------------------------------------------------------------
-- "HEAD:" AND "git HEAD" IN THIS FILE MEAN COMMIT 0050cc9.
-- ----------------------------------------------------------------------------
-- Every v1 citation in this file was written when 0050cc9 was the tip. The v2
-- work has since been committed, so `git HEAD` is f760425 and `git show
-- HEAD:<path>` returns the v2 file — which for this cluster means the OPPOSITE of
-- what the citation intends: the v2 tree has no `prisma.siteConfig` call at all.
-- Read every v1 claim with `git show 0050cc9:<path>` and nothing else. 0050cc9 is
-- what Vercel is serving while STEP B's trigger is installed. Working-tree/v2
-- paths are cited bare, with no prefix.
--
-- ----------------------------------------------------------------------------
-- V1 EVIDENCE RE-VERIFIED AT 0050cc9        (spot check 5 of 5, 2026-09-27)
--
-- WHY THIS FILE IS ONE OF THE FIVE. STEP B is the only statement in the entire
-- EXPAND that installs a TRIGGER on a table the DEPLOYED code writes. Every other
-- EXPAND statement is invisible to v1 by construction — Prisma never names a
-- column it does not know about. A trigger is different: it runs INSIDE the v1
-- write's transaction, and if the function it calls raises, the v1 write fails.
-- Nothing about Prisma's column lists protects against that.
--
-- RE-CHECKED WITH `git show 0050cc9:<path>`, NOT by reading the working tree:
--
--  1. THE BLAST RADIUS OF A RAISING TRIGGER IS THE WHOLE ADMIN SAVE, NOT ONE ROW.
--     CONFIRMED, and it is worse than "one setting fails to save":
--       0050cc9:apps/docs/app/lib/actions/site-config.ts:104-111
--         await prisma.$transaction([ ...clean.map(siteConfig.upsert),
--                                     ...unclaimed.map(siteConfig.update) ])
--     One interactive transaction carrying every changed setting. The trigger is
--     AFTER ... FOR EACH STATEMENT, so it fires once per upsert inside that
--     transaction — twenty-odd times on a full save — and a single raise aborts
--     the transaction, so NO setting is stored and the admin sees a raw Prisma
--     P2010. The second v1 writer is a single-statement upsert and fails alone:
--       0050cc9:apps/docs/app/lib/actions/links.ts:11-15  resumeUrl upsert
--     This is the argument for the file's own "skip STEP B and freeze instead"
--     escape hatch, and the reason that hatch is offered rather than buried.
--
--  2. THE PUBLIC SITE IS NOT EXPOSED TO IT, because the public path is read-only.
--     CONFIRMED:
--       0050cc9:apps/web/app/layout.tsx:69   getSiteConfig(), in the ROOT layout
--       0050cc9:apps/web/app/lib/data.ts:70-72  readSiteConfig() ->
--                                               prisma.siteConfig.findMany()
--     A statement-level AFTER INSERT/UPDATE/DELETE trigger cannot fire on a
--     SELECT, so no public request can reach the function no matter how badly it
--     is written. What the public IS exposed to is the CREATE TRIGGER's ACCESS
--     EXCLUSIVE lock on "SiteConfig" — and that read is uncached
--     (`readSiteConfig` is wrapped by unstable_cache, but an ISR regeneration
--     still executes it) and UNCAUGHT: unlike getFlags, there is no try/catch and
--     no fallback, so data.ts:70 is the one public database read in the whole app
--     that turns a database problem into a 500 on every route. That is why STEP B
--     is alone in its own one-statement transaction, last, under lock_timeout.
--
--  3. THE FUNCTION CANNOT RAISE ON THE DATA IT WILL ACTUALLY SEE, which is the
--     substance behind item 1's reassurance. Confirmed by reading STEP A's
--     resync body against v1's value space: every numeric is clamped into its
--     CHECK range, heroDotColor is regex-guarded to '' on a miss, catNapStyle is
--     coerced to a label, and heroPhotos is filtered to non-blank newline-free
--     elements — and v1's own reader does the same clamping in TypeScript
--     (0050cc9:apps/web/app/lib/data.ts:65-68 clampedInt, :82-85 the
--     catNapSeconds clamp, :81 the CAT_NAP_STYLES membership test), so the two
--     sides agree on what a legal value is. A missing "SiteSettings" row makes the
--     resync a 0-row no-op rather than an error, and A6 has already created it.
--
--  4. NO RECURSION IS POSSIBLE. CONFIRMED by grep at 0050cc9: v1 contains no
--     writer of "SiteSettings" at all — the table does not exist at that commit —
--     so the trigger's UPDATE cannot re-enter "SiteConfig". No pg_trigger_depth()
--     guard is needed, and adding one would only hide a future cycle.
--
-- VERDICT: every statement in this file is safe against the code actually
-- deployed at 0050cc9. Nothing in the argument needed correcting; only the
-- `HEAD:` labels did. Note separately that this file's PREREQUISITE THAT IS NOT
-- SQL section below is now stale in a harmless direction: its three build edits
-- were committed in 83743d2 and 6493c8f. RUNBOOK Step 4 is the live version of
-- that list and it has five edits, not three.
-- ----------------------------------------------------------------------------
--
-- ----------------------------------------------------------------------------
-- PREREQUISITE THAT IS NOT SQL — do this BEFORE the deploy half
-- ----------------------------------------------------------------------------
-- A clean clone cannot build today: **/generated/prisma is gitignored, and
-- `db:generate` is in no turbo task (turbo.json tasks.build.dependsOn is only
-- ["^build"]). Production deploys only because the Vercel dashboard carries an
-- invisible custom command. Wire it into the graph, in three edits:
--
--   1. packages/db/package.json  scripts:  add  "build": "prisma generate"
--   2. NEW FILE packages/db/turbo.json:
--        { "extends": ["//"],
--          "tasks": { "build": { "inputs": ["prisma/schema.prisma",
--                                           "prisma.config.ts"],
--                                "outputs": ["src/generated/prisma/**"] } } }
--      (a package-level override; the root build task declares .next/** as its
--       output, which is wrong for packages/db)
--   3. turbo.json  tasks."check-types".dependsOn: add "^build"
--      (apps/*/check-types runs `tsc --noEmit` against the generated client)
--
-- apps/web and apps/docs already declare `build: next build` and depend on `db`,
-- and the root build task already has dependsOn ["^build"], so with edit 1+2
-- `turbo run build --filter=web` generates the client first. Belt, so that
-- `git clone && bun install` alone is enough: add to the ROOT package.json
--   "postinstall": "bun run --cwd packages/db db:generate"
-- Keep the dashboard's custom command for the first deploy, confirm the build
-- log shows the generate step coming from turbo, then remove it.
--
-- ----------------------------------------------------------------------------
-- HOW TO RUN
-- ----------------------------------------------------------------------------
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f settings-expand.sql
-- Two transactions. STEP A is the schema + backfill. STEP B is the dual-write
-- trigger and takes a brief ACCESS EXCLUSIVE lock on "SiteConfig", which is on
-- the render path of every public page, so it is deliberately last, alone, and
-- under a lock_timeout.
--
-- Both steps are re-runnable, before or after a failed attempt, any number of
-- times, while v1 is deployed. STEP B's resync call is the pre-deploy gate:
-- run `SELECT public.site_settings_resync_v2();` again immediately before you
-- push the deploy and expect 0.
--
-- AFTER v2 IS LIVE, DO NOT RUN ANY PART OF THIS FILE AGAIN. The resync copies
-- "SiteConfig" over "SiteSettings", and after DEPLOY "SiteConfig" is the stale
-- side; a resync then silently reverts every setting the admin changed on v2.
-- CONTRACT removes the function so this cannot happen by accident.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT  (read-only; run first, read every answer)
-- ############################################################################

-- P1. Source present with the 26 rows the dump saw; target absent.
SELECT
  (SELECT count(*) FROM "SiteConfig")              AS site_config_rows,
  to_regclass('public."SiteConfig"')   IS NOT NULL AS source_present,
  to_regclass('public."SiteSettings"') IS NULL     AS target_absent;
-- expect: 26 / t / t

-- P2. Exactly the 26 keys this migration knows how to place: 23 carried + the
--     3 legacy ones. A row here is either a key with nowhere to go, or a
--     carried key whose absence would let the column take a schema default.
SELECT coalesce(e."key", c."key") AS "key",
       (e."key" IS NULL) AS unexpected_in_db,
       (c."key" IS NULL) AS missing_from_db
FROM unnest(ARRAY[
  'name','avatarUrl','heroPhotos','resumeUrl',
  'projectsVersion','backgroundVersion','heroDotColor','heroDotPulse',
  'navbarLogo','copyrightName',
  'contactEmail','availabilityStatus','availabilityDetail',
  'terrainStrength','terrainVeil','terrainCell','terrainLevels',
  'terrainMinor','terrainMajor','terrainChannel','terrainInteractive',
  'catNapStyle','catNapSeconds',
  'heroVersion','intro','tagline'
]) AS e("key")
FULL OUTER JOIN "SiteConfig" c ON c."key" = e."key"
WHERE e."key" IS NULL OR c."key" IS NULL;
-- expect: 0 rows

-- P3. Everything that has to coerce, coerces without moving. One row per
--     offender; 0 rows means the backfill provably re-encodes rather than
--     re-decides. Ranges are NUMBER_RANGE in
--     HEAD:apps/docs/app/lib/site-config-keys.ts:195-203; the hex pattern and
--     the eight nap labels are HEAD:apps/docs/app/lib/actions/site-config.ts:33-37.
SELECT c."key", c."value", 'unparseable or out of CHECK range' AS problem
FROM "SiteConfig" c
JOIN (VALUES ('catNapSeconds',3,300),('terrainStrength',10,100),('terrainVeil',0,90),
             ('terrainCell',8,28),('terrainLevels',4,24),('terrainMinor',2,60),
             ('terrainMajor',5,90)) AS r("key",lo,hi) ON r."key" = c."key"
WHERE CASE WHEN pg_input_is_valid(btrim(c."value"), 'integer')
             THEN btrim(c."value")::int NOT BETWEEN r.lo AND r.hi
           ELSE true END
UNION ALL
SELECT "key", "value", 'boolean key not on/off' FROM "SiteConfig"
WHERE "key" IN ('heroDotPulse','terrainChannel','terrainInteractive')
  AND "value" NOT IN ('on','off')
UNION ALL
SELECT "key", "value", 'nap style outside the eight labels' FROM "SiteConfig"
WHERE "key" = 'catNapStyle'
  AND lower(btrim("value")) NOT IN
      ('tooltip','ring','halo','pixel','moon','ticks','random','off')
UNION ALL
SELECT "key", "value", 'version key not v1/v2' FROM "SiteConfig"
WHERE "key" IN ('projectsVersion','backgroundVersion') AND "value" NOT IN ('v1','v2')
UNION ALL
SELECT "key", "value", 'heroDotColor not empty and not hex' FROM "SiteConfig"
WHERE "key" = 'heroDotColor' AND btrim("value") <> ''
  AND btrim("value") !~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$';
-- expect: 0 rows
-- (production per data-facts.txt: catNapSeconds 45, strength 45, veil 52,
--  cell 16, levels 15, minor 18, major 51, all three booleans 'on',
--  catNapStyle 'moon', projectsVersion 'v2', backgroundVersion 'v2',
--  heroDotColor '#22C55E')

-- P4. The heroPhotos split, inspected before it lands. The photo editor writes
--     a lone space as its encoding for a blank row, which the new CHECK forbids.
SELECT c."value" AS raw,
       ARRAY(SELECT btrim(u.x)
             FROM unnest(string_to_array(c."value", ',')) WITH ORDINALITY AS u(x, ord)
             WHERE btrim(u.x) <> '' AND u.x !~ E'[\n\r]'
             ORDER BY u.ord) AS "heroPhotos"
FROM "SiteConfig" c WHERE c."key" = 'heroPhotos';
-- expect: raw = '/mine/avatar.png,/mine/avatar2.jpeg'
--         heroPhotos = {/mine/avatar.png,/mine/avatar2.jpeg}   (2, in order)

-- P5. The three legacy keys have somewhere else to be, which is the only reason
--     they are allowed to die with the table in CONTRACT.
--     HEAD:apps/web/app/lib/data.ts:76-79 derives the served hero version from
--     HeroContent.live and takes intro/tagline off that row, ignoring the
--     SiteConfig rows entirely. heroVersion says 'v1' while HeroContent.live is
--     on the v2 row, so the legacy row is not merely redundant, it is wrong.
SELECT (SELECT count(*) FROM "HeroContent")                                AS hero_rows,
       (SELECT count(*) FROM "HeroContent" WHERE btrim("intro")   <> '')   AS intro_present,
       (SELECT count(*) FROM "HeroContent" WHERE btrim("tagline") <> '')   AS tagline_present,
       (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live')          AS live_rows,
       (SELECT "version" FROM "HeroContent" WHERE "live" = 'live')         AS live_version,
       (SELECT "value" FROM "SiteConfig" WHERE "key" = 'heroVersion')      AS legacy_hero_version;
-- expect: 2 / 2 / 2 / 1 / 'v2' / 'v1'

-- P6. Which enum types already exist. "SiteVersion" is shared with the
--     version-column cluster; either order is fine, both create it guarded.
SELECT to_regtype('"SiteVersion"') IS NOT NULL AS site_version_exists,
       to_regtype('"CatNapStyle"') IS NOT NULL AS cat_nap_style_exists;
-- expect: cat_nap_style_exists = f; site_version_exists either way


-- ############################################################################
-- STEP A — types, table, CHECKs, backfill.   ONE TRANSACTION.
--          Touches no existing object except a SELECT of "SiteConfig".
-- ############################################################################

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout      = '5s';

-- A1. The two enum types. CREATE TYPE has no IF NOT EXISTS. Label order matches
--     packages/db/prisma/schema.prisma:47-61 so `prisma migrate diff` stays
--     empty. The labels are the LOWERCASE strings for CatNapStyle because the
--     Prisma members are @map'd (oneko.js reads the label off a data
--     attribute); the client's MOON/TICKS names never reach Postgres.
DO $$
BEGIN
  IF to_regtype('"SiteVersion"') IS NULL THEN
    CREATE TYPE "SiteVersion" AS ENUM ('v1', 'v2');
  END IF;
  IF to_regtype('"CatNapStyle"') IS NULL THEN
    CREATE TYPE "CatNapStyle" AS ENUM
      ('tooltip','ring','halo','pixel','moon','ticks','random','off');
  END IF;
END
$$;
-- v1 after A1: unaffected. No existing column uses either type; a new type is
-- invisible to every v1 query.

-- A2. The table, byte-for-byte the block Prisma emits
--     (v2-migration-draft/target-ddl.sql). heroPhotos has no NOT NULL because
--     Prisma folds list-ness into the column arity and emitting one would make
--     a diff non-empty.
CREATE TABLE IF NOT EXISTS "SiteSettings" (
    "id"                 INTEGER NOT NULL DEFAULT 1,
    "name"               TEXT NOT NULL DEFAULT '',
    "avatarUrl"          TEXT NOT NULL DEFAULT '',
    "heroPhotos"         TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumeUrl"          TEXT NOT NULL DEFAULT '',
    "projectsVersion"    "SiteVersion" NOT NULL DEFAULT 'v2',
    "backgroundVersion"  "SiteVersion" NOT NULL DEFAULT 'v1',
    "heroDotColor"       TEXT NOT NULL DEFAULT '',
    "heroDotPulse"       BOOLEAN NOT NULL DEFAULT true,
    "navbarLogo"         TEXT NOT NULL DEFAULT '',
    "copyrightName"      TEXT NOT NULL DEFAULT '',
    "contactEmail"       TEXT NOT NULL DEFAULT '',
    "availabilityStatus" TEXT NOT NULL DEFAULT '',
    "availabilityDetail" TEXT NOT NULL DEFAULT '',
    "terrainStrength"    INTEGER NOT NULL DEFAULT 50,
    "terrainVeil"        INTEGER NOT NULL DEFAULT 50,
    "terrainCell"        INTEGER NOT NULL DEFAULT 12,
    "terrainLevels"      INTEGER NOT NULL DEFAULT 14,
    "terrainMinor"       INTEGER NOT NULL DEFAULT 20,
    "terrainMajor"       INTEGER NOT NULL DEFAULT 48,
    "terrainChannel"     BOOLEAN NOT NULL DEFAULT true,
    "terrainInteractive" BOOLEAN NOT NULL DEFAULT true,
    "catNapStyle"        "CatNapStyle" NOT NULL DEFAULT 'ticks',
    "catNapSeconds"      INTEGER NOT NULL DEFAULT 30,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);
-- v1 after A2: unaffected. Fourteen v1 queries name "SiteConfig"; none names
-- "SiteSettings". The NOT NULL columns with no default ("updatedAt") cannot
-- break a v1 INSERT because v1 never inserts into this table.

-- A3. The ten CHECKs from packages/db/schema-v2.md:823. Added BEFORE the row so
--     the backfill is validated by them, not the other way round. Prisma cannot
--     express a CHECK, so none of these appear in a diff. One statement, so it
--     is atomic; DROP IF EXISTS first so a re-run is clean.
--
--     These do NOT replace the clamp in the app: a CHECK with no clamp in front
--     turns today's silent coercion into a raw P2010 on save. Verified that the
--     v2 write path cannot violate any of them —
--       clampNumber           apps/docs/app/lib/site-config-keys.ts:215-220
--       hex()                 apps/docs/app/lib/actions/site-config.ts:12-15
--       photos()              apps/docs/app/lib/actions/site-config.ts:17-19
--       toNapStyle/toXVersion apps/docs/app/lib/site-config-keys.ts
--     so adding them in EXPAND, before v2 ships, is safe rather than a landmine.
ALTER TABLE "SiteSettings"
  DROP CONSTRAINT IF EXISTS "SiteSettings_id_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainStrength_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainVeil_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainCell_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainLevels_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainMinor_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_terrainMajor_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_catNapSeconds_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_heroDotColor_check",
  DROP CONSTRAINT IF EXISTS "SiteSettings_heroPhotos_check",
  -- the primary key says "at most one row with id = 1"; this says "and no row
  -- with any other id". Together: exactly one row, forever.
  ADD CONSTRAINT "SiteSettings_id_check"              CHECK ("id" = 1),
  ADD CONSTRAINT "SiteSettings_terrainStrength_check" CHECK ("terrainStrength" BETWEEN 10 AND 100),
  ADD CONSTRAINT "SiteSettings_terrainVeil_check"     CHECK ("terrainVeil"     BETWEEN  0 AND  90),
  ADD CONSTRAINT "SiteSettings_terrainCell_check"     CHECK ("terrainCell"     BETWEEN  8 AND  28),
  ADD CONSTRAINT "SiteSettings_terrainLevels_check"   CHECK ("terrainLevels"   BETWEEN  4 AND  24),
  ADD CONSTRAINT "SiteSettings_terrainMinor_check"    CHECK ("terrainMinor"    BETWEEN  2 AND  60),
  ADD CONSTRAINT "SiteSettings_terrainMajor_check"    CHECK ("terrainMajor"    BETWEEN  5 AND  90),
  ADD CONSTRAINT "SiteSettings_catNapSeconds_check"   CHECK ("catNapSeconds"   BETWEEN  3 AND 300),
  ADD CONSTRAINT "SiteSettings_heroDotColor_check"
    CHECK ("heroDotColor" = ''
           OR "heroDotColor" ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'),
  -- No blank or whitespace-only element: that value renders a broken <img> in
  -- the hero photo deck, and v2 deletes the read-side repair that hides it
  -- today. A CHECK cannot contain a subquery, so unnest() is unavailable;
  -- joining on a newline and forbidding an empty line is the equivalent. ^ and
  -- $ are string anchors here, not line anchors (Postgres needs the `n` flag
  -- for that).
  ADD CONSTRAINT "SiteSettings_heroPhotos_check"
    CHECK (coalesce(array_length("heroPhotos", 1), 0) = 0
           OR array_to_string("heroPhotos", E'\n') !~ '(^|\n)[[:space:]]*(\n|$)');
-- v1 after A3: unaffected. Every constraint is on "SiteSettings".

-- A4. Hard preflight, inside the transaction, so P2/P3/P5 are an exception an
--     operator cannot skim past. Anything raised here rolls back A1-A3 too.
DO $$
DECLARE missing text[]; offenders text;
BEGIN
  SELECT array_agg(w.k ORDER BY w.k) INTO missing
  FROM unnest(ARRAY[
    'name','avatarUrl','heroPhotos','resumeUrl',
    'projectsVersion','backgroundVersion','heroDotColor','heroDotPulse',
    'navbarLogo','copyrightName',
    'contactEmail','availabilityStatus','availabilityDetail',
    'terrainStrength','terrainVeil','terrainCell','terrainLevels',
    'terrainMinor','terrainMajor','terrainChannel','terrainInteractive',
    'catNapStyle','catNapSeconds']) AS w(k)
  WHERE NOT EXISTS (SELECT 1 FROM "SiteConfig" c WHERE c."key" = w.k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'SiteConfig is missing carried keys %, whose columns would silently take schema defaults', missing;
  END IF;

  SELECT string_agg(format('%s=%L', c."key", c."value"), ', ' ORDER BY c."key") INTO offenders
  FROM "SiteConfig" c
  WHERE (c."key" IN ('heroDotPulse','terrainChannel','terrainInteractive')
         AND c."value" NOT IN ('on','off'))
     OR (c."key" = 'catNapStyle'
         AND lower(btrim(c."value")) NOT IN
             ('tooltip','ring','halo','pixel','moon','ticks','random','off'))
     OR (c."key" IN ('projectsVersion','backgroundVersion')
         AND c."value" NOT IN ('v1','v2'));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'enum/boolean keys outside their label set: %', offenders;
  END IF;

  SELECT string_agg(format('%s=%L', c."key", c."value"), ', ' ORDER BY c."key") INTO offenders
  FROM "SiteConfig" c
  JOIN (VALUES ('catNapSeconds',3,300),('terrainStrength',10,100),('terrainVeil',0,90),
               ('terrainCell',8,28),('terrainLevels',4,24),('terrainMinor',2,60),
               ('terrainMajor',5,90)) AS r("key",lo,hi) ON r."key" = c."key"
  WHERE CASE WHEN pg_input_is_valid(btrim(c."value"), 'integer')
               THEN btrim(c."value")::int NOT BETWEEN r.lo AND r.hi
             ELSE true END;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'numeric keys unparseable or outside their CHECK range (the backfill would clamp them, changing an operator choice): %', offenders;
  END IF;

  IF (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live') <> 1 THEN
    RAISE EXCEPTION 'HeroContent has % live rows, so the legacy heroVersion/intro/tagline rows are not safely droppable in CONTRACT',
      (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live');
  END IF;
END
$$;

-- A5. The canonical backfill, as a FUNCTION so there is exactly one copy of the
--     23 coercions and both the operator and the STEP B trigger call the same
--     code. Returns the number of rows it changed: 0 means already in sync.
--
--     Each coercion mirrors what the v1 readers already do at read time, so the
--     stored value cannot change meaning:
--       'on'/'off' -> boolean is `<> 'off'`, not `= 'on'`, because that is what
--         HEAD:apps/web/app/lib/data.ts:94,95,117 does;
--       the two version fallbacks keep v1's asymmetry (projectsVersion falls
--         back to v2, backgroundVersion to v1) — HEAD:data.ts:87,100;
--       numeric strings are clamped to the same ranges as the CHECKs, dead code
--         on this data (A4 proves it) and kept so the statement cannot violate
--         a constraint it just added on some other snapshot;
--       heroPhotos is split/btrim/filter/keep-order — HEAD:data.ts:104-108 —
--         plus one extra filter on elements containing a newline, which no real
--         path has and which is the only value that could slip past the
--         array_to_string form of the heroPhotos CHECK.
--
--     The WHERE ... IS DISTINCT FROM makes it a true no-op when in sync, so
--     "updatedAt" does not drift on a re-run and the return value is a real
--     signal.
CREATE OR REPLACE FUNCTION public.site_settings_resync_v2() RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE touched integer;
BEGIN
  WITH cfg AS (
    SELECT
      max("value") FILTER (WHERE "key" = 'name')               AS "name",
      max("value") FILTER (WHERE "key" = 'avatarUrl')          AS "avatarUrl",
      max("value") FILTER (WHERE "key" = 'heroPhotos')         AS "heroPhotos",
      max("value") FILTER (WHERE "key" = 'resumeUrl')          AS "resumeUrl",
      max("value") FILTER (WHERE "key" = 'projectsVersion')    AS "projectsVersion",
      max("value") FILTER (WHERE "key" = 'backgroundVersion')  AS "backgroundVersion",
      max("value") FILTER (WHERE "key" = 'heroDotColor')       AS "heroDotColor",
      max("value") FILTER (WHERE "key" = 'heroDotPulse')       AS "heroDotPulse",
      max("value") FILTER (WHERE "key" = 'navbarLogo')         AS "navbarLogo",
      max("value") FILTER (WHERE "key" = 'copyrightName')      AS "copyrightName",
      max("value") FILTER (WHERE "key" = 'contactEmail')       AS "contactEmail",
      max("value") FILTER (WHERE "key" = 'availabilityStatus') AS "availabilityStatus",
      max("value") FILTER (WHERE "key" = 'availabilityDetail') AS "availabilityDetail",
      max("value") FILTER (WHERE "key" = 'terrainStrength')    AS "terrainStrength",
      max("value") FILTER (WHERE "key" = 'terrainVeil')        AS "terrainVeil",
      max("value") FILTER (WHERE "key" = 'terrainCell')        AS "terrainCell",
      max("value") FILTER (WHERE "key" = 'terrainLevels')      AS "terrainLevels",
      max("value") FILTER (WHERE "key" = 'terrainMinor')       AS "terrainMinor",
      max("value") FILTER (WHERE "key" = 'terrainMajor')       AS "terrainMajor",
      max("value") FILTER (WHERE "key" = 'terrainChannel')     AS "terrainChannel",
      max("value") FILTER (WHERE "key" = 'terrainInteractive') AS "terrainInteractive",
      max("value") FILTER (WHERE "key" = 'catNapStyle')        AS "catNapStyle",
      max("value") FILTER (WHERE "key" = 'catNapSeconds')      AS "catNapSeconds"
    FROM public."SiteConfig"          -- max() FILTER is exact: SiteConfig_key_key
  ), typed AS (
    SELECT
      coalesce(cfg."name", '')               AS "name",
      coalesce(cfg."avatarUrl", '')          AS "avatarUrl",
      coalesce((SELECT array_agg(btrim(u.x) ORDER BY u.ord)
                FROM unnest(string_to_array(coalesce(cfg."heroPhotos", ''), ','))
                     WITH ORDINALITY AS u(x, ord)
                WHERE btrim(u.x) <> '' AND u.x !~ E'[\n\r]'),
               ARRAY[]::text[])              AS "heroPhotos",
      coalesce(cfg."resumeUrl", '')          AS "resumeUrl",
      (CASE WHEN cfg."projectsVersion"   = 'v1' THEN 'v1' ELSE 'v2' END)::"SiteVersion" AS "projectsVersion",
      (CASE WHEN cfg."backgroundVersion" = 'v2' THEN 'v2' ELSE 'v1' END)::"SiteVersion" AS "backgroundVersion",
      CASE WHEN btrim(coalesce(cfg."heroDotColor", ''))
                ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
           THEN btrim(cfg."heroDotColor") ELSE '' END          AS "heroDotColor",
      coalesce(cfg."heroDotPulse", 'on')       <> 'off'        AS "heroDotPulse",
      coalesce(cfg."navbarLogo", '')         AS "navbarLogo",
      coalesce(cfg."copyrightName", '')      AS "copyrightName",
      coalesce(cfg."contactEmail", '')       AS "contactEmail",
      coalesce(cfg."availabilityStatus", '') AS "availabilityStatus",
      coalesce(cfg."availabilityDetail", '') AS "availabilityDetail",
      least(100, greatest( 10, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainStrength", '')), 'integer')
                                    THEN btrim(cfg."terrainStrength")::int ELSE 50 END)) AS "terrainStrength",
      least( 90, greatest(  0, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainVeil", '')), 'integer')
                                    THEN btrim(cfg."terrainVeil")::int     ELSE 50 END)) AS "terrainVeil",
      least( 28, greatest(  8, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainCell", '')), 'integer')
                                    THEN btrim(cfg."terrainCell")::int     ELSE 12 END)) AS "terrainCell",
      least( 24, greatest(  4, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainLevels", '')), 'integer')
                                    THEN btrim(cfg."terrainLevels")::int   ELSE 14 END)) AS "terrainLevels",
      least( 60, greatest(  2, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainMinor", '')), 'integer')
                                    THEN btrim(cfg."terrainMinor")::int    ELSE 20 END)) AS "terrainMinor",
      least( 90, greatest(  5, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainMajor", '')), 'integer')
                                    THEN btrim(cfg."terrainMajor")::int    ELSE 48 END)) AS "terrainMajor",
      coalesce(cfg."terrainChannel", 'on')     <> 'off'        AS "terrainChannel",
      coalesce(cfg."terrainInteractive", 'on') <> 'off'        AS "terrainInteractive",
      CASE WHEN lower(btrim(coalesce(cfg."catNapStyle", ''))) IN
                ('tooltip','ring','halo','pixel','moon','ticks','random','off')
           THEN lower(btrim(cfg."catNapStyle"))::"CatNapStyle"
           ELSE 'ticks'::"CatNapStyle" END                     AS "catNapStyle",
      least(300, greatest(  3, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."catNapSeconds", '')), 'integer')
                                    THEN btrim(cfg."catNapSeconds")::int   ELSE 30 END)) AS "catNapSeconds"
    FROM cfg
  )
  UPDATE public."SiteSettings" s
     SET "name"               = t."name",
         "avatarUrl"          = t."avatarUrl",
         "heroPhotos"         = t."heroPhotos",
         "resumeUrl"          = t."resumeUrl",
         "projectsVersion"    = t."projectsVersion",
         "backgroundVersion"  = t."backgroundVersion",
         "heroDotColor"       = t."heroDotColor",
         "heroDotPulse"       = t."heroDotPulse",
         "navbarLogo"         = t."navbarLogo",
         "copyrightName"      = t."copyrightName",
         "contactEmail"       = t."contactEmail",
         "availabilityStatus" = t."availabilityStatus",
         "availabilityDetail" = t."availabilityDetail",
         "terrainStrength"    = t."terrainStrength",
         "terrainVeil"        = t."terrainVeil",
         "terrainCell"        = t."terrainCell",
         "terrainLevels"      = t."terrainLevels",
         "terrainMinor"       = t."terrainMinor",
         "terrainMajor"       = t."terrainMajor",
         "terrainChannel"     = t."terrainChannel",
         "terrainInteractive" = t."terrainInteractive",
         "catNapStyle"        = t."catNapStyle",
         "catNapSeconds"      = t."catNapSeconds",
         "updatedAt"          = CURRENT_TIMESTAMP
    FROM typed t
   WHERE s."id" = 1
     AND ROW(s."name", s."avatarUrl", s."heroPhotos", s."resumeUrl",
             s."projectsVersion", s."backgroundVersion",
             s."heroDotColor", s."heroDotPulse",
             s."navbarLogo", s."copyrightName",
             s."contactEmail", s."availabilityStatus", s."availabilityDetail",
             s."terrainStrength", s."terrainVeil", s."terrainCell",
             s."terrainLevels", s."terrainMinor", s."terrainMajor",
             s."terrainChannel", s."terrainInteractive",
             s."catNapStyle", s."catNapSeconds")
         IS DISTINCT FROM
         ROW(t."name", t."avatarUrl", t."heroPhotos", t."resumeUrl",
             t."projectsVersion", t."backgroundVersion",
             t."heroDotColor", t."heroDotPulse",
             t."navbarLogo", t."copyrightName",
             t."contactEmail", t."availabilityStatus", t."availabilityDetail",
             t."terrainStrength", t."terrainVeil", t."terrainCell",
             t."terrainLevels", t."terrainMinor", t."terrainMajor",
             t."terrainChannel", t."terrainInteractive",
             t."catNapStyle", t."catNapSeconds");
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END
$fn$;
-- v1 after A5: unaffected. Creating a function executes nothing.

-- A6. Mint the singleton with every schema default, so the resync has a row to
--     update. All 26 defaults satisfy all ten CHECKs (strength 50 in 10..100,
--     veil 50 in 0..90, cell 12, levels 14, minor 20, major 48, seconds 30,
--     heroDotColor '', heroPhotos {}, id 1), so this cannot fail on a fresh
--     table. ON CONFLICT DO NOTHING, never DO UPDATE, so re-running it can
--     never overwrite a row it did not write.
INSERT INTO "SiteSettings" ("id", "updatedAt")
VALUES (1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- A7. The backfill itself. Expect 1 on the first run (23 columns move off their
--     defaults), 0 on any re-run.
SELECT public.site_settings_resync_v2() AS rows_changed;

-- A8. Exactly one row, and it is not still all-defaults.
DO $$
BEGIN
  IF (SELECT count(*) FROM "SiteSettings") <> 1 THEN
    RAISE EXCEPTION 'SiteSettings holds % rows after the backfill, expected 1',
      (SELECT count(*) FROM "SiteSettings");
  END IF;
  IF (SELECT "name" = '' AND "navbarLogo" = '' AND "contactEmail" = ''
      FROM "SiteSettings" WHERE "id" = 1) THEN
    RAISE EXCEPTION 'SiteSettings is still all-defaults — the backfill read nothing';
  END IF;
END
$$;

COMMIT;


-- ############################################################################
-- STEP B — the dual-write trigger.   SEPARATE, SHORT TRANSACTION.
-- ############################################################################
--
-- WHY THIS EXISTS. Between EXPAND and DEPLOY the deployed admin is still v1,
-- and v1 writes ONLY "SiteConfig":
--     HEAD:apps/docs/app/lib/actions/site-config.ts:104-111
--     HEAD:apps/docs/app/lib/actions/links.ts:11-15      (resumeUrl, its own path)
-- Nothing in v1 writes "SiteSettings". So without this trigger, a settings save
-- during the window updates "SiteConfig", the admin sees it take effect on the
-- live v1 site, and then DEPLOY switches every reader to "SiteSettings", which
-- still holds the value from backfill time. The edit is silently reverted on
-- BOTH the public site and the admin UI, with no error anywhere.
--
-- WHAT IT DOES. A statement-level AFTER trigger that calls the same resync
-- function. Full resync of 26 rows per statement, so v1's 23-upsert
-- prisma.$transaction fires it 23 times and lands in sync at commit.
--
-- FAILURE MODES, all checked:
--   * a CHECK violation would surface to the admin as a Prisma P2010 and abort
--     the save. Impossible here: the resync clamps every numeric to the CHECK
--     range, regex-guards heroDotColor to '' , coerces catNapStyle to a label,
--     and filters heroPhotos to non-blank newline-free elements.
--   * a missing "SiteSettings" row makes the UPDATE a 0-row no-op, not an error.
--     A6 has already created it.
--   * recursion: the trigger only writes "SiteSettings" and nothing writes
--     "SiteConfig" from "SiteSettings", so there is no cycle and no
--     pg_trigger_depth() guard is needed.
--   * CREATE TRIGGER takes ACCESS EXCLUSIVE on "SiteConfig", which is on the
--     render path of EVERY public route via the root layout
--     (HEAD:apps/web/app/layout.tsx:69 -> HEAD:apps/web/app/lib/data.ts:70-72).
--     Held for microseconds here because this is a one-statement transaction,
--     and bounded by lock_timeout so it queues behind nothing.
--
-- If you would rather not add a trigger to production, SKIP STEP B and instead
-- FREEZE the admin for the window: no saves on /site-config, /background,
-- /hero (including the resume URL form), /cat, /contact-purposes or /projects,
-- and run `SELECT public.site_settings_resync_v2();` as the last thing before
-- you push the deploy. The freeze is cheap here (single admin, who is also the
-- operator) but it is discipline, not a guarantee.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.site_settings_resync_v2_trg() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM public.site_settings_resync_v2();
  RETURN NULL;                 -- AFTER STATEMENT: return value is ignored
END
$fn$;

DROP TRIGGER IF EXISTS "SiteConfig_resync_v2" ON public."SiteConfig";

CREATE TRIGGER "SiteConfig_resync_v2"
AFTER INSERT OR UPDATE OR DELETE ON public."SiteConfig"
FOR EACH STATEMENT EXECUTE FUNCTION public.site_settings_resync_v2_trg();

COMMIT;

-- v1 after STEP B: still works, identically. The trigger adds no column, no
-- type, no constraint and no foreign key to "SiteConfig", so
--   SELECT id,key,value FROM "SiteConfig"            (all nine v1 read sites)
--   INSERT ... ON CONFLICT / UPDATE "SiteConfig"     (both v1 write sites)
-- return and store exactly what they did before. Neither Prisma nor Postgres
-- reports the extra work; the only observable difference is a few hundred
-- microseconds on an admin save.


-- ############################################################################
-- THE PRE-DEPLOY GATE — run this immediately before you `git push` the v2 code
-- ############################################################################
SELECT public.site_settings_resync_v2() AS rows_changed_by_final_resync;
-- expect: 0.
--   With STEP B installed, 0 proves the trigger kept up with every v1 save.
--   Without STEP B, a non-zero answer here is the value the window nearly lost;
--   it has just been rescued, and you should push now.


-- ############################################################################
-- BOOKKEEPING (not SQL you can skip, but not part of the safety argument)
-- ############################################################################
-- This cluster is hand-run SQL, so "_prisma_migrations" does not know about it.
-- Before the next `prisma migrate dev`, stage the equivalent migration
-- directory and mark it applied with
--   bunx prisma migrate resolve --applied <timestamp>_site_settings
-- otherwise the next migrate run will try to create "SiteSettings" again.
-- Nothing at runtime consults "_prisma_migrations", so this is not urgent for
-- the cutover and must not be done inside the transactions above.


-- ############################################################################
-- VERIFICATION  (read-only; run after STEP A, and again after STEP B)
-- ############################################################################

-- V1. Shape. The source table is UNTOUCHED — that is the expand-safety proof.
SELECT (SELECT count(*) FROM "SiteSettings")                  AS settings_rows,
       (SELECT count(*) FROM "SiteConfig")                    AS site_config_rows_still,
       to_regclass('public."SiteConfig"')   IS NOT NULL       AS source_still_present,
       to_regtype('"CatNapStyle"')          IS NOT NULL       AS cat_nap_style_exists,
       to_regtype('"SiteVersion"')          IS NOT NULL       AS site_version_exists,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='SiteConfig')  AS site_config_columns;
-- expect: 1 / 26 / t / t / t / 3
--   site_config_columns = 3 (id, key, value) is the claim "no v1 SELECT lost a
--   column"; site_config_rows_still = 26 is "no v1 row was moved or deleted".

-- V2. Every carried value against the real production values in
--     v2-migration-draft/data-facts.txt. One row, every column t. A single f
--     names the column that coerced wrongly.
SELECT "id" = 1                                                        AS id_ok,
       "name" = 'Yatin Dora'                                           AS name_ok,
       "avatarUrl" = '/mine/avatar.png'                                AS avatar_ok,
       "heroPhotos" = ARRAY['/mine/avatar.png','/mine/avatar2.jpeg']   AS hero_photos_ok,
       "resumeUrl" = 'https://drive.google.com/file/d/16xisMxquk1njqUeEQFN8Mi6E6vwJF6sr/view?usp=sharing'
                                                                       AS resume_ok,
       "projectsVersion"::text = 'v2'                                  AS projects_version_ok,
       "backgroundVersion"::text = 'v2'                                AS background_version_ok,
       "heroDotColor" = '#22C55E'                                      AS hero_dot_color_ok,
       "heroDotPulse" IS TRUE                                          AS hero_dot_pulse_ok,
       "navbarLogo" = 'Yatin.Dora'                                     AS navbar_logo_ok,
       "copyrightName" = 'Yatin Dora'                                  AS copyright_ok,
       "contactEmail" = 'yatin.dora81@gmail.com'                       AS contact_email_ok,
       "availabilityStatus" = 'Available for opportunities'             AS availability_status_ok,
       "availabilityDetail" = 'Open to freelance, full-time & collaborations'
                                                                       AS availability_detail_ok,
       "terrainStrength" = 45                                          AS terrain_strength_ok,
       "terrainVeil" = 52                                              AS terrain_veil_ok,
       "terrainCell" = 16                                              AS terrain_cell_ok,
       "terrainLevels" = 15                                            AS terrain_levels_ok,
       "terrainMinor" = 18                                             AS terrain_minor_ok,
       "terrainMajor" = 51                                             AS terrain_major_ok,
       "terrainChannel" IS TRUE                                        AS terrain_channel_ok,
       "terrainInteractive" IS TRUE                                    AS terrain_interactive_ok,
       "catNapStyle"::text = 'moon'                                    AS cat_nap_style_ok,
       "catNapSeconds" = 45                                            AS cat_nap_seconds_ok,
       "createdAt" IS NOT NULL AND "updatedAt" IS NOT NULL             AS stamps_ok
FROM "SiteSettings";
-- expect: 1 row, every column t
-- NOTE: if the admin saved something between the dump and now, a literal here
--   can legitimately be f. V3 is the check that does not go stale.

-- V3. Round trip, value by value: re-encode "SiteSettings" back into the v1
--     string form and diff it against "SiteConfig". This is the check that does
--     not depend on the dump, and it is the one to re-run right before DEPLOY.
WITH settings_kv AS (
  SELECT unnest(ARRAY[
           'name','avatarUrl','heroPhotos','resumeUrl','projectsVersion',
           'backgroundVersion','heroDotColor','heroDotPulse','navbarLogo',
           'copyrightName','contactEmail','availabilityStatus',
           'availabilityDetail','terrainStrength','terrainVeil','terrainCell',
           'terrainLevels','terrainMinor','terrainMajor','terrainChannel',
           'terrainInteractive','catNapStyle','catNapSeconds']) AS "key",
         unnest(ARRAY[
           s."name", s."avatarUrl", array_to_string(s."heroPhotos", ','),
           s."resumeUrl", s."projectsVersion"::text, s."backgroundVersion"::text,
           s."heroDotColor",
           CASE WHEN s."heroDotPulse" THEN 'on' ELSE 'off' END,
           s."navbarLogo", s."copyrightName", s."contactEmail",
           s."availabilityStatus", s."availabilityDetail",
           s."terrainStrength"::text, s."terrainVeil"::text, s."terrainCell"::text,
           s."terrainLevels"::text, s."terrainMinor"::text, s."terrainMajor"::text,
           CASE WHEN s."terrainChannel"     THEN 'on' ELSE 'off' END,
           CASE WHEN s."terrainInteractive" THEN 'on' ELSE 'off' END,
           s."catNapStyle"::text, s."catNapSeconds"::text]) AS "value"
  FROM "SiteSettings" s WHERE s."id" = 1
), config_kv AS (
  SELECT c."key",
    CASE c."key"
      WHEN 'heroPhotos' THEN
        (SELECT coalesce(string_agg(btrim(u.x), ',' ORDER BY u.ord), '')
         FROM unnest(string_to_array(c."value", ',')) WITH ORDINALITY AS u(x, ord)
         WHERE btrim(u.x) <> '' AND u.x !~ E'[\n\r]')
      WHEN 'heroDotColor' THEN
        CASE WHEN btrim(c."value") ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
             THEN btrim(c."value") ELSE '' END
      WHEN 'catNapStyle' THEN
        CASE WHEN lower(btrim(c."value")) IN
                  ('tooltip','ring','halo','pixel','moon','ticks','random','off')
             THEN lower(btrim(c."value")) ELSE 'ticks' END
      WHEN 'projectsVersion'   THEN CASE WHEN c."value" = 'v1' THEN 'v1' ELSE 'v2' END
      WHEN 'backgroundVersion' THEN CASE WHEN c."value" = 'v2' THEN 'v2' ELSE 'v1' END
      WHEN 'heroDotPulse'      THEN CASE WHEN c."value" = 'off' THEN 'off' ELSE 'on' END
      WHEN 'terrainChannel'    THEN CASE WHEN c."value" = 'off' THEN 'off' ELSE 'on' END
      WHEN 'terrainInteractive'THEN CASE WHEN c."value" = 'off' THEN 'off' ELSE 'on' END
      WHEN 'catNapSeconds'   THEN least(300, greatest(  3, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  30 END))::text
      WHEN 'terrainStrength' THEN least(100, greatest( 10, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  50 END))::text
      WHEN 'terrainVeil'     THEN least( 90, greatest(  0, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  50 END))::text
      WHEN 'terrainCell'     THEN least( 28, greatest(  8, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  12 END))::text
      WHEN 'terrainLevels'   THEN least( 24, greatest(  4, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  14 END))::text
      WHEN 'terrainMinor'    THEN least( 60, greatest(  2, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  20 END))::text
      WHEN 'terrainMajor'    THEN least( 90, greatest(  5, CASE WHEN pg_input_is_valid(btrim(c."value"),'integer') THEN btrim(c."value")::int ELSE  48 END))::text
      ELSE c."value"
    END AS "value"
  FROM "SiteConfig" c
  WHERE c."key" NOT IN ('heroVersion','intro','tagline')
)
SELECT coalesce(s."key", g."key") AS "key",
       g."value" AS from_site_config, s."value" AS in_site_settings
FROM settings_kv s FULL OUTER JOIN config_kv g ON g."key" = s."key"
WHERE s."value" IS DISTINCT FROM g."value" OR s."key" IS NULL OR g."key" IS NULL;
-- expect: 0 rows. Any row is a setting the deploy would get wrong.

-- V4. heroPhotos really is an ordered 2-element array, not a 1-element array
--     still holding the comma-joined string.
SELECT array_length("heroPhotos", 1) AS photo_count,
       "heroPhotos"[1] AS top_card, "heroPhotos"[2] AS second_card,
       NOT EXISTS (SELECT 1 FROM unnest("heroPhotos") AS u(p) WHERE btrim(u.p) = '')
         AS no_blank_elements
FROM "SiteSettings";
-- expect: 2 / '/mine/avatar.png' / '/mine/avatar2.jpeg' / t

-- V5. All ten CHECKs plus the primary key, under the names schema-v2.md:823
--     names, and nothing else.
SELECT contype, conname FROM pg_constraint
WHERE conrelid = '"SiteSettings"'::regclass AND contype IN ('c','p')
ORDER BY contype, conname;
-- expect: 11 rows — p SiteSettings_pkey, and c: catNapSeconds, heroDotColor,
--   heroPhotos, id, terrainCell, terrainLevels, terrainMajor, terrainMinor,
--   terrainStrength, terrainVeil (all suffixed _check)

-- V6. Column shape, so a `prisma migrate diff` surprise is caught here.
SELECT ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'SiteSettings'
ORDER BY ordinal_position;
-- expect: 26 rows; id int4 NO default 1; heroPhotos ARRAY/_text YES default
--   ARRAY[]::text[]; projectsVersion/backgroundVersion USER-DEFINED SiteVersion
--   NO defaults 'v2'/'v1'; catNapStyle USER-DEFINED CatNapStyle NO default
--   'ticks'; updatedAt timestamp NO, default null

-- V7. Enum labels in declaration order, matching schema.prisma:47-61.
SELECT enum_range(NULL::"CatNapStyle") AS cat_nap_style,
       enum_range(NULL::"SiteVersion") AS site_version;
-- expect: {tooltip,ring,halo,pixel,moon,ticks,random,off} and {v1,v2}

-- V8. The trigger (STEP B) is installed, statement-level, on the right table.
SELECT t.tgname, t.tgenabled, p.proname,
       (t.tgtype & 1) = 0 AS statement_level
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public."SiteConfig"'::regclass AND NOT t.tgisinternal;
-- expect: 1 row — SiteConfig_resync_v2 / O / site_settings_resync_v2_trg / t

-- V9. A LIVE proof the trigger works, if you want one before you trust it.
--     Writes and restores the same value, exactly as a v1 no-op save would.
--     Safe on production: it ends where it started and the site never sees an
--     intermediate state, because it is one transaction.
--       BEGIN;
--         UPDATE "SiteConfig" SET "value" = "value" || 'X' WHERE "key" = 'navbarLogo';
--         SELECT "navbarLogo" FROM "SiteSettings";   -- expect 'Yatin.DoraX'
--       ROLLBACK;
--       SELECT "navbarLogo" FROM "SiteSettings";     -- expect 'Yatin.Dora'
