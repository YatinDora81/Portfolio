-- ============================================================================
-- v2 branch migration — cluster 10-settings
-- ============================================================================
--
-- WHAT THIS DOES
--   Replaces the "SiteConfig" key/value bag (26 rows of { key, value } TEXT)
--   with the single typed "SiteSettings" row the v2 schema declares, then drops
--   "SiteConfig".
--
--     * 23 of the 26 keys become one typed column each.
--     * 3 keys are NOT carried over: heroVersion, intro and tagline. intro and
--       tagline already live on HeroContent (apps/web/app/lib/data.ts:77-79
--       reads them from the live HeroContent row and ignores the SiteConfig
--       rows entirely), and the live-version pointer stays HeroContent.live.
--       See DATA LOSS below: heroVersion in production holds 'v1' while
--       HeroContent.live sits on the v2 row, so the SiteConfig value is not
--       merely redundant, it is stale and unread.
--     * Coercions, all mirroring the coercions apps/web and apps/docs perform
--       at read time today, so the stored value cannot change meaning:
--         'on' / 'off'         -> boolean      (value <> 'off', as data.ts does)
--         numeric strings      -> integer, clamped to the admin's own range
--         catNapStyle          -> "CatNapStyle" enum. The enum is @map'd to the
--                                 lowercase label, so the stored text is still
--                                 'moon' — oneko.js reads that label off a data
--                                 attribute.
--         projects/background  -> "SiteVersion" enum ('v1' | 'v2', lowercase)
--         heroPhotos           -> text[]: split on ',', btrim each element,
--                                 drop the empties, order preserved (element 1
--                                 is the top card of the hero photo deck).
--     * Adds all ten SiteSettings CHECK constraints from the inventory in
--       packages/db/schema-v2.md: id = 1, the six terrain dial ranges,
--       catNapSeconds, heroDotColor, and "no blank element in heroPhotos".
--
-- GROUNDING
--   Every expected value below comes from /tmp/v2/data-facts.txt (a read-only
--   dump taken 2026-09-26). The clamp ranges and the hex pattern come from the
--   two places the code already keeps them:
--     apps/docs/app/lib/site-config-keys.ts:196-205  (NUMBER_RANGE)
--     apps/docs/app/lib/actions/site-config.ts:31-44 (HEX, CAT_NAP_STYLES,
--                                                     TERRAIN_RANGES)
--     apps/web/app/lib/data.ts:63-121                (the read-side coercions)
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional. Wrap the whole file in
--   BEGIN / COMMIT. There is no CREATE INDEX CONCURRENTLY, no ALTER TYPE ADD
--   VALUE, no VACUUM. The enum types are CREATEd in this transaction and used in
--   the same transaction, which Postgres permits precisely because they are new
--   here. Nothing needs superuser: no session_replication_role, no DISABLE
--   TRIGGER, no CREATE EXTENSION.
--
-- ORDER / DEPENDENCIES
--   Independent of every other cluster except for one shared object: the
--   "SiteVersion" enum type, which cluster 05 (the version-column pass) also
--   creates. Both create it guarded on pg_type, so either order works and
--   whichever runs second is a no-op. "CatNapStyle" belongs to this cluster
--   alone.
--   This cluster MUST run before any cluster that drops or renames
--   "SiteConfig" (none other does) and can run before or after the hero
--   cluster: it only READS HeroContent, in a preflight.
--
-- RE-RUNNABILITY
--   Safe to re-run after a FAILED (rolled-back) attempt: every object is
--   guarded (CREATE TABLE IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before ADD,
--   ON CONFLICT DO NOTHING, DROP TABLE IF EXISTS).
--   NOT re-runnable after a COMMITTED success, by design: the final statement
--   drops the source table, so a second run would find no "SiteConfig" and
--   error at the backfill. That is the correct failure — the alternative
--   (CREATE TABLE IF NOT EXISTS "SiteConfig" to make the read succeed) would
--   resurrect it empty and then COALESCE every setting to a schema default,
--   silently replacing real values with defaults. The transaction is the guard.
--
-- ROLLBACK
--   Inside the transaction: ROLLBACK. Nothing survives, including the drop.
--   After COMMIT:
--     ALTER TABLE "SiteSettings" DROP CONSTRAINT IF EXISTS ...  -- (not needed)
--     DROP TABLE IF EXISTS "SiteSettings";
--     DROP TYPE  IF EXISTS "CatNapStyle";
--     -- "SiteVersion" only if cluster 05 has not run and nothing else uses it:
--     --   DROP TYPE IF EXISTS "SiteVersion";
--     CREATE TABLE "SiteConfig" (
--         "id"    TEXT NOT NULL,
--         "key"   TEXT NOT NULL,
--         "value" TEXT NOT NULL,
--         CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")
--     );
--     CREATE UNIQUE INDEX "SiteConfig_key_key" ON "SiteConfig"("key");
--   and then restore the 26 rows, WITH THEIR ORIGINAL uuid ids, from the JSON
--   dump (packages/db/scripts/restore.ts). The ids are not reconstructible from
--   "SiteSettings" and nothing references them, but restoring them keeps the
--   branch byte-comparable with the dump.
--   The rows are deliberately NOT archived into a side table first: an extra
--   table the Prisma schema does not declare makes `prisma migrate diff` come
--   back non-empty, which is the one thing this migration must not do. On a Neon
--   branch the real rollback is to reset the branch from production anyway.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PREFLIGHT  (read-only; run these first and read every expected result)
-- ----------------------------------------------------------------------------

-- P1. The source table is there and holds exactly the 26 rows the dump saw,
--     and the target does not exist yet.
SELECT
  (SELECT count(*) FROM "SiteConfig")                  AS site_config_rows,
  to_regclass('public."SiteConfig"')   IS NOT NULL     AS source_present,
  to_regclass('public."SiteSettings"') IS NULL         AS target_absent;
-- expect: site_config_rows = 26, source_present = t, target_absent = t

-- P2. The key set is exactly the 26 keys this migration knows how to place:
--     23 carried + 3 legacy. A row here is either a key with nowhere to go or a
--     carried key that is missing (its column would silently take the schema
--     default instead of the operator's value).
SELECT
  coalesce(expected."key", c."key")                    AS "key",
  (expected."key" IS NULL)                             AS unexpected_in_db,
  (c."key"        IS NULL)                             AS missing_from_db
FROM unnest(ARRAY[
  'name','avatarUrl','heroPhotos','resumeUrl',
  'projectsVersion','backgroundVersion',
  'heroDotColor','heroDotPulse',
  'navbarLogo','copyrightName',
  'contactEmail','availabilityStatus','availabilityDetail',
  'terrainStrength','terrainVeil','terrainCell','terrainLevels',
  'terrainMinor','terrainMajor','terrainChannel','terrainInteractive',
  'catNapStyle','catNapSeconds',
  'heroVersion','intro','tagline'
]) AS expected("key")
FULL OUTER JOIN "SiteConfig" c ON c."key" = expected."key"
WHERE expected."key" IS NULL OR c."key" IS NULL;
-- expect: 0 rows

-- P3. The three boolean keys hold only 'on' or 'off'.
SELECT "key", "value" FROM "SiteConfig"
WHERE "key" IN ('heroDotPulse','terrainChannel','terrainInteractive')
  AND "value" NOT IN ('on','off');
-- expect: 0 rows   (all three are 'on' in production)

-- P4. Every numeric key parses as a 4-byte integer AND already sits inside the
--     range its CHECK will enforce, so the clamp in the backfill is provably a
--     no-op and no operator-chosen value is quietly moved.
--     pg_input_is_valid (PG16+) catches both "not a number" and "too big for
--     int"; the CASE is there because Postgres does not promise to short-circuit
--     OR, and a bare cast in the same predicate could still raise 22P02.
SELECT c."key", c."value", r.lo, r.hi
FROM "SiteConfig" c
JOIN (VALUES
  ('catNapSeconds',   3, 300),
  ('terrainStrength',10, 100),
  ('terrainVeil',     0,  90),
  ('terrainCell',     8,  28),
  ('terrainLevels',   4,  24),
  ('terrainMinor',    2,  60),
  ('terrainMajor',    5,  90)
) AS r("key", lo, hi) ON r."key" = c."key"
WHERE CASE
        WHEN pg_input_is_valid(btrim(c."value"), 'integer')
          THEN btrim(c."value")::int NOT BETWEEN r.lo AND r.hi
        ELSE true
      END;
-- expect: 0 rows
--   (production: catNapSeconds 45, strength 45, veil 52, cell 16, levels 15,
--    minor 18, major 51 — all inside range)

-- P5. catNapStyle is one of the eight enum labels, in the lowercase form the
--     enum stores. A value outside the set would be coerced to 'ticks' by the
--     backfill exactly as the app coerces it today, so this assertion is what
--     proves no operator choice is lost.
SELECT "value" FROM "SiteConfig"
WHERE "key" = 'catNapStyle'
  AND lower(btrim("value")) NOT IN
      ('tooltip','ring','halo','pixel','moon','ticks','random','off');
-- expect: 0 rows   (production: 'moon')

-- P6. The two version keys hold only 'v1' or 'v2' — the "SiteVersion" labels.
SELECT "key", "value" FROM "SiteConfig"
WHERE "key" IN ('projectsVersion','backgroundVersion')
  AND "value" NOT IN ('v1','v2');
-- expect: 0 rows   (production: projectsVersion 'v2', backgroundVersion 'v2')

-- P7. heroDotColor is empty or a #rgb / #rrggbb / #rrggbbaa hex, matching
--     apps/web/app/lib/data.ts:63 and actions/site-config.ts:31. Case
--     insensitive: the stored value is uppercase '#22C55E'.
SELECT "value" FROM "SiteConfig"
WHERE "key" = 'heroDotColor'
  AND btrim("value") <> ''
  AND btrim("value") !~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$';
-- expect: 0 rows

-- P8. Preview the heroPhotos split, so the array that lands is inspected before
--     it lands. The photo editor writes a lone space as its encoding for a blank
--     row, which is exactly what the new CHECK forbids, hence the btrim/filter.
SELECT
  cfg."value"                                          AS raw,
  ARRAY(
    SELECT btrim(u.x)
    FROM unnest(string_to_array(cfg."value", ',')) WITH ORDINALITY AS u(x, ord)
    WHERE btrim(u.x) <> ''
    ORDER BY u.ord
  )                                                    AS "heroPhotos"
FROM "SiteConfig" cfg
WHERE cfg."key" = 'heroPhotos';
-- expect: 1 row
--   raw        = '/mine/avatar.png,/mine/avatar2.jpeg'
--   heroPhotos = {/mine/avatar.png,/mine/avatar2.jpeg}   (2 elements, in order)

-- P9. The three legacy keys have somewhere else to be. intro and tagline are
--     carried by HeroContent, one row per hero layout; the live pointer is
--     HeroContent.live. If this returns anything but two non-blank rows with
--     exactly one live, stop: dropping the legacy rows would then be a real
--     loss and this cluster must wait for the hero cluster.
SELECT
  (SELECT count(*) FROM "HeroContent")                                       AS hero_rows,
  (SELECT count(*) FROM "HeroContent" WHERE btrim("intro")   <> '')          AS intro_present,
  (SELECT count(*) FROM "HeroContent" WHERE btrim("tagline") <> '')          AS tagline_present,
  (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live')                 AS live_rows,
  (SELECT "version" FROM "HeroContent" WHERE "live" = 'live')                AS live_version,
  (SELECT "value" FROM "SiteConfig" WHERE "key" = 'heroVersion')             AS legacy_heroVersion;
-- expect: hero_rows = 2, intro_present = 2, tagline_present = 2, live_rows = 1,
--         live_version = 'v2', legacy_heroVersion = 'v1'
--   The last two disagreeing is the point: HeroContent.live is authoritative
--   (data.ts:77 derives the served version from it) and the legacy row is stale.
--   See DATA LOSS.

-- P10. What the legacy intro/tagline strings are, next to what HeroContent
--      holds, so the drop is an informed one. /tmp/v2/data-facts.txt does NOT
--      contain HeroContent.intro / .tagline, so this is the only place those
--      two values can be compared; do not skip it.
SELECT h."version", h."live", h."intro", h."tagline",
  (SELECT "value" FROM "SiteConfig" WHERE "key" = 'intro')   AS legacy_intro,
  (SELECT "value" FROM "SiteConfig" WHERE "key" = 'tagline') AS legacy_tagline
FROM "HeroContent" h
ORDER BY h."version";
-- expect: 2 rows. legacy_intro = 'I build scalable web apps using' and
--   legacy_tagline = "Ship it, scale it, make it smarter, keep learning — that's
--   the loop I live in." Confirm each HeroContent row carries copy it is happy
--   to keep; the legacy pair is what the 2026-07-28 add_hero_content migration
--   seeded those rows FROM, so any difference is a later admin edit and the
--   HeroContent value is the newer one.

-- P11. Enum type state, so it is clear which types this run will create.
SELECT
  to_regtype('"SiteVersion"') IS NOT NULL AS site_version_exists,
  to_regtype('"CatNapStyle"') IS NOT NULL AS cat_nap_style_exists;
-- expect: cat_nap_style_exists = f. site_version_exists = t if cluster 05 has
--         already run, f otherwise; either is fine.


-- ----------------------------------------------------------------------------
-- DDL / DML
-- ----------------------------------------------------------------------------

-- 1. The two enum types this table needs. CREATE TYPE has no IF NOT EXISTS, so
--    the guard is explicit. Label order matches the declaration order in
--    packages/db/prisma/schema.prisma so `prisma migrate diff` has nothing to
--    say about either type. "SiteVersion" is shared with cluster 05 (four
--    version columns); whichever cluster runs first creates it.
DO $$
BEGIN
  IF to_regtype('"SiteVersion"') IS NULL THEN
    CREATE TYPE "SiteVersion" AS ENUM ('v1', 'v2');
  END IF;
  IF to_regtype('"CatNapStyle"') IS NULL THEN
    -- @map'd to lowercase: oneko.js reads the label off a data attribute, so the
    -- DATABASE labels are the lowercase strings and the Prisma client member
    -- names (TOOLTIP, RING, …) never reach the database.
    CREATE TYPE "CatNapStyle" AS ENUM
      ('tooltip', 'ring', 'halo', 'pixel', 'moon', 'ticks', 'random', 'off');
  END IF;
END
$$;

-- 2. The table, in the shape `prisma migrate` emits for the model: TIMESTAMP(3)
--    for DateTime, TEXT[] DEFAULT ARRAY[]::TEXT[] for a scalar list (Prisma does
--    not emit NOT NULL on a list column — it folds list-ness into the column
--    arity — so neither do we, and a diff stays empty), and no index beyond the
--    primary key, because the model declares none. One row, id = 1, forever.
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

-- 3. The CHECK inventory from packages/db/schema-v2.md, added BEFORE the
--    backfill so the backfill's own coercions are validated by them rather than
--    the other way round. Prisma cannot express a CHECK, so none of these show
--    up in a diff; the names follow the repo's existing convention
--    (GithubYear_days_length_check, AuditEvent_action_check, …).
--
--    These do NOT replace the server-side clamp in actions/site-config.ts: a
--    CHECK with no clamp in front of it turns today's silent coercion into a raw
--    P2010 on save. The clamp stays; this is the floor under it.
--
--    One statement, so it is atomic, and DROP … IF EXISTS first so a re-run
--    after a rolled-back attempt is clean.
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
  -- Singleton. The primary key says "at most one row with id = 1"; this says
  -- "and no row with any other id", which together mean exactly one row.
  ADD CONSTRAINT "SiteSettings_id_check"              CHECK ("id" = 1),
  -- The six terrain dial ranges, verbatim from NUMBER_RANGE in
  -- apps/docs/app/lib/site-config-keys.ts:196-205.
  ADD CONSTRAINT "SiteSettings_terrainStrength_check" CHECK ("terrainStrength" BETWEEN 10 AND 100),
  ADD CONSTRAINT "SiteSettings_terrainVeil_check"     CHECK ("terrainVeil"     BETWEEN  0 AND  90),
  ADD CONSTRAINT "SiteSettings_terrainCell_check"     CHECK ("terrainCell"     BETWEEN  8 AND  28),
  ADD CONSTRAINT "SiteSettings_terrainLevels_check"   CHECK ("terrainLevels"   BETWEEN  4 AND  24),
  ADD CONSTRAINT "SiteSettings_terrainMinor_check"    CHECK ("terrainMinor"    BETWEEN  2 AND  60),
  ADD CONSTRAINT "SiteSettings_terrainMajor_check"    CHECK ("terrainMajor"    BETWEEN  5 AND  90),
  ADD CONSTRAINT "SiteSettings_catNapSeconds_check"   CHECK ("catNapSeconds"   BETWEEN  3 AND 300),
  -- Empty, or a hex colour. Same pattern as the HEX regex the admin validator
  -- and the public reader each keep a copy of; case-insensitive because the
  -- stored value is '#22C55E'.
  ADD CONSTRAINT "SiteSettings_heroDotColor_check"
    CHECK ("heroDotColor" = ''
           OR "heroDotColor" ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'),
  -- No blank or whitespace-only element in heroPhotos: that value renders a
  -- broken <img> in the hero photo deck, and the read-side repair that hides it
  -- today is deleted in the code half of this step.
  --
  -- A CHECK cannot contain a subquery, so unnest() is unavailable. Joining the
  -- array with a newline and forbidding an empty-or-whitespace line is the
  -- subquery-free equivalent. `^` and `$` are string anchors here, not line
  -- anchors: Postgres only makes them newline-sensitive under the `n` flag.
  -- Two known blind spots, both harmless: an element that itself contains a
  -- newline followed by only whitespace ('/a\n  '), and a NULL element, which
  -- array_to_string skips — Prisma's client cannot write either into a String[].
  -- If this server ever refuses the constraint because array_to_string is
  -- STABLE rather than IMMUTABLE (Postgres does not enforce volatility on a
  -- CHECK, so it should not), the fallback is
  --   CHECK (NOT ("heroPhotos" && ARRAY['', ' ']))
  -- which covers only the two encodings the photo editor actually emits.
  ADD CONSTRAINT "SiteSettings_heroPhotos_check"
    CHECK (coalesce(array_length("heroPhotos", 1), 0) = 0
           OR array_to_string("heroPhotos", E'\n') !~ '(^|\n)[[:space:]]*(\n|$)');

-- 4. Hard preflight, inside the transaction. P2 through P6 again, but as an
--    exception rather than a comment an operator can skim past. Anything raised
--    here aborts the whole file and nothing is dropped.
DO $$
DECLARE
  missing text[];
  offenders text;
BEGIN
  SELECT array_agg(want.k ORDER BY want.k) INTO missing
  FROM unnest(ARRAY[
    'name','avatarUrl','heroPhotos','resumeUrl',
    'projectsVersion','backgroundVersion','heroDotColor','heroDotPulse',
    'navbarLogo','copyrightName',
    'contactEmail','availabilityStatus','availabilityDetail',
    'terrainStrength','terrainVeil','terrainCell','terrainLevels',
    'terrainMinor','terrainMajor','terrainChannel','terrainInteractive',
    'catNapStyle','catNapSeconds'
  ]) AS want(k)
  WHERE NOT EXISTS (SELECT 1 FROM "SiteConfig" c WHERE c."key" = want.k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'SiteConfig is missing carried keys %, which would silently take schema defaults', missing;
  END IF;

  SELECT string_agg(format('%s=%L', c."key", c."value"), ', ' ORDER BY c."key") INTO offenders
  FROM "SiteConfig" c
  WHERE c."key" IN ('heroDotPulse','terrainChannel','terrainInteractive')
    AND c."value" NOT IN ('on','off');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'boolean keys outside on/off: %', offenders;
  END IF;

  SELECT string_agg(format('%s=%L', c."key", c."value"), ', ' ORDER BY c."key") INTO offenders
  FROM "SiteConfig" c
  JOIN (VALUES
    ('catNapSeconds',   3, 300),
    ('terrainStrength',10, 100),
    ('terrainVeil',     0,  90),
    ('terrainCell',     8,  28),
    ('terrainLevels',   4,  24),
    ('terrainMinor',    2,  60),
    ('terrainMajor',    5,  90)
  ) AS r("key", lo, hi) ON r."key" = c."key"
  WHERE CASE
          WHEN pg_input_is_valid(btrim(c."value"), 'integer')
            THEN btrim(c."value")::int NOT BETWEEN r.lo AND r.hi
          ELSE true
        END;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'numeric keys unparseable or outside their CHECK range (the backfill would clamp them): %', offenders;
  END IF;

  SELECT string_agg(format('%s=%L', c."key", c."value"), ', ' ORDER BY c."key") INTO offenders
  FROM "SiteConfig" c
  WHERE (c."key" = 'catNapStyle'
          AND lower(btrim(c."value")) NOT IN
              ('tooltip','ring','halo','pixel','moon','ticks','random','off'))
     OR (c."key" IN ('projectsVersion','backgroundVersion')
          AND c."value" NOT IN ('v1','v2'));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'enum-bound keys outside their label set: %', offenders;
  END IF;

  IF (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live') <> 1 THEN
    RAISE EXCEPTION
      'HeroContent has % live rows, so the legacy heroVersion row is not safely droppable',
      (SELECT count(*) FROM "HeroContent" WHERE "live" = 'live');
  END IF;
END
$$;

-- 5. The backfill. One row, built from the 26 key/value rows.
--
--    The pivot is a single aggregate over "SiteConfig" (max() FILTER per key,
--    which is exact because "SiteConfig_key_key" makes the key unique) rather
--    than 23 scalar subqueries, so the table is read once. A missing key yields
--    NULL, and every COALESCE below falls back to the same default the column
--    declares — but step 4 has already proved no carried key is missing, so no
--    fallback fires on this data.
--
--    ON CONFLICT DO NOTHING is unreachable given preflight P1 (target absent);
--    it is there so a re-run after a rolled-back attempt cannot fail on a row
--    someone created by hand, and DO NOTHING rather than DO UPDATE so this
--    statement can never overwrite a row it did not write.
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
  FROM "SiteConfig"
), typed AS (
  SELECT
    coalesce(cfg."name", '')          AS "name",
    coalesce(cfg."avatarUrl", '')     AS "avatarUrl",

    -- split ',' -> btrim -> drop empties -> keep order. Identical to
    -- data.ts:104-108 (.split(",").map(trim).filter(Boolean)), which is what
    -- makes this a re-encoding rather than a change of meaning.
    coalesce((
      SELECT array_agg(btrim(u.x) ORDER BY u.ord)
      FROM unnest(string_to_array(coalesce(cfg."heroPhotos", ''), ',')) WITH ORDINALITY AS u(x, ord)
      WHERE btrim(u.x) <> ''
    ), ARRAY[]::text[])               AS "heroPhotos",

    coalesce(cfg."resumeUrl", '')     AS "resumeUrl",

    -- Same asymmetry the readers have: projectsVersion falls back to v2,
    -- backgroundVersion to v1. Step 4 proved both hold a real label, so the
    -- ELSE branch is not exercised here.
    (CASE WHEN cfg."projectsVersion"   = 'v1' THEN 'v1' ELSE 'v2' END)::"SiteVersion" AS "projectsVersion",
    (CASE WHEN cfg."backgroundVersion" = 'v2' THEN 'v2' ELSE 'v1' END)::"SiteVersion" AS "backgroundVersion",

    CASE WHEN btrim(coalesce(cfg."heroDotColor", '')) ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
         THEN btrim(cfg."heroDotColor") ELSE '' END                    AS "heroDotColor",

    -- 'on'/'off' -> boolean. `<> 'off'` and not `= 'on'`, because that is what
    -- every reader does (data.ts:116) and what the admin validator writes.
    coalesce(cfg."heroDotPulse", 'on')       <> 'off'                  AS "heroDotPulse",

    coalesce(cfg."navbarLogo", '')            AS "navbarLogo",
    coalesce(cfg."copyrightName", '')         AS "copyrightName",
    coalesce(cfg."contactEmail", '')          AS "contactEmail",
    coalesce(cfg."availabilityStatus", '')    AS "availabilityStatus",
    coalesce(cfg."availabilityDetail", '')    AS "availabilityDetail",

    -- numeric string -> int, clamped to the same range as the CHECK. The clamp
    -- is dead code on this data (step 4 proves it) and is kept so the statement
    -- cannot violate the constraint it just added on some other snapshot.
    least(100, greatest( 10, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainStrength",   '')), 'integer')
                                   THEN btrim(cfg."terrainStrength")::int   ELSE 50 END)) AS "terrainStrength",
    least( 90, greatest(  0, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainVeil",       '')), 'integer')
                                   THEN btrim(cfg."terrainVeil")::int       ELSE 50 END)) AS "terrainVeil",
    least( 28, greatest(  8, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainCell",       '')), 'integer')
                                   THEN btrim(cfg."terrainCell")::int       ELSE 12 END)) AS "terrainCell",
    least( 24, greatest(  4, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainLevels",     '')), 'integer')
                                   THEN btrim(cfg."terrainLevels")::int     ELSE 14 END)) AS "terrainLevels",
    least( 60, greatest(  2, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainMinor",      '')), 'integer')
                                   THEN btrim(cfg."terrainMinor")::int      ELSE 20 END)) AS "terrainMinor",
    least( 90, greatest(  5, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."terrainMajor",      '')), 'integer')
                                   THEN btrim(cfg."terrainMajor")::int      ELSE 48 END)) AS "terrainMajor",

    coalesce(cfg."terrainChannel", 'on')     <> 'off'                  AS "terrainChannel",
    coalesce(cfg."terrainInteractive", 'on') <> 'off'                  AS "terrainInteractive",

    -- The enum's labels ARE the lowercase strings, so the stored text does not
    -- move: 'moon' in, 'moon' out.
    CASE WHEN lower(btrim(coalesce(cfg."catNapStyle", ''))) IN
              ('tooltip','ring','halo','pixel','moon','ticks','random','off')
         THEN lower(btrim(cfg."catNapStyle"))::"CatNapStyle"
         ELSE 'ticks'::"CatNapStyle" END                               AS "catNapStyle",

    least(300, greatest(  3, CASE WHEN pg_input_is_valid(btrim(coalesce(cfg."catNapSeconds",     '')), 'integer')
                                   THEN btrim(cfg."catNapSeconds")::int    ELSE 30 END)) AS "catNapSeconds"
  FROM cfg
)
INSERT INTO "SiteSettings" (
  "id",
  "name", "avatarUrl", "heroPhotos", "resumeUrl",
  "projectsVersion", "backgroundVersion",
  "heroDotColor", "heroDotPulse",
  "navbarLogo", "copyrightName",
  "contactEmail", "availabilityStatus", "availabilityDetail",
  "terrainStrength", "terrainVeil", "terrainCell", "terrainLevels",
  "terrainMinor", "terrainMajor", "terrainChannel", "terrainInteractive",
  "catNapStyle", "catNapSeconds",
  "createdAt", "updatedAt"
)
SELECT
  1,
  t."name", t."avatarUrl", t."heroPhotos", t."resumeUrl",
  t."projectsVersion", t."backgroundVersion",
  t."heroDotColor", t."heroDotPulse",
  t."navbarLogo", t."copyrightName",
  t."contactEmail", t."availabilityStatus", t."availabilityDetail",
  t."terrainStrength", t."terrainVeil", t."terrainCell", t."terrainLevels",
  t."terrainMinor", t."terrainMajor", t."terrainChannel", t."terrainInteractive",
  t."catNapStyle", t."catNapSeconds",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM typed t
ON CONFLICT ("id") DO NOTHING;

-- 6. Exactly one row landed. An aggregate over an empty "SiteConfig" would have
--    produced one all-defaults row and an aggregate is never zero rows, so this
--    is a real assertion, not a formality.
DO $$
BEGIN
  IF (SELECT count(*) FROM "SiteSettings") <> 1 THEN
    RAISE EXCEPTION 'SiteSettings holds % rows after the backfill, expected 1',
      (SELECT count(*) FROM "SiteSettings");
  END IF;
END
$$;

-- 7. Drop the source. No foreign key, no view and no sequence depends on
--    "SiteConfig", so no CASCADE: if something unexpected does depend on it,
--    RESTRICT is the behaviour we want and the error is the information.
--    The unique index "SiteConfig_key_key" and the primary key
--    "SiteConfig_pkey" go with the table.
--
--    CODE COUPLING: five call sites still read prisma.siteConfig —
--      apps/web/app/lib/data.ts:72            (every public page)
--      apps/docs/app/lib/actions/site-config.ts:93,106
--      apps/docs/app/lib/actions/links.ts:11  (resumeUrl upsert)
--      apps/docs/app/lib/media-references.ts:25
--    all of which return 42P01 the moment this runs. That is acceptable on this
--    branch because it serves no traffic; on production this drop must land
--    after the deploy that cuts those five over to "SiteSettings".
DROP TABLE IF EXISTS "SiteConfig";


-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------

-- V1. Shape: one row, source gone, both enum types present.
SELECT
  (SELECT count(*) FROM "SiteSettings")                AS settings_rows,
  to_regclass('public."SiteConfig"')   IS NULL         AS site_config_dropped,
  to_regtype('"CatNapStyle"')          IS NOT NULL     AS cat_nap_style_exists,
  to_regtype('"SiteVersion"')          IS NOT NULL     AS site_version_exists;
-- expect: settings_rows = 1, site_config_dropped = t, both types = t

-- V2. Every carried value, compared against /tmp/v2/data-facts.txt. One row,
--     every column t. A single f names the column that was coerced wrongly.
SELECT
  "id" = 1                                                       AS id_ok,
  "name" = 'Yatin Dora'                                          AS name_ok,
  "avatarUrl" = '/mine/avatar.png'                               AS avatar_ok,
  "heroPhotos" = ARRAY['/mine/avatar.png','/mine/avatar2.jpeg']  AS hero_photos_ok,
  "resumeUrl" = 'https://drive.google.com/file/d/16xisMxquk1njqUeEQFN8Mi6E6vwJF6sr/view?usp=sharing'
                                                                 AS resume_ok,
  "projectsVersion" = 'v2'                                       AS projects_version_ok,
  "backgroundVersion" = 'v2'                                     AS background_version_ok,
  "heroDotColor" = '#22C55E'                                     AS hero_dot_color_ok,
  "heroDotPulse" IS TRUE                                         AS hero_dot_pulse_ok,
  "navbarLogo" = 'Yatin.Dora'                                    AS navbar_logo_ok,
  "copyrightName" = 'Yatin Dora'                                 AS copyright_ok,
  "contactEmail" = 'yatin.dora81@gmail.com'                      AS contact_email_ok,
  "availabilityStatus" = 'Available for opportunities'            AS availability_status_ok,
  "availabilityDetail" = 'Open to freelance, full-time & collaborations'
                                                                 AS availability_detail_ok,
  "terrainStrength" = 45                                         AS terrain_strength_ok,
  "terrainVeil" = 52                                             AS terrain_veil_ok,
  "terrainCell" = 16                                             AS terrain_cell_ok,
  "terrainLevels" = 15                                           AS terrain_levels_ok,
  "terrainMinor" = 18                                            AS terrain_minor_ok,
  "terrainMajor" = 51                                            AS terrain_major_ok,
  "terrainChannel" IS TRUE                                       AS terrain_channel_ok,
  "terrainInteractive" IS TRUE                                   AS terrain_interactive_ok,
  "catNapStyle"::text = 'moon'                                   AS cat_nap_style_ok,
  "catNapSeconds" = 45                                           AS cat_nap_seconds_ok,
  "createdAt" IS NOT NULL AND "updatedAt" IS NOT NULL            AS stamps_ok
FROM "SiteSettings";
-- expect: 1 row, every column t

-- V3. heroPhotos really is an ordered 2-element array with no blank element,
--     not a one-element array still holding the comma-joined string.
SELECT
  array_length("heroPhotos", 1)                        AS photo_count,
  "heroPhotos"[1]                                      AS top_card,
  "heroPhotos"[2]                                      AS second_card,
  NOT EXISTS (SELECT 1 FROM unnest("heroPhotos") AS u(p) WHERE btrim(u.p) = '')
                                                       AS no_blank_elements
FROM "SiteSettings";
-- expect: photo_count = 2, top_card = '/mine/avatar.png',
--         second_card = '/mine/avatar2.jpeg', no_blank_elements = t

-- V4. All ten CHECKs are present, under the names the inventory names, plus the
--     primary key. Nothing else.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"SiteSettings"'::regclass
  AND contype IN ('c', 'p')   -- 'n' too on PG18+, where NOT NULLs became rows here
ORDER BY contype, conname;
-- expect: 11 rows —
--   c  SiteSettings_catNapSeconds_check
--   c  SiteSettings_heroDotColor_check
--   c  SiteSettings_heroPhotos_check
--   c  SiteSettings_id_check
--   c  SiteSettings_terrainCell_check
--   c  SiteSettings_terrainLevels_check
--   c  SiteSettings_terrainMajor_check
--   c  SiteSettings_terrainMinor_check
--   c  SiteSettings_terrainStrength_check
--   c  SiteSettings_terrainVeil_check
--   p  SiteSettings_pkey
-- (plus the implicit NOT NULLs, which are attnotnull and not rows here)

-- V5. Column shape, so a `prisma migrate diff` surprise is caught here instead
--     of in the diff: 26 columns, id integer DEFAULT 1, heroPhotos a text array,
--     the two version columns and catNapStyle USER-DEFINED.
SELECT ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'SiteSettings'
ORDER BY ordinal_position;
-- expect: 26 rows.
--   id                 integer      int4         NO   1
--   name               text         text         NO   ''::text
--   avatarUrl          text         text         NO   ''::text
--   heroPhotos         ARRAY        _text        YES  ARRAY[]::text[]
--   resumeUrl          text         text         NO   ''::text
--   projectsVersion    USER-DEFINED SiteVersion  NO   'v2'::"SiteVersion"
--   backgroundVersion  USER-DEFINED SiteVersion  NO   'v1'::"SiteVersion"
--   heroDotColor       text         text         NO   ''::text
--   heroDotPulse       boolean      bool         NO   true
--   navbarLogo         text         text         NO   ''::text
--   copyrightName      text         text         NO   ''::text
--   contactEmail       text         text         NO   ''::text
--   availabilityStatus text         text         NO   ''::text
--   availabilityDetail text         text         NO   ''::text
--   terrainStrength    integer      int4         NO   50
--   terrainVeil        integer      int4         NO   50
--   terrainCell        integer      int4         NO   12
--   terrainLevels      integer      int4         NO   14
--   terrainMinor       integer      int4         NO   20
--   terrainMajor       integer      int4         NO   48
--   terrainChannel     boolean      bool         NO   true
--   terrainInteractive boolean      bool         NO   true
--   catNapStyle        USER-DEFINED CatNapStyle  NO   'ticks'::"CatNapStyle"
--   catNapSeconds      integer      int4         NO   30
--   createdAt          timestamp…   timestamp    NO   CURRENT_TIMESTAMP
--   updatedAt          timestamp…   timestamp    NO   (null)

-- V6. Enum labels, in declaration order, matching schema.prisma.
SELECT enum_range(NULL::"CatNapStyle") AS cat_nap_style,
       enum_range(NULL::"SiteVersion") AS site_version;
-- expect: cat_nap_style = {tooltip,ring,halo,pixel,moon,ticks,random,off}
--         site_version  = {v1,v2}

-- V7. The legacy pointer really is carried by HeroContent, which is the only
--     reason dropping SiteConfig.heroVersion is allowed.
SELECT "version", "live" FROM "HeroContent" ORDER BY "version";
-- expect: 2 rows — ('v1', NULL) and ('v2', 'live')

-- V8. OPTIONAL negative probes for the CHECKs. Left commented out on purpose:
--     each one is expected to RAISE, which aborts the transaction under
--     ON_ERROR_STOP. Run them one at a time, each inside its own
--     SAVEPOINT … ROLLBACK TO SAVEPOINT, and only on a throwaway branch.
--       SAVEPOINT probe;
--         UPDATE "SiteSettings" SET "terrainCell" = 4;            -- 23514
--         UPDATE "SiteSettings" SET "catNapSeconds" = 1;          -- 23514
--         UPDATE "SiteSettings" SET "heroDotColor" = 'green';     -- 23514
--         UPDATE "SiteSettings" SET "heroPhotos" = ARRAY['/a',' ']; -- 23514
--         INSERT INTO "SiteSettings" ("id","updatedAt") VALUES (2, now()); -- 23514
--       ROLLBACK TO SAVEPOINT probe;
