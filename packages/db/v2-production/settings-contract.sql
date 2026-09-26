-- ============================================================================
-- PRODUCTION CUTOVER · cluster "settings" · CONTRACT
-- Retire "SiteConfig" and the dual-write machinery.
--
-- DO NOT RUN ANY OF THIS UNTIL v2 IS DEPLOYED AND VERIFIED.
-- Every statement in this file is fatal to the v1 code. There is no additive
-- version of "drop the table".
--
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f settings-contract.sql
--
-- ----------------------------------------------------------------------------
-- WHY THE ORDER IS NOT NEGOTIABLE
-- ----------------------------------------------------------------------------
-- "SiteConfig" is not on the render path of one section, it is on the render
-- path of the entire public site. The ROOT LAYOUT reads it:
--     HEAD:apps/web/app/layout.tsx:69      getSiteConfig()
--     HEAD:apps/web/app/lib/data.ts:70-72  prisma.siteConfig.findMany()
-- so v1 rendering ANY route — /, /blog, /blog/[slug], not-found, error — with
-- "SiteConfig" gone raises 42P01 inside the layout. That is a whole-site 500,
-- not a missing section. Same for the admin: nine v1 read sites, listed in
-- settings-expand.sql.
--
-- ISR does not save you here, and it is worth being exact about why.
--   * apps/web/app/page.tsx:276 is `export const revalidate = 86400` and
--     data.ts wraps the read in unstable_cache with the same lifetime and the
--     tag 'site-config'. Warm HTML therefore survives a schema change for up to
--     a day, and a FAILED background regeneration keeps serving the last good
--     HTML. That is the "helps" half, and it is luck, not a guarantee.
--   * It hurts on any path with no warm entry, and on any forced flush. A POST
--     to /api/revalidate (HEAD:apps/web/app/api/revalidate/route.ts:37-43 —
--     with no body it calls revalidatePath("/", "layout"), which flushes every
--     route under the root layout) makes the next request re-render from
--     scratch. If that render is still v1 and "SiteConfig" is gone, the visitor
--     gets an error page.
-- So the protection is the ordering, not the cache.
--
-- One more drain to respect: Vercel flips the production alias atomically, but
-- a request already executing on the previous deployment finishes there, and
-- the previous deployment stays reachable at its own URL forever. Give it a few
-- minutes, and do not run CONTRACT from the same terminal session as the push.
--
-- The data cache does NOT paper over a bad deploy, which is what makes the gate
-- below meaningful: unstable_cache derives its key from the callback source —
--   apps/web/node_modules/next/dist/server/web/spec-extension/unstable-cache.js:55
--     const fixedKey = `${cb.toString()}-${keyParts.join(',')}`
-- and v2's readSiteConfig body differs from v1's, so v2 cannot serve v1's cached
-- payload. The first v2 render goes to the database and hits
-- prisma.siteSettings.findUniqueOrThrow (apps/web/app/lib/data.ts:64). If the
-- backfill were wrong or the row missing, you see it immediately, not in a day.
--
-- ----------------------------------------------------------------------------
-- WHAT IS ACTUALLY LOST HERE
-- ----------------------------------------------------------------------------
-- The 23 carried keys: nothing, they live in "SiteSettings".
-- The 3 legacy keys die with the table:
--   heroVersion = 'v1'  — stale and unread. HEAD:apps/web/app/lib/data.ts:76-77
--                         derives the served version from HeroContent.live,
--                         which is on the v2 row. The site serves v2 while this
--                         row says v1.
--   intro, tagline      — superseded by HeroContent.intro/.tagline, which is
--                         where HEAD:data.ts:78-79 reads them from. The 2026-07-28
--                         add_hero_content migration seeded HeroContent FROM
--                         these two rows, so any difference today is a later
--                         admin edit and HeroContent holds the newer copy.
-- Step C4 moves the whole table, legacy rows included, into a side schema
-- instead of dropping it, so nothing is destroyed until C5 and the undo is a
-- one-line rename rather than a restore from the JSON dump.
-- ============================================================================


-- ############################################################################
-- THE GATE — all four must be true before you run one statement below
-- ############################################################################
--
-- G1. HUMAN CHECK, not SQL. The Vercel deployment for BOTH projects (web and
--     docs) is Ready and promoted to the production alias, and the build log
--     shows `prisma generate` running from the turbo graph (see the
--     PREREQUISITE block in settings-expand.sql).
--
-- G2. HUMAN CHECK. https://www.yatindora.in renders with the right name,
--     navbar logo, avatar, photo deck, availability pill, dot colour and
--     background layer, AFTER a forced flush so you are not reading old HTML:
--       curl -s -X POST https://www.yatindora.in/api/revalidate \
--            -H "x-revalidate-secret: $REVALIDATE_SECRET" \
--            -H 'content-type: application/json' \
--            -d '{"tags":["site-config"]}'
--     then hard-reload. A 500 here means v2 cannot read "SiteSettings" — STOP,
--     and note that rolling back to v1 is still free at this point because
--     "SiteConfig" is untouched.
--
-- G3. HUMAN CHECK. The admin /site-config, /background, /hero, /cat,
--     /contact-purposes and /projects pages all render, and ONE save round-trips
--     (change the copyright name, save, reload, change it back). That save is
--     the proof v2's write path works: apps/docs/app/lib/actions/site-config.ts:61
--     is `prisma.siteSettings.update({ where: { id: 1 }, data })` — an update,
--     not an upsert, so it throws P2025 if the row is missing.
--
-- G4. SQL. The v2 write path has actually written, and "SiteSettings" is the
--     live side.
SELECT "id", "updatedAt",
       "updatedAt" > now() - interval '1 hour' AS written_by_v2_recently,
       "name" <> '' AND "navbarLogo" <> '' AND "contactEmail" <> '' AS not_all_defaults
FROM "SiteSettings";
-- expect: 1 row, id = 1, not_all_defaults = t, and written_by_v2_recently = t if
--   you did the G3 save. If it is f, you have not proved v2 can write; go do G3.

-- G5. SQL, informational. From here on the two tables are allowed to disagree:
--     anything v2 wrote since DEPLOY is in "SiteSettings" only, because nothing
--     in v2 writes "SiteConfig" (the v2 action writes prisma.siteSettings and
--     apps/docs/app/lib/actions/links.ts:11 writes prisma.siteSettings). Print
--     the divergence so it is a deliberate goodbye rather than a surprise.
SELECT c."key", c."value" AS last_v1_value FROM "SiteConfig" c ORDER BY c."key";
-- expect: 26 rows. Eyeball them. This is the last time they exist.


-- ############################################################################
-- C1. Stop the dual write.  ONE SHORT TRANSACTION.
-- ############################################################################
-- Inert since DEPLOY (v2 never writes "SiteConfig", so the trigger never fires)
-- but it must go before C4, and the resync function MUST go with it: a plpgsql
-- body is not dependency-checked, so moving or dropping "SiteConfig" leaves the
-- function silently broken and, worse, callable. Dropping it is what makes it
-- impossible to accidentally revert every v2 setting with one SELECT.

BEGIN;
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS "SiteConfig_resync_v2" ON public."SiteConfig";
DROP FUNCTION IF EXISTS public.site_settings_resync_v2_trg();
DROP FUNCTION IF EXISTS public.site_settings_resync_v2();

COMMIT;

-- v1 after C1: still works. The trigger and the functions are objects v1 has
-- never heard of; removing them restores exactly the pre-EXPAND behaviour of
-- "SiteConfig". C1 is the one statement in this file that is NOT fatal to v1,
-- and the only cost of running it is that a v1 rollback would no longer keep
-- "SiteSettings" fed.


-- ############################################################################
-- C2..C4. Retire the table.  ONE TRANSACTION.   <-- FATAL TO v1 FROM HERE
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '3s';

-- C2. Refuse to proceed if the target is not sound. Cheap insurance against
--     running this file against the wrong branch or before EXPAND.
DO $$
BEGIN
  IF to_regclass('public."SiteSettings"') IS NULL THEN
    RAISE EXCEPTION 'SiteSettings does not exist — EXPAND has not run on this database';
  END IF;
  IF (SELECT count(*) FROM public."SiteSettings") <> 1 THEN
    RAISE EXCEPTION 'SiteSettings holds % rows, expected exactly 1',
      (SELECT count(*) FROM public."SiteSettings");
  END IF;
  IF (SELECT "name" = '' AND "navbarLogo" = '' AND "contactEmail" = ''
      FROM public."SiteSettings" WHERE "id" = 1) THEN
    RAISE EXCEPTION 'SiteSettings is all-defaults — the backfill never landed, dropping SiteConfig would lose all 26 settings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
             WHERE tgrelid = 'public."SiteConfig"'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'the dual-write trigger is still on SiteConfig — run C1 first';
  END IF;
END
$$;

-- C3. A side schema Prisma cannot see. The datasource declares no `schemas`
--     list, so Prisma introspects `public` only and `prisma migrate diff` stays
--     empty — which is why this goes in legacy_v1 rather than being renamed to
--     public."SiteConfig_legacy". Owner-level: the role owns the database.
CREATE SCHEMA IF NOT EXISTS legacy_v1;
COMMENT ON SCHEMA legacy_v1 IS
  'v1 tables retired by the v2 cutover. Nothing reads these. Safe to drop once a production dump taken after the cutover has been verified.';

-- C4. Move, do not drop. The table, its primary key and "SiteConfig_key_key"
--     all follow it. Effect on v1 is IDENTICAL to a drop — public."SiteConfig"
--     stops resolving and every v1 read and write raises 42P01 — so this is a
--     CONTRACT statement, not an EXPAND one. The difference is the undo: a
--     single SET SCHEMA back, with the original uuid ids intact, instead of a
--     CREATE TABLE plus a restore from the JSON dump.
ALTER TABLE public."SiteConfig" SET SCHEMA legacy_v1;

COMMIT;

-- v1 after C4: BROKEN, deliberately and completely. Specifically:
--   * every public route 500s, because the root layout's
--     prisma.siteConfig.findMany() (HEAD:apps/web/app/lib/data.ts:72) raises
--     42P01 relation "public.SiteConfig" does not exist;
--   * the nine v1 admin read sites 500 the same way;
--   * v1's two write paths — updateSiteConfig's upsert
--     (HEAD:apps/docs/app/lib/actions/site-config.ts:106) and updateResumeUrl's
--     upsert (HEAD:apps/docs/app/lib/actions/links.ts:11) — fail with P2021.
-- v2 after C4: unaffected. No v2 query names "SiteConfig"; the working-tree
-- grep is clean apart from the identifier `siteConfig` used as a cache tag
-- (packages/shared/src/tags.ts:6) and as a local variable name in
-- apps/web/app/page.tsx, neither of which is a table.


-- ############################################################################
-- C5. THE SOAK DROP — a separate session, days later, not part of the cutover
-- ############################################################################
-- Leave legacy_v1."SiteConfig" in place for at least one full cache lifetime
-- (86400s, apps/web/app/lib/data.ts:8) and preferably until a fresh production
-- dump taken AFTER the cutover has been verified. It is 26 rows; it costs
-- nothing to keep and it is the only remaining copy of heroVersion, intro and
-- tagline as v1 stored them.
--
-- Run C5 only when the whole v2 cutover is settled, because at that point
-- rolling back to v1 requires a restore either way.
--
--   BEGIN;
--     DROP TABLE legacy_v1."SiteConfig";     -- RESTRICT: no FK, view or sequence
--                                            -- depends on it, so no CASCADE. If
--                                            -- something does, the error is the
--                                            -- information.
--     DROP SCHEMA legacy_v1;                 -- only if no other cluster parked
--                                            -- a table here; plain DROP, not
--                                            -- CASCADE, so it refuses if one did
--   COMMIT;


-- ############################################################################
-- VERIFICATION
-- ############################################################################

-- W1. The swap happened and nothing else moved.
SELECT to_regclass('public."SiteConfig"')     IS NULL     AS public_site_config_gone,
       to_regclass('legacy_v1."SiteConfig"')  IS NOT NULL AS archived,
       (SELECT count(*) FROM legacy_v1."SiteConfig")       AS archived_rows,
       (SELECT count(*) FROM public."SiteSettings")        AS settings_rows;
-- expect: t / t / 26 / 1

-- W2. No dual-write machinery left anywhere.
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname LIKE 'site_settings_resync_v2%') AS resync_functions,
       (SELECT count(*) FROM pg_trigger t
         WHERE t.tgrelid = 'legacy_v1."SiteConfig"'::regclass AND NOT t.tgisinternal) AS triggers_left;
-- expect: 0 / 0

-- W3. Nothing in `public` still references the old table, so a Prisma diff is
--     clean for this cluster: one table named SiteSettings, no table named
--     SiteConfig, both enum types present.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('SiteConfig', 'SiteSettings');
-- expect: exactly one row, 'SiteSettings'

-- W4. The settings the site is now serving, for the record.
SELECT "name", "navbarLogo", "avatarUrl", "heroPhotos", "resumeUrl",
       "projectsVersion", "backgroundVersion", "heroDotColor", "heroDotPulse",
       "catNapStyle", "catNapSeconds", "terrainStrength", "terrainVeil",
       "terrainCell", "terrainLevels", "terrainMinor", "terrainMajor",
       "terrainChannel", "terrainInteractive", "contactEmail",
       "availabilityStatus", "availabilityDetail", "copyrightName", "updatedAt"
FROM "SiteSettings";
-- expect: 1 row matching the live site. Compare against W1's archived_rows copy
--   in legacy_v1 if anything looks wrong; that is what it is there for.

-- W5. HUMAN CHECK. Re-flush and reload the public site once more after C4, so a
--     render happens with "SiteConfig" genuinely absent:
--       curl -s -X POST https://www.yatindora.in/api/revalidate \
--            -H "x-revalidate-secret: $REVALIDATE_SECRET" \
--            -H 'content-type: application/json' -d '{}'
--     A 200 and a correct page is the end of this cluster. `{}` with no paths
--     and no tags is the `revalidatePath("/", "layout")` branch
--     (HEAD:apps/web/app/api/revalidate/route.ts:37-39), which is the widest
--     flush available and therefore the honest test.


-- ############################################################################
-- ROLLBACK
-- ############################################################################
-- Between C1 and C4 (nothing has moved yet): re-run STEP B of
-- settings-expand.sql to put the function and trigger back. Zero data risk.
--
-- After C4, before C5 — undo is one statement, and it makes v1 servable again:
--   BEGIN;
--     ALTER TABLE legacy_v1."SiteConfig" SET SCHEMA public;
--   COMMIT;
--   -- then, if you are also reverting the code deploy, re-run STEP B of
--   -- settings-expand.sql, and be aware "SiteConfig" is now STALE with respect
--   -- to anything the admin saved while v2 was live: nothing in v2 writes
--   -- "SiteConfig" (apps/docs/app/lib/actions/site-config.ts:61,
--   -- apps/docs/app/lib/actions/links.ts:11 both write prisma.siteSettings).
--   -- Reconcile by hand from "SiteSettings" before you trust the v1 site:
--   --   SELECT ... FROM "SiteSettings"   (W4 above prints everything you need)
--   -- There is no reverse trigger installed, by choice: it would have to run on
--   -- production for the whole post-deploy soak to be useful, and it is only
--   -- useful in a scenario where you are already hand-editing 23 values.
--
-- After C5: the table is gone. Recreate it from the read-only JSON dump —
--   CREATE TABLE "SiteConfig" (
--     "id" TEXT NOT NULL, "key" TEXT NOT NULL, "value" TEXT NOT NULL,
--     CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id"));
--   CREATE UNIQUE INDEX "SiteConfig_key_key" ON "SiteConfig"("key");
-- then `bun run db:restore` for that one table, with the ORIGINAL uuid ids.
-- Nothing references those ids, but keeping them keeps the database comparable
-- with the dump.
--
-- Rolling back EXPAND itself (only sane while v1 is still deployed):
--   BEGIN;
--     DROP TRIGGER IF EXISTS "SiteConfig_resync_v2" ON public."SiteConfig";
--     DROP FUNCTION IF EXISTS public.site_settings_resync_v2_trg();
--     DROP FUNCTION IF EXISTS public.site_settings_resync_v2();
--     DROP TABLE IF EXISTS public."SiteSettings";
--     DROP TYPE IF EXISTS "CatNapStyle";
--     -- "SiteVersion" ONLY if the version-column cluster has not run and no
--     -- column uses it. Check first:
--     --   SELECT c.relname, a.attname FROM pg_attribute a
--     --     JOIN pg_class c ON c.oid = a.attrelid
--     --    WHERE a.atttypid = '"SiteVersion"'::regtype AND NOT a.attisdropped;
--     -- DROP TYPE IF EXISTS "SiteVersion";
--   COMMIT;
-- "SiteConfig" is untouched throughout, so this is a true zero-loss undo.
