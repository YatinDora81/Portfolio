-- =====================================================================
-- PRODUCTION CUTOVER · cluster: experience-education · STAGE 1 of 2: EXPAND
--
-- Run this WHILE THE v1 CODE IS STILL DEPLOYED AND SERVING.
-- Target: production Neon (PROD_DATABASE_URL), Postgres 17, role = owner,
-- NOT superuser. Nothing below needs superuser: no session_replication_role,
-- no ALTER TYPE ... ADD VALUE, no extension, no CONCURRENTLY.
--
-- Use the DIRECT (non-pooled) Neon endpoint, not the -pooler host. DDL in a
-- transaction through PgBouncer in transaction mode is a coin flip.
--
-- `bun run db:apply-sql` REFUSES the host in PROD_DATABASE_URL by design
-- (packages/db/scripts/apply-sql.ts). Run this with psql against the direct
-- endpoint. Do not weaken that guard.
--
-- ---------------------------------------------------------------------
-- WHAT THIS STAGE ACHIEVES
--
--   Experience:  gains startedOn DATE / endedOn DATE, backfilled, beside the
--                surviving startDate / endDate / isCurrent. Plus logoAssetId
--                + FK + index, createdAt / updatedAt, and three CHECKs.
--   Education:   gains startYearInt INTEGER / endYearInt INTEGER, backfilled,
--                beside the surviving TEXT startYear / endYear. Plus
--                createdAt / updatedAt and three CHECKs.
--   Both:        a BEFORE INSERT OR UPDATE trigger that keeps the old and the
--                new columns in step IN BOTH DIRECTIONS for as long as both
--                exist. That trigger is the whole answer to "who keeps them
--                in step during the window".
--
-- After this commits, EVERY v1 read and EVERY v1 write still works. Proof,
-- statement by statement, is inline. The only v1 behaviour that changes is
-- that a malformed admin save is now REJECTED instead of stored; see
-- "WHAT THIS STAGE TAKES AWAY FROM v1" below.
--
-- ---------------------------------------------------------------------
-- THE ONE THING THAT IS NOT ADDITIVE, AND THE DECISION TAKEN
--
-- Experience is a rename (startDate -> startedOn), so it expands cleanly:
-- old and new columns can coexist because they have different names.
--
-- Education is NOT. v2 keeps the column NAMES startYear / endYear and only
-- changes their TYPE, TEXT -> INTEGER. One physical column cannot be TEXT for
-- the deployed v1 client and INTEGER for the v2 client at the same instant:
--
--   * v1 reads it.  git show HEAD:apps/web/app/lib/data.ts       :173-174
--                   git show HEAD:apps/docs/app/(dashboard)/about/page.tsx
--                                                                :151, :203-204
--     Prisma decodes a result column against the declared field type. An int4
--     column arriving in a `String` field is at best silently a JS number in a
--     field typed string, at worst a hard "Inconsistent column data" throw.
--     I could not prove which without connecting to a database, which is
--     forbidden here, so treat it as a throw.
--   * v1 writes it.  git show HEAD:apps/docs/app/lib/actions/staging.ts
--                                                                :522-523, :656-657
--     Both send a TEXT string.
--   * v1's endYear field is non-nullable (`endYear String`), so the v2 meaning
--     of "still enrolled" (NULL) is unrepresentable to v1 even if the type
--     did survive.
--
-- So the retype cannot go in EXPAND as-is. Three options, honestly:
--
--   A (CHOSEN, implemented in section E below) — retype under a different
--     PHYSICAL name and let Prisma bridge the gap with @map. Two lines in
--     packages/db/prisma/schema.prisma, model Education:
--
--         startYear   Int  @map("startYearInt")
--         endYear     Int? @map("endYearInt")
--
--     The Prisma FIELD names stay startYear / endYear, so not one line of
--     TypeScript changes and the six v2 call sites compile untouched. Zero
--     window: v1 keeps its TEXT columns, v2 reads the INTEGER ones, the
--     trigger keeps both true. Cost: the physical columns are called
--     startYearInt / endYearInt from now on (or forever, which is fine), and
--     three follow-ups are mandatory:
--       1. `cd packages/db && bun run db:generate`
--       2. regenerate packages/db/v2-migration-draft/target-ddl.sql, so
--          `bun run db:verify` stays clean
--       3. run `ALTER TABLE "Education" RENAME COLUMN "startYear" TO
--          "startYearInt"; ALTER TABLE "Education" RENAME COLUMN "endYear" TO
--          "endYearInt";` ON THE NEON CHILD BRANCH TOO — the branch already
--          has the canonical INTEGER names, so without this the local dev DB
--          stops matching the schema the moment @map lands. (That is a write
--          to the branch. Not done here; it is yours to run.)
--
--   B — retype Education in place, accepting a window. The retype itself is
--     one transaction on a ONE-ROW table, milliseconds. The window is not the
--     ALTER, it is the gap until v2 serves, and it cannot be closed from the
--     database side, because THE VERCEL BUILD READS PRODUCTION: apps/web's
--     landing page is `export const revalidate = 86400` with no
--     force-dynamic (git show HEAD:apps/web/app/page.tsx:276), i.e. it is
--     prerendered at build time, and getAboutData() reads Education during
--     that prerender. So the retype must land BEFORE the build starts, and
--     the window is the whole build + promote, 2-5 minutes, plus operator lag.
--     During it: the public landing page keeps serving the ISR HTML it already
--     has (Next keeps the last good entry when a background revalidation
--     throws), so no public 500 — but the admin /about page 500s, and a
--     revalidatePath('/') in that window silently fails to refresh. If the
--     build then fails for an unrelated reason you are stuck there until you
--     run the option-B rollback (exact for '2021'/'2025').
--
--   C — defer Education entirely: ship the Experience half now, leave
--     Education TEXT, do it in a second cutover. Costs nothing but time, and
--     requires the v2 Education model to stay `String` for one release, which
--     is a bigger code edit than option A's two lines.
--
--   RECOMMENDATION: A. It is the only one that honours "v1 keeps working at
--   every instant", it is two lines of schema, and it turns an unbounded
--   "hope nothing revalidates" risk into a naming compromise. Option B is
--   written out, commented, at the bottom of this file for whoever prefers a
--   canonical column name to a zero-length window. RUN EXACTLY ONE OF THEM.
--
-- ---------------------------------------------------------------------
-- WHAT THIS STAGE TAKES AWAY FROM v1 (read this, it is the honest part)
--
-- Today v1's two date inputs are free text with no validation beyond
-- non-empty: git show HEAD:apps/docs/app/(dashboard)/experiences/form.tsx
-- :110-111 (placeholders "e.g. July 2025" / "e.g. Present", `required` only),
-- and v1's education years go through req(), which only trims and rejects
-- empty: git show HEAD:apps/docs/app/lib/actions/staging.ts:328-332.
--
-- After this stage, a v1 admin save that the trigger cannot make sense of is
-- REJECTED instead of stored:
--   * a start date that is not a month ('Jul 25', 'summer 2025')  -> RAISE
--   * a non-current role whose end date is not a month            -> RAISE
--   * startDate after endDate on a non-current role  -> Experience_dates_order_check
--   * a startYear that is not four digits                          -> RAISE
--   * years outside 1950..2200, or endYear < startYear  -> Education_*_check
--
-- That is deliberate. The alternative is to store a value the v2 deploy then
-- cannot read, which turns an admin-visible error into a public one.
--
-- Two sharp edges:
--   * Experience saves surface the raw error, because createExperience /
--     updateExperience have no try/catch (git show
--     HEAD:apps/docs/app/lib/actions/experiences.ts:26-94) — the admin gets a
--     server-action error, nothing is written.
--   * EDUCATION saves DO NOT. v1's toMessage() swallows every non-StagingError
--     into "Couldn't save your changes. Nothing was applied." (git show
--     HEAD:apps/docs/app/lib/actions/staging.ts:260-266). The whole staged
--     batch rolls back and the reason is only in the Postgres log.
--     => During the window, do not stage Education edits. It is a one-row
--        table and a single admin; just wait.
--
-- ---------------------------------------------------------------------
-- WHAT THIS STAGE DELIBERATELY DOES NOT DO
--
--   * It does NOT drop startDate / endDate / isCurrent, or TEXT startYear /
--     endYear. Those are STAGE 2. Keeping them is also what keeps Vercel's
--     "instant rollback to the previous deployment" genuinely available.
--   * It does NOT run `ALTER COLUMN "updatedAt" DROP DEFAULT` on either
--     table, even though the target DDL has no default there
--     (packages/db/v2-migration-draft/target-ddl.sql:163, :194). v1 never
--     writes updatedAt: `git show HEAD:apps/docs/app/lib/actions/experiences.ts:30`
--     and `:513` of staging.ts omit it. NOT NULL with no default plus a v1
--     INSERT = 23502, a broken admin create, for both tables. The DROP
--     DEFAULT is in STAGE 2. Until then `prisma migrate diff` will report
--     those two defaults as drift; that is expected and temporary.
--   * It does NOT backfill Experience.logoAssetId. v1 renders logoUrl
--     (git show HEAD:apps/web/app/lib/data.ts:203) and knows nothing about
--     logoAssetId, and Experience_logo_source_check (section D) allows at
--     most one of the two. So adopting the two /logos/*.png files into
--     MediaAsset and pointing logoAssetId at them REQUIRES nulling logoUrl in
--     the same UPDATE, which would remove the logos from the live site. That
--     work is contract-side, and it belongs to the media cluster (70), not
--     here. Both rows leave this stage with logoAssetId = NULL.
--   * It does NOT touch AboutParagraph / ContactPurpose / Quote. Their
--     timestamps and Quote.sortOrder belong to cluster 45. Education's
--     timestamps are here, guarded with IF NOT EXISTS, so whichever cluster
--     runs second is a no-op.
--
-- ---------------------------------------------------------------------
-- CROSS-CLUSTER ORDERING
--
--   * Needs, before this file: "MediaAsset" must exist with its PK (it does —
--     20260822130000_add_links_rollup_media). If cluster 70's expand recreates
--     MediaAsset, run section D's FK after it.
--   * Needs, before the DEPLOY (not before this file): "ExperienceSkill" must
--     exist, because v2's getExperiences() and createExperience() use it
--     (apps/web/app/lib/data.ts:172, apps/docs/.../experiences.ts:56). That is
--     cluster 35's expand. This cluster does not depend on it.
--
-- ---------------------------------------------------------------------
-- THE BUILD BLOCKER, which this cluster cannot dodge
--
-- The generated client is gitignored (.gitignore:34 `**/generated/prisma`) and
-- nothing in the repo runs `prisma generate`. Two edits, and they are the
-- exact place:
--
--   1. packages/db/package.json, "scripts": add
--          "build": "prisma generate"
--      turbo.json's build task already declares "dependsOn": ["^build"], so
--      apps/web#build and apps/docs#build will now wait for db#build.
--      `datasource db` has no url (schema.prisma:6-8; the URL comes from
--      @prisma/adapter-pg at runtime), so generate needs no DATABASE_URL.
--   2. turbo.json, tasks.build.outputs: add "src/generated/**" alongside the
--      .next entries, or db#build's output is never cached and never restored.
--
-- Without those, the deploy still works only because the Vercel dashboard
-- carries an invisible custom command. Wire it in the repo before the cutover;
-- if the dashboard command and the turbo graph disagree, the worst case is
-- generate running twice, which is harmless.
--
-- ---------------------------------------------------------------------
-- HOW TO RUN
--
--   1. Run the PREFLIGHT block on its own and read every answer. It is all
--      SELECTs and it opens no locks. Do not run it inside the transaction:
--      an open transaction holds ACCESS EXCLUSIVE on Experience while you read
--      your screen, and ACCESS EXCLUSIVE blocks even a SELECT, which means
--      every public request that needs the timeline queues behind your eyes.
--   2. Run the BEGIN..COMMIT block in ONE shot, unattended:
--          psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -f <this file, from BEGIN>
--      It contains dollar-quoted DO blocks and functions. Feed it to psql, not
--      to a naive split-on-semicolon.
--   3. Run the VERIFICATION block and check it against the expected answers.
--   4. Only then push the code.
--
-- Idempotent: every ADD COLUMN is IF NOT EXISTS, every constraint is
-- DROP IF EXISTS + ADD, every function is CREATE OR REPLACE, both backfills
-- are guarded on IS NULL. Re-running the whole file is a no-op.
-- =====================================================================


-- #####################################################################
-- PREFLIGHT — run separately, outside any transaction. All reads.
-- #####################################################################

-- P1. Row counts. EXPECTED: experience 2, bullets 8, education 1.
SELECT (SELECT count(*) FROM "Experience")       AS experience_rows,
       (SELECT count(*) FROM "ExperienceBullet") AS bullet_rows,
       (SELECT count(*) FROM "Education")        AS education_rows;

-- P2. The exact Experience rows, so the backfill can be eyeballed.
-- EXPECTED, from packages/db/v2-migration-draft/data-facts.txt:
--   Wiingy | July 2025    | Present   | t | /logos/wiingy.png
--   Nykaa  | January 2025 | July 2025 | f | /logos/nykaa.png
SELECT "sortOrder", "company", "startDate", "endDate", "isCurrent", "logoUrl"
FROM "Experience" ORDER BY "sortOrder";

-- P3. ABORT GATE. Every startDate must be a full-English-month + year.
-- The month names are spelled out on purpose: to_date(...,'Month YYYY')
-- accepts 'July' and rejects 'Jul', and a lazy [a-z]+ would wave 'Jul 2025'
-- through to a mid-migration error instead of catching it here.
-- EXPECTED: 0
SELECT count(*) AS unparseable_start FROM "Experience"
WHERE btrim("startDate") !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P4. ABORT GATE. Every endDate on a NON-current row must parse. A miss here
-- would silently become endedOn IS NULL, i.e. "this role is current", a lie.
-- EXPECTED: 0
SELECT count(*) AS unparseable_end FROM "Experience"
WHERE NOT "isCurrent"
  AND btrim("endDate") !~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P5. Not a gate: proof the CASE discards nothing. isCurrent wins by design,
-- so any current row holding a parseable endDate is losing that string.
-- EXPECTED: 0 rows
SELECT "id", "company", "endDate" FROM "Experience"
WHERE "isCurrent" AND btrim("endDate") ~* '^(january|february|march|april|may|june|july|august|september|october|november|december)[[:space:]]+[0-9]{4}$';

-- P6. ABORT GATE. Education.startYear must be exactly four digits; there is
-- no honest fallback for anything else (schema-v2.md, step 15).
-- EXPECTED: 0 rows
SELECT "id", "institution", "startYear" FROM "Education"
WHERE btrim("startYear") !~ '^[0-9]{4}$';

-- P7. Report, not a gate: every endYear that will become NULL. Print the ids.
-- EXPECTED: 0 rows (production holds '2025')
SELECT "id", "institution", "endYear" FROM "Education"
WHERE btrim("endYear") !~ '^[0-9]{4}$';

-- P8. The year CHECKs must already hold. EXPECTED: 0 rows
SELECT "id", "startYear", "endYear" FROM "Education"
WHERE btrim("startYear") ~ '^[0-9]{4}$'
  AND ( btrim("startYear")::int NOT BETWEEN 1950 AND 2200
     OR ( btrim("endYear") ~ '^[0-9]{4}$'
          AND ( btrim("endYear")::int NOT BETWEEN 1950 AND 2200
             OR btrim("endYear")::int < btrim("startYear")::int ) ) );

-- P9. The current column types, so a half-run file is obvious.
-- EXPECTED: Education.startYear = text, Education.endYear = text,
--           and no startYearInt / endYearInt / startedOn / endedOn row at all.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ( (table_name = 'Education'  AND column_name IN ('startYear','endYear','startYearInt','endYearInt','createdAt','updatedAt'))
     OR (table_name = 'Experience' AND column_name IN ('startDate','endDate','isCurrent','startedOn','endedOn','logoAssetId','createdAt','updatedAt')) )
ORDER BY table_name, column_name;

-- P10. FK target present. EXPECTED: t
SELECT to_regclass('"MediaAsset"') IS NOT NULL AS media_asset_present;

-- P11. Index inventory. EXPECTED: exactly Education_pkey, Experience_pkey,
-- ExperienceBullet_pkey. Nothing else on these three tables.
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename IN ('Experience','ExperienceBullet','Education')
ORDER BY tablename, indexname;

-- P12. Nothing already carries these names. EXPECTED: 0 rows
SELECT tgname FROM pg_trigger
WHERE tgrelid IN ('"Experience"'::regclass, '"Education"'::regclass) AND NOT tgisinternal;

-- P13. No FK anywhere points at a column this file will eventually drop.
-- EXPECTED: 0 rows
SELECT c.conname, c.conrelid::regclass AS from_table, a.attname AS referenced_column
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = ANY (c.confkey)
WHERE c.contype = 'f'
  AND c.confrelid IN ('"Experience"'::regclass, '"Education"'::regclass)
  AND a.attname IN ('startDate','endDate','isCurrent','startYear','endYear');


-- #####################################################################
-- EXPAND. One transaction. Run unattended.
-- #####################################################################

BEGIN;

-- Fail fast rather than queueing live traffic behind a lock we cannot get.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ---------------------------------------------------------------------
-- SECTION Z. Parsing helpers, shared by both triggers.
--
-- STABLE, not IMMUTABLE: to_date is STABLE. Not used in any CHECK, so that
-- is fine. Created in the public schema next to the tables, dropped in
-- STAGE 2. Prisma does not model functions, so `db push` will neither create
-- nor drop these — which is also why STAGE 2 must drop them by hand.
-- ---------------------------------------------------------------------

-- 'July 2025' / 'jul 2025' / 'Sept 2025' / '2025-07' -> 2025-07-01.
-- Anything unparseable -> NULL. Open-end markers are NOT handled here; see
-- v2_open_end, so that "I could not parse this" and "this means now" stay
-- distinguishable and only the first one raises.
CREATE OR REPLACE FUNCTION public.v2_month_to_date(raw text)
RETURNS date LANGUAGE plpgsql STABLE AS $fn$
DECLARE s text := lower(btrim(coalesce(raw, '')));
BEGIN
  IF s = '' THEN
    RETURN NULL;
  END IF;
  IF s ~ '^[0-9]{4}-[0-9]{1,2}$' THEN
    RETURN to_date(s, 'YYYY-MM');
  END IF;
  s := btrim(regexp_replace(s, '[.,[:space:]]+', ' ', 'g'));
  IF s ~ '^(january|february|march|april|may|june|july|august|september|october|november|december) [0-9]{4}$' THEN
    RETURN to_date(s, 'Month YYYY');
  END IF;
  IF s ~ '^sept [0-9]{4}$' THEN
    RETURN to_date(regexp_replace(s, '^sept', 'sep'), 'Mon YYYY');
  END IF;
  IF s ~ '^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) [0-9]{4}$' THEN
    RETURN to_date(s, 'Mon YYYY');
  END IF;
  RETURN NULL;
END $fn$;

-- The v1 vocabulary for "this has not ended". v1's end-date input is required
-- (form.tsx:111), so 'Present' is the value production actually holds.
CREATE OR REPLACE FUNCTION public.v2_open_end(raw text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(btrim(coalesce(raw, ''))) IN
    ('', '-', '—', 'present', 'current', 'now', 'ongoing', 'to date',
     'till date', 'to present', 'till present', 'n/a', 'na');
$fn$;

-- '2021' -> 2021. Anything else -> NULL. Callers decide whether NULL is
-- acceptable: it is for endYear (schema-v2.md step 15: "map a non-numeric
-- endYear to NULL"), it is not for startYear.
CREATE OR REPLACE FUNCTION public.v2_year_to_int(raw text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN btrim(coalesce(raw, '')) ~ '^[0-9]{4}$'
              THEN btrim(raw)::integer END;
$fn$;


-- ---------------------------------------------------------------------
-- SECTION A. Experience: the new columns.
--
-- v1 SAFETY, per column:
--   startedOn / endedOn — nullable for now, so the backfill has somewhere to
--     land and so a v1 INSERT that omits them cannot hit 23502 before the
--     trigger exists. Tightened to NOT NULL in section D, AFTER the trigger.
--   logoAssetId — nullable, no default, no backfill. v1 never mentions it.
--   createdAt — NOT NULL DEFAULT CURRENT_TIMESTAMP. The default is what makes
--     v1's createExperience (HEAD experiences.ts:30-47, which does not write
--     it) legal. The new schema declares @default(now()), so this default is
--     permanent and must NOT be dropped.
--   updatedAt — NOT NULL DEFAULT CURRENT_TIMESTAMP. The target DDL has NO
--     default here (@updatedAt; the client writes it). The default is kept
--     for the whole window ANYWAY, for exactly the same reason: v1's INSERT
--     omits it. Dropped in STAGE 2.
--
-- CURRENT_TIMESTAMP is non-volatile, so PG17 stores it as a missing-value and
-- does not rewrite the table. Both rows get the migration's clock; Experience
-- has never had a timestamp of any kind, so there is nothing truer available.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  ADD COLUMN IF NOT EXISTS "startedOn"   DATE,
  ADD COLUMN IF NOT EXISTS "endedOn"     DATE,
  ADD COLUMN IF NOT EXISTS "logoAssetId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- ---------------------------------------------------------------------
-- SECTION B. Experience: backfill.
--
-- The CASE ordering is the point. A row can be isCurrent = true AND hold a
-- parseable endDate (v1 renders both the end date and the live pill:
-- HEAD apps/web/app/components/landing/Experience.tsx:97-98, :172), so
-- isCurrent must win. It also means 'Present' is never handed to the parser:
-- the only row holding it takes the THEN branch, and Postgres does not
-- evaluate the unused arm of a scalar CASE.
--
-- The ELSE arm is an unguarded parse ON PURPOSE. If P4 was skipped and an
-- unparseable non-current endDate exists, v2_month_to_date returns NULL, the
-- assertion in section C catches it, and the whole transaction rolls back.
--
-- Guarded on IS NULL so a re-run cannot stomp a value the trigger has since
-- derived from a live edit.
-- ---------------------------------------------------------------------

UPDATE "Experience" SET
  "startedOn" = public.v2_month_to_date("startDate"),
  "endedOn"   = CASE WHEN "isCurrent" OR public.v2_open_end("endDate") THEN NULL
                     ELSE public.v2_month_to_date("endDate") END
WHERE "startedOn" IS NULL;


-- ---------------------------------------------------------------------
-- SECTION C. Experience: prove the backfill resolved, then the sync trigger.
--
-- The DO block aborts even in an unattended run, which is the point: the
-- assertion has to be inside the same transaction as the DDL that follows.
-- ---------------------------------------------------------------------

DO $$
DECLARE missing int; bad int;
BEGIN
  SELECT count(*) INTO missing FROM "Experience" WHERE "startedOn" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Experience.startedOn unresolved on % row(s). Fix the startDate strings (preflight P3) and re-run.', missing;
  END IF;

  SELECT count(*) INTO bad FROM "Experience" WHERE NOT "isCurrent" AND "endedOn" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Experience.endedOn is NULL on % non-current row(s), which would publish them as "current". Fix the endDate strings (preflight P4) and re-run.', bad;
  END IF;
END $$;

-- The bridge. BEFORE INSERT OR UPDATE, both directions:
--
--   v1 writes the strings and never the dates  -> derive the dates.
--   v2 writes the dates and never the strings  -> derive the strings.
--
-- Direction is decided by which side the writer actually touched, which is
-- knowable because the two Prisma clients generate DISJOINT column lists:
-- the v1 client has no startedOn field, the v2 client has no startDate field,
-- and Prisma never emits a column its model does not declare.
--
-- Deriving the strings back is what lets this file leave startDate / endDate
-- NOT NULL exactly as they are — no DROP NOT NULL, no sentinel default — and
-- it is what keeps Vercel's instant rollback to the v1 deployment honest: a
-- role created by v2 during the window still renders under v1.
-- NOT NULL is checked AFTER BEFORE-row-triggers fire, so filling NEW here is
-- sufficient to satisfy it.
--
-- The typed side wins if somehow both moved in one statement. v2 is the
-- future and the dates cannot lie about "current" the way isCurrent can.
CREATE OR REPLACE FUNCTION public.experience_dates_sync()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  typed_changed  boolean;
  legacy_changed boolean;
  d_start date;
  d_end   date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    typed_changed  := NEW."startedOn" IS NOT NULL;
    legacy_changed := NEW."startDate" IS NOT NULL;
    IF NOT typed_changed AND NOT legacy_changed THEN
      RAISE EXCEPTION 'Experience insert supplied neither startedOn nor startDate; one of the two is required while both exist.';
    END IF;
  ELSE
    typed_changed  := (NEW."startedOn" IS DISTINCT FROM OLD."startedOn")
                   OR (NEW."endedOn"   IS DISTINCT FROM OLD."endedOn");
    legacy_changed := (NEW."startDate" IS DISTINCT FROM OLD."startDate")
                   OR (NEW."endDate"   IS DISTINCT FROM OLD."endDate")
                   OR (NEW."isCurrent" IS DISTINCT FROM OLD."isCurrent");
  END IF;

  IF typed_changed THEN
    IF NEW."startedOn" IS NULL THEN
      RAISE EXCEPTION 'Experience.startedOn cannot be set to NULL; NULL endedOn is how a current role is expressed, startedOn is always known.';
    END IF;
    -- 'FMMonth YYYY' with no TM prefix is English regardless of lc_time, and
    -- round-trips the two strings production holds exactly.
    NEW."startDate" := to_char(NEW."startedOn", 'FMMonth YYYY');
    NEW."endDate"   := COALESCE(to_char(NEW."endedOn", 'FMMonth YYYY'), 'Present');
    NEW."isCurrent" := (NEW."endedOn" IS NULL);

  ELSIF legacy_changed THEN
    d_start := public.v2_month_to_date(NEW."startDate");
    IF d_start IS NULL THEN
      RAISE EXCEPTION 'Experience.startDate % is not a month. Write it as "July 2025" or "2025-07".', coalesce(quote_literal(NEW."startDate"), 'NULL');
    END IF;
    NEW."startedOn" := d_start;

    -- An open-end marker counts as current even if the switch was not
    -- flipped. v1 accepts isCurrent = false with endDate = 'Present' and
    -- renders it; rejecting that save would be a regression, and NULL is the
    -- only honest reading of it.
    -- This is the one place the bridge WRITES BACK to a v1 column the admin
    -- set by hand: isCurrent false -> true. It is a fix, not a change of
    -- meaning. v1's own tenure() does `to = isCurrent ? now : monthOrdinal(end)`
    -- (HEAD apps/web/app/components/landing/Experience.tsx:71-73), and
    -- monthOrdinal('Present') is NaN, so that combination renders a broken
    -- duration and no live pill today. After the flip it renders correctly.
    IF COALESCE(NEW."isCurrent", false) OR public.v2_open_end(NEW."endDate") THEN
      NEW."endedOn"   := NULL;
      NEW."isCurrent" := true;
    ELSE
      d_end := public.v2_month_to_date(NEW."endDate");
      IF d_end IS NULL THEN
        RAISE EXCEPTION 'Experience.endDate % is neither a month nor "Present". Write it as "July 2025", "2025-07", or "Present".', coalesce(quote_literal(NEW."endDate"), 'NULL');
      END IF;
      NEW."endedOn" := d_end;
    END IF;
  END IF;

  -- v1's update path does not write updatedAt (HEAD experiences.ts:54-69), so
  -- without this the stamp would lie for any edit made during the window.
  -- v2 always sends it, so this only fires when nobody did.
  IF TG_OP = 'UPDATE' AND NEW."updatedAt" IS NOT DISTINCT FROM OLD."updatedAt" THEN
    NEW."updatedAt" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS "experience_dates_sync_trg" ON "Experience";
CREATE TRIGGER "experience_dates_sync_trg"
  BEFORE INSERT OR UPDATE ON "Experience"
  FOR EACH ROW EXECUTE FUNCTION public.experience_dates_sync();


-- ---------------------------------------------------------------------
-- SECTION D. Experience: NOT NULL, FK, index, CHECKs.
--
-- Every one of these is safe for v1 BECAUSE the trigger from section C is now
-- in place; run them in this order or not at all.
--
--   SET NOT NULL on startedOn — v1's INSERT omits startedOn, but the trigger
--     fills it before the constraint is evaluated. Safe. It is also the point:
--     a NULL here would reach the v2 deploy as a required-field read error on
--     the PUBLIC page, so make it impossible now, while only the admin can
--     trip it.
--   FK logoAssetId -> MediaAsset(id), SetNull — v1 never writes logoAssetId,
--     so it is NULL on every row v1 can produce, and a NULL FK is always
--     satisfied. No v1 insert can fail on it.
--   Index Experience_logoAssetId_idx — additive; CREATE INDEX takes SHARE,
--     which blocks writes for the microseconds two rows take. No CONCURRENTLY
--     (it cannot run in a transaction and is pointless at this size).
--   ExperienceBullet_experienceId_sortOrder_idx — additive, invisible to v1.
--     There is no index on that column today (HEAD
--     packages/db/prisma/migrations/20260307195336_init/migration.sql declares
--     only the FK), so this is new, not a rename.
--   dates_order_check / dates_day01_check — both hold for the two production
--     rows and for everything the trigger can derive. They DO narrow what a
--     v1 save may contain; see "WHAT THIS STAGE TAKES AWAY FROM v1". Adding
--     them now is the safer half of that trade: without the order check, a
--     reversed pair saved during the window would make STAGE 2's ADD
--     CONSTRAINT fail at the worst possible moment instead of failing the
--     admin's save at the moment they made the mistake.
--     day01 also doubles as a tripwire for the @db.Date serialisation trap:
--     v2 writes Date.UTC(y, m-1, 1) (apps/docs/app/lib/lifecycle.ts:67-75),
--     which lands on day 01 for a UTC runtime (Vercel) and for IST; it would
--     not for a runtime behind UTC, and this CHECK would say so loudly
--     instead of the timeline printing dates a day early.
--   logo_source_check — at most one logo source. Trivially true today:
--     logoAssetId is NULL on both rows and v1 cannot set it. NOTE FOR CLUSTER
--     70: this constraint means adopting the logos into MediaAsset requires
--     nulling logoUrl in the same UPDATE, and v1 RENDERS logoUrl
--     (HEAD apps/web/app/lib/data.ts:203) — so that backfill is contract-side
--     work, after the v2 deploy. Do not do it in any expand.
--
-- All three CHECKs go in VALID immediately rather than NOT VALID + VALIDATE:
-- two rows, ACCESS EXCLUSIVE for microseconds. There is no ADD CONSTRAINT
-- IF NOT EXISTS in Postgres, hence DROP IF EXISTS then ADD.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience" ALTER COLUMN "startedOn" SET NOT NULL;

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logoAssetId_fkey";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_logoAssetId_fkey"
  FOREIGN KEY ("logoAssetId") REFERENCES "MediaAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Experience_logoAssetId_idx" ON "Experience" ("logoAssetId");
CREATE INDEX IF NOT EXISTS "ExperienceBullet_experienceId_sortOrder_idx"
  ON "ExperienceBullet" ("experienceId", "sortOrder");

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_order_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_dates_order_check"
  CHECK ("endedOn" IS NULL OR "endedOn" >= "startedOn");

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_day01_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_dates_day01_check"
  CHECK (EXTRACT(DAY FROM "startedOn") = 1
         AND ("endedOn" IS NULL OR EXTRACT(DAY FROM "endedOn") = 1));

ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logo_source_check";
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_logo_source_check"
  CHECK ("logoAssetId" IS NULL OR "logoUrl" IS NULL);


-- ---------------------------------------------------------------------
-- SECTION E. Education, OPTION A: retype under a new physical name.
--
-- REQUIRES the two @map lines in packages/db/prisma/schema.prisma described
-- at the top of this file, plus db:generate, plus the same rename on the Neon
-- branch. Without them the v2 build reads a column that does not exist
-- (P2022) and the deploy fails — which is a safe failure, but a wasted one.
--
-- v1 SAFETY: v1 touches "startYear" and "endYear", both still TEXT, both
-- still NOT NULL, unchanged in type, nullability and default. Adding two
-- columns it has never heard of is invisible to it: Prisma always emits an
-- explicit column list (there is no SELECT * anywhere in HEAD against these
-- tables), so no v1 read widens and no v1 write narrows.
--
-- createdAt / updatedAt: same reasoning as Experience. v1's staged create
-- (HEAD staging.ts:513-527) writes neither, so both need their default for
-- the duration of the window; updatedAt loses it in STAGE 2. Guarded with
-- IF NOT EXISTS because cluster 45 adds the same two columns.
-- ---------------------------------------------------------------------

ALTER TABLE "Education"
  ADD COLUMN IF NOT EXISTS "startYearInt" INTEGER,
  ADD COLUMN IF NOT EXISTS "endYearInt"   INTEGER,
  ADD COLUMN IF NOT EXISTS "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill. startYear must parse (P6 is the gate); endYear may not, and NULL
-- is its new meaning of "still enrolled" (schema-v2.md step 15). P7 printed
-- every id this nulls.
UPDATE "Education" SET
  "startYearInt" = public.v2_year_to_int("startYear"),
  "endYearInt"   = public.v2_year_to_int("endYear")
WHERE "startYearInt" IS NULL;

DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM "Education" WHERE "startYearInt" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Education.startYearInt unresolved on % row(s); a startYear that is not four digits has no honest integer. Fix it (preflight P6) and re-run.', missing;
  END IF;
END $$;

-- Required in v2, and the trigger below guarantees it for every v1 write.
ALTER TABLE "Education" ALTER COLUMN "startYearInt" SET NOT NULL;

-- The bridge, same shape and same direction test as Experience's.
-- The reverse direction matters more here than it looks: TEXT "endYear" is
-- NOT NULL, and v2 can legitimately write endYear = NULL for a degree in
-- progress. Without the 'Present' fallback below, the first v2 create or
-- "still enrolled" edit during the window would hit 23502 on a column its own
-- model does not know exists.
CREATE OR REPLACE FUNCTION public.education_years_sync()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  typed_changed  boolean;
  legacy_changed boolean;
  y int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    typed_changed  := NEW."startYearInt" IS NOT NULL;
    legacy_changed := NEW."startYear"    IS NOT NULL;
    IF NOT typed_changed AND NOT legacy_changed THEN
      RAISE EXCEPTION 'Education insert supplied neither startYearInt nor startYear; one of the two is required while both exist.';
    END IF;
  ELSE
    typed_changed  := (NEW."startYearInt" IS DISTINCT FROM OLD."startYearInt")
                   OR (NEW."endYearInt"   IS DISTINCT FROM OLD."endYearInt");
    legacy_changed := (NEW."startYear"    IS DISTINCT FROM OLD."startYear")
                   OR (NEW."endYear"      IS DISTINCT FROM OLD."endYear");
  END IF;

  IF typed_changed THEN
    IF NEW."startYearInt" IS NULL THEN
      RAISE EXCEPTION 'Education.startYear cannot be NULL.';
    END IF;
    NEW."startYear" := NEW."startYearInt"::text;
    NEW."endYear"   := COALESCE(NEW."endYearInt"::text, 'Present');

  ELSIF legacy_changed THEN
    y := public.v2_year_to_int(NEW."startYear");
    IF y IS NULL THEN
      RAISE EXCEPTION 'Education.startYear % must be a four-digit year, e.g. 2021.', coalesce(quote_literal(NEW."startYear"), 'NULL');
    END IF;
    NEW."startYearInt" := y;
    NEW."endYearInt"   := public.v2_year_to_int(NEW."endYear");
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."updatedAt" IS NOT DISTINCT FROM OLD."updatedAt" THEN
    NEW."updatedAt" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS "education_years_sync_trg" ON "Education";
CREATE TRIGGER "education_years_sync_trg"
  BEFORE INSERT OR UPDATE ON "Education"
  FOR EACH ROW EXECUTE FUNCTION public.education_years_sync();

-- The three year CHECKs, on the typed columns, under their canonical names so
-- the final constraint inventory matches schema-v2.md. A rename in STAGE 2
-- carries the bodies with it automatically.
--
-- These can be added during expand and it is worth doing: both inputs were
-- free text with no min or max, so endYear = '99999' on a 2021 start passes
-- v1 today and renders. What they cost is that a v1 staged edit writing a
-- reversed or out-of-range year now fails — behind the generic
-- "Couldn't save your changes" message (HEAD staging.ts:260-266). One admin,
-- one row: do not edit Education during the window.
ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_startYear_check";
ALTER TABLE "Education" ADD CONSTRAINT "Education_startYear_check"
  CHECK ("startYearInt" BETWEEN 1950 AND 2200);

ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_endYear_check";
ALTER TABLE "Education" ADD CONSTRAINT "Education_endYear_check"
  CHECK ("endYearInt" IS NULL OR "endYearInt" BETWEEN 1950 AND 2200);

ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_year_order_check";
ALTER TABLE "Education" ADD CONSTRAINT "Education_year_order_check"
  CHECK ("endYearInt" IS NULL OR "endYearInt" >= "startYearInt");

COMMIT;


-- #####################################################################
-- VERIFICATION — after COMMIT, before pushing code. All reads.
-- #####################################################################

-- V1. The backfill, which is the whole point.
-- EXPECTED exactly:
--   Wiingy | 2025-07-01 | (null)     | July 2025    | Present   | t
--   Nykaa  | 2025-01-01 | 2025-07-01 | January 2025 | July 2025 | f
SELECT "company", "startedOn", "endedOn", "startDate", "endDate", "isCurrent"
FROM "Experience" ORDER BY "sortOrder";

-- V2. Old and new agree on every row, in both tables. This is the invariant
-- the trigger exists to hold; re-run it any time during the window.
-- EXPECTED: 0, 0
SELECT
  (SELECT count(*) FROM "Experience"
    WHERE "startedOn" <> public.v2_month_to_date("startDate")
       OR ("isCurrent" <> ("endedOn" IS NULL))
       OR ("endedOn" IS NOT NULL AND "endedOn" <> public.v2_month_to_date("endDate"))
  ) AS experience_disagreements,
  (SELECT count(*) FROM "Education"
    WHERE "startYearInt"::text <> btrim("startYear")
       OR ("endYearInt" IS NULL AND btrim("endYear") ~ '^[0-9]{4}$')
       OR ("endYearInt" IS NOT NULL AND "endYearInt"::text <> btrim("endYear"))
  ) AS education_disagreements;

-- V3. Tenure is INCLUSIVE (to - from + 1). Pinned because the render rewrite
-- is the easiest place in this migration to lose a month: a plain date
-- subtraction gives Nykaa 6, and the card has always said 7.
-- EXPECTED: Wiingy (null), Nykaa 7
SELECT "company",
       CASE WHEN "endedOn" IS NULL THEN NULL
            ELSE (EXTRACT(YEAR FROM "endedOn")*12 + EXTRACT(MONTH FROM "endedOn"))
               - (EXTRACT(YEAR FROM "startedOn")*12 + EXTRACT(MONTH FROM "startedOn")) + 1
       END AS inclusive_months
FROM "Experience" ORDER BY "sortOrder";

-- V4. Education. EXPECTED: 1 row -> 2021 | 2025 | 2021 | 2025
SELECT "startYearInt", "endYearInt", "startYear", "endYear" FROM "Education";

-- V5. Column shape. EXPECTED, and every word of it matters:
--   Education  createdAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   Education  endYear      | text                        | NO  | (null)
--   Education  endYearInt   | integer                     | YES | (null)
--   Education  startYear    | text                        | NO  | (null)
--   Education  startYearInt | integer                     | NO  | (null)
--   Education  updatedAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP   <- default still there, on purpose
--   Experience createdAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   Experience endDate      | text                        | NO  | (null)
--   Experience endedOn      | date                        | YES | (null)
--   Experience isCurrent    | boolean                     | NO  | false
--   Experience logoAssetId  | text                        | YES | (null)
--   Experience startDate    | text                        | NO  | (null)
--   Experience startedOn    | date                        | NO  | (null)
--   Experience updatedAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP   <- default still there, on purpose
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ( (table_name = 'Education'  AND column_name IN ('startYear','endYear','startYearInt','endYearInt','createdAt','updatedAt'))
     OR (table_name = 'Experience' AND column_name IN ('startDate','endDate','isCurrent','startedOn','endedOn','logoAssetId','createdAt','updatedAt')) )
ORDER BY table_name, column_name;

-- V6. Constraints. EXPECTED exactly 9 rows, all convalidated = t:
--   Education  | Education_endYear_check          | c
--   Education  | Education_pkey                   | p
--   Education  | Education_startYear_check        | c
--   Education  | Education_year_order_check       | c
--   Experience | Experience_dates_day01_check     | c
--   Experience | Experience_dates_order_check     | c
--   Experience | Experience_logoAssetId_fkey      | f
--   Experience | Experience_logo_source_check     | c
--   Experience | Experience_pkey                  | p
-- PG17 re-spells the EXTRACT bodies with a numeric cast, and does not
-- catalogue NOT NULL as a pg_constraint row, so match on names and semantics
-- rather than on the exact string or the exact count of anything else.
SELECT conrelid::regclass AS "table", conname, contype, convalidated,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('"Experience"'::regclass, '"Education"'::regclass)
ORDER BY 1, 2;

-- V7. Triggers present and enabled. EXPECTED: 2 rows, tgenabled = 'O'.
SELECT tgrelid::regclass AS "table", tgname, tgenabled FROM pg_trigger
WHERE tgrelid IN ('"Experience"'::regclass, '"Education"'::regclass) AND NOT tgisinternal
ORDER BY 1;

-- V8. Indexes. EXPECTED: Education_pkey; Experience_logoAssetId_idx;
-- Experience_pkey; ExperienceBullet_experienceId_sortOrder_idx;
-- ExperienceBullet_pkey.
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = current_schema() AND tablename IN ('Experience','ExperienceBullet','Education')
ORDER BY tablename, indexname;

-- V9. Nothing was lost. EXPECTED: 2, 8, 1, 17
SELECT (SELECT count(*) FROM "Experience")          AS experiences,
       (SELECT count(*) FROM "ExperienceBullet")    AS bullets,
       (SELECT count(*) FROM "Education")           AS education,
       (SELECT count(*) FROM "_ExperienceToSkill")  AS experience_skills;

-- V10. Optional, and the only way to prove the bridge really works both ways.
-- Run it in a transaction you then ROLL BACK. It writes, so it is off by
-- default; uncomment deliberately.
--   BEGIN;
--     -- pretend to be v1: strings only
--     UPDATE "Experience" SET "startDate" = 'March 2024', "endDate" = 'Present', "isCurrent" = true
--      WHERE "company" = 'Nykaa';
--     SELECT "company","startDate","endDate","isCurrent","startedOn","endedOn" FROM "Experience" WHERE "company"='Nykaa';
--     --   EXPECT startedOn = 2024-03-01, endedOn = NULL
--     -- pretend to be v2: dates only
--     UPDATE "Experience" SET "startedOn" = DATE '2023-02-01', "endedOn" = DATE '2023-11-01'
--      WHERE "company" = 'Nykaa';
--     SELECT "company","startDate","endDate","isCurrent","startedOn","endedOn" FROM "Experience" WHERE "company"='Nykaa';
--     --   EXPECT startDate = 'February 2023', endDate = 'November 2023', isCurrent = false
--     -- the CHECKs bite
--     UPDATE "Experience" SET "endedOn" = "startedOn" - 1 WHERE "company" = 'Nykaa';  -- EXPECT: Experience_dates_order_check
--   ROLLBACK;


-- #####################################################################
-- ROLLBACK for this stage. Safe at any point before the code ships, and
-- still safe after, as long as v1 is the deployment that is serving.
-- It restores exactly the schema v1 was written against.
-- #####################################################################
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS "education_years_sync_trg"  ON "Education";
--   DROP TRIGGER IF EXISTS "experience_dates_sync_trg" ON "Experience";
--   DROP FUNCTION IF EXISTS public.education_years_sync();
--   DROP FUNCTION IF EXISTS public.experience_dates_sync();
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logo_source_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_day01_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_dates_order_check";
--   ALTER TABLE "Experience" DROP CONSTRAINT IF EXISTS "Experience_logoAssetId_fkey";
--   DROP INDEX IF EXISTS "Experience_logoAssetId_idx";
--   DROP INDEX IF EXISTS "ExperienceBullet_experienceId_sortOrder_idx";
--   ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_year_order_check";
--   ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_endYear_check";
--   ALTER TABLE "Education" DROP CONSTRAINT IF EXISTS "Education_startYear_check";
--   ALTER TABLE "Experience" DROP COLUMN IF EXISTS "startedOn",
--                            DROP COLUMN IF EXISTS "endedOn",
--                            DROP COLUMN IF EXISTS "logoAssetId",
--                            DROP COLUMN IF EXISTS "createdAt",
--                            DROP COLUMN IF EXISTS "updatedAt";
--   ALTER TABLE "Education"  DROP COLUMN IF EXISTS "startYearInt",
--                            DROP COLUMN IF EXISTS "endYearInt",
--                            DROP COLUMN IF EXISTS "createdAt",
--                            DROP COLUMN IF EXISTS "updatedAt";
--   DROP FUNCTION IF EXISTS public.v2_year_to_int(text);
--   DROP FUNCTION IF EXISTS public.v2_open_end(text);
--   DROP FUNCTION IF EXISTS public.v2_month_to_date(text);
--   COMMIT;
--
-- Lossless: it drops only columns this stage created. The TEXT and BOOLEAN
-- columns v1 reads were never touched, so nothing has to be reconstructed.
-- If a v1 edit happened in between, its values are already in startDate /
-- endDate / isCurrent, because the trigger wrote both sides.
-- Note: if cluster 45 has already added Education.createdAt / updatedAt, do
-- not drop them here — they are not this cluster's to remove.


-- #####################################################################
-- APPENDIX · OPTION B, for the record. DO NOT RUN IT IF YOU RAN SECTION E.
--
-- The in-place retype, canonical column names, no @map, no schema edit. It is
-- NOT an expand step: the instant it commits, the deployed v1 code can no
-- longer read Education. Run it as the LAST thing before you push, and know
-- that the window lasts until the v2 deployment is promoted.
--
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   -- DROP NOT NULL first, so the endYear USING expression is free to produce
--   -- NULL for a degree in progress. Same transaction as the retype.
--   ALTER TABLE "Education" ALTER COLUMN "endYear" DROP NOT NULL;
--   ALTER TABLE "Education" ALTER COLUMN "startYear" TYPE INTEGER
--     USING btrim("startYear")::integer;
--   ALTER TABLE "Education" ALTER COLUMN "endYear" TYPE INTEGER
--     USING CASE WHEN btrim("endYear") ~ '^[0-9]{4}$' THEN btrim("endYear")::integer END;
--   ALTER TABLE "Education" ADD CONSTRAINT "Education_startYear_check"  CHECK ("startYear" BETWEEN 1950 AND 2200);
--   ALTER TABLE "Education" ADD CONSTRAINT "Education_endYear_check"    CHECK ("endYear" IS NULL OR "endYear" BETWEEN 1950 AND 2200);
--   ALTER TABLE "Education" ADD CONSTRAINT "Education_year_order_check" CHECK ("endYear" IS NULL OR "endYear" >= "startYear");
--   ALTER TABLE "Education"
--     ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
--   COMMIT;
--
-- Exposure while the window is open, precisely:
--   * apps/web landing page: keeps serving the ISR HTML it already has. A
--     background revalidation will throw in getAboutData (HEAD
--     apps/web/app/lib/data.ts:162) and Next keeps the last good entry, so no
--     public 500 — but no fresh content either, and a revalidatePath('/')
--     appears to succeed while changing nothing.
--   * apps/docs /about: 500s outright (HEAD about/page.tsx:29).
--   * any v1 staged Education edit: fails, generically.
--   * do NOT run this and then walk away. If the build fails, roll it back:
--       ALTER TABLE "Education" DROP CONSTRAINT "Education_year_order_check";
--       ALTER TABLE "Education" DROP CONSTRAINT "Education_endYear_check";
--       ALTER TABLE "Education" DROP CONSTRAINT "Education_startYear_check";
--       ALTER TABLE "Education" ALTER COLUMN "startYear" TYPE TEXT USING "startYear"::text;
--       ALTER TABLE "Education" ALTER COLUMN "endYear"   TYPE TEXT USING "endYear"::text;
--       UPDATE "Education" SET "endYear" = 'Present' WHERE "endYear" IS NULL;
--       ALTER TABLE "Education" ALTER COLUMN "endYear" SET NOT NULL;
--     Exact for the '2021'/'2025' production holds. It invents 'Present' for a
--     NULL endYear; there is none today.
-- #####################################################################
