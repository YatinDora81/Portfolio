-- =====================================================================
-- PRODUCTION CUTOVER · cluster: experience-education · STAGE 2 of 2: CONTRACT
--
-- Run this ONLY AFTER the v2 code is deployed, promoted, and confirmed.
-- Target: production Neon (PROD_DATABASE_URL), direct (non-pooled) endpoint.
--
-- "Confirmed" means all six of these, by hand, before you type anything:
--   1. Vercel shows the new commit as the PRODUCTION deployment for BOTH
--      apps/web and apps/docs, state Ready.
--   2. https://www.yatindora.in loads and the experience timeline shows
--      "July 2025 - Present" on Wiingy and "January 2025 - July 2025" on
--      Nykaa, with a 7-month tenure on Nykaa, and the education line under the
--      About terminal reads "2021 — 2025".
--   3. The admin /experiences page loads and its preview renders both cards.
--   4. The admin /about page loads and shows the education row.
--   5. You have opened the admin experience form, saved it unchanged, and
--      seen the row survive. That is the only thing that proves a v2 WRITE
--      works against this schema.
--   6. You have taken a fresh read-only snapshot:
--          cd packages/db && bun run db:dump --from=PROD_DATABASE_URL
--      It runs in `begin transaction read only isolation level repeatable
--      read`, so it cannot write. This is your undo for the rows, since the
--      DDL below is not reversible from the database alone.
--
-- THERE IS NO HURRY. Everything dropped below is dead weight, not a
-- correctness problem: v2 does not read a single one of these columns
-- (verified — the only startDate / endDate / isCurrent left in the working
-- tree are the PROP NAMES of apps/docs/app/components/preview/experience.tsx,
-- and page.tsx:182 feeds them from monthLabel(exp.startedOn), not from the
-- database). Leaving them in place for a day or a week costs nothing.
--
-- WHAT IT DOES COST TO RUN THIS: Vercel's "instant rollback to the previous
-- deployment" stops being a real option the moment these columns go. v1 reads
-- startDate / endDate / isCurrent (git show HEAD:apps/web/app/lib/data.ts
-- :199-201) and TEXT startYear / endYear (:173-174); with the columns gone,
-- a rolled-back v1 throws P2022 on the landing page and on the admin. Until
-- then, the expand-stage trigger has been mirroring every v2 write back into
-- the old columns, so a rollback genuinely works. Do not run STAGE 2 until you
-- no longer want that escape hatch.
--
-- ORDER INSIDE THIS FILE IS LOAD-BEARING: the triggers must go BEFORE the
-- columns they name. PL/pgSQL resolves record fields at execution time, so a
-- surviving experience_dates_sync() over a dropped startDate raises
-- `record "new" has no field "startDate"` on the next admin save — which
-- would take down writes, not reads, and only after you had walked away.
-- =====================================================================


-- #####################################################################
-- PREFLIGHT — run separately, outside the transaction. All reads.
-- #####################################################################

-- C1. The invariant the trigger held for the whole window still holds. If this
-- is not 0/0, something wrote around the trigger and the drop below would
-- destroy the only correct copy. STOP and reconcile by hand.
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

-- C2. The typed columns are complete. EXPECTED: 0, 0
SELECT (SELECT count(*) FROM "Experience" WHERE "startedOn"    IS NULL) AS null_startedOn,
       (SELECT count(*) FROM "Education"  WHERE "startYearInt" IS NULL) AS null_startYearInt;

-- C3. Row counts, to compare with the post-contract check.
-- EXPECTED: 2, 8, 1
SELECT (SELECT count(*) FROM "Experience")       AS experiences,
       (SELECT count(*) FROM "ExperienceBullet") AS bullets,
       (SELECT count(*) FROM "Education")        AS education;

-- C4. The values, printed one last time, so the drop is auditable.
-- EXPECTED:
--   Wiingy | 2025-07-01 | (null)     | July 2025    | Present   | t
--   Nykaa  | 2025-01-01 | 2025-07-01 | January 2025 | July 2025 | f
--   and Education: 2021 | 2025 | '2021' | '2025'
SELECT "company", "startedOn", "endedOn", "startDate", "endDate", "isCurrent"
FROM "Experience" ORDER BY "sortOrder";
SELECT "startYearInt", "endYearInt", "startYear", "endYear" FROM "Education";

-- C5. Nothing else in the database has grown a dependency on the doomed
-- columns since expand (a view, a generated column, an index, an FK).
-- EXPECTED: 0 rows
SELECT DISTINCT dependent.relname AS depends_on_these_columns
FROM pg_depend d
JOIN pg_class  dependent ON dependent.oid = d.objid
JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
WHERE d.refobjid IN ('"Experience"'::regclass, '"Education"'::regclass)
  AND a.attname IN ('startDate','endDate','isCurrent','startYear','endYear')
  AND d.deptype <> 'a';

-- C6. The two triggers are still the only ones on these tables.
-- EXPECTED: experience_dates_sync_trg, education_years_sync_trg
SELECT tgrelid::regclass AS "table", tgname FROM pg_trigger
WHERE tgrelid IN ('"Experience"'::regclass, '"Education"'::regclass) AND NOT tgisinternal
ORDER BY 1;


-- #####################################################################
-- CONTRACT. One transaction, run unattended.
-- #####################################################################

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------
-- 1. The bridge comes down FIRST. Nothing needs the old columns kept in
--    step any more, and a trigger that outlives its columns breaks writes.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS "experience_dates_sync_trg" ON "Experience";
DROP TRIGGER IF EXISTS "education_years_sync_trg"  ON "Education";
DROP FUNCTION IF EXISTS public.experience_dates_sync();
DROP FUNCTION IF EXISTS public.education_years_sync();

-- ---------------------------------------------------------------------
-- 2. Experience: the three columns v2 does not read.
--
--    isCurrent is not migrated anywhere and needs no home: ("endedOn" IS
--    NULL) says the same thing and, unlike a separate boolean, cannot
--    contradict the dates. apps/docs/app/(dashboard)/experiences/page.tsx:93
--    in the working tree already derives it exactly that way.
--
--    The two strings are reconstructible from the dates
--    (to_char(..., 'FMMonth YYYY'), plus 'Present' for a NULL endedOn), which
--    is what the rollback block at the bottom does. What is NOT
--    reconstructible is a hand-typed variant spelling, e.g. 'Jan 2025' — the
--    rollback would render it 'January 2025'. Production holds only canonical
--    'FMMonth YYYY' strings (data-facts.txt), so today that is exact.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience"
  DROP COLUMN IF EXISTS "startDate",
  DROP COLUMN IF EXISTS "endDate",
  DROP COLUMN IF EXISTS "isCurrent";

-- ---------------------------------------------------------------------
-- 3. Education: the two TEXT columns.
--
--    Only correct if EXPAND section E (option A, @map to startYearInt /
--    endYearInt) is what you ran. If you took option B — the in-place retype
--    — then "startYear" and "endYear" ARE the integer columns and this
--    statement would delete the data. The guard makes that impossible.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Education'
      AND column_name = 'startYearInt'
  ) THEN
    RAISE NOTICE 'Education.startYearInt does not exist, so EXPAND option B (in-place retype) was used. Leaving startYear/endYear alone; they are already INTEGER.';
  ELSE
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'Education'
          AND column_name = 'startYear') <> 'text' THEN
      RAISE EXCEPTION 'Education.startYear is not text but startYearInt exists. Refusing to drop anything; inspect the table by hand.';
    END IF;
    ALTER TABLE "Education" DROP COLUMN "startYear";
    ALTER TABLE "Education" DROP COLUMN "endYear";
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. updatedAt loses its default, on both tables.
--
--    This is the statement that EXPAND deliberately withheld. v1's INSERTs
--    omit updatedAt (git show HEAD:apps/docs/app/lib/actions/experiences.ts:30
--    and HEAD:apps/docs/app/lib/actions/staging.ts:513), so a NOT NULL column
--    with no default would have given the admin a 23502 on every create for
--    the whole window. v2's Prisma client declares @updatedAt and writes the
--    column on every create and update, so from here the default is dead
--    weight — and while it is still there, `prisma migrate diff` and
--    `bun run db:verify` report it as drift against
--    packages/db/v2-migration-draft/target-ddl.sql:163 and :194.
--
--    createdAt KEEPS its default on both tables: @default(now()).
--    ContactPurpose.updatedAt also keeps its default, but that is cluster 45's
--    business, not this file's. Do not "tidy" it here.
-- ---------------------------------------------------------------------

ALTER TABLE "Experience" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Education"  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------
-- 5. The parsing helpers. Nothing reads them once the triggers are gone.
--    Dropped last so that steps 1-4 can still fail and leave a consistent
--    state. If another cluster reused them, comment these three out.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.v2_month_to_date(text);
DROP FUNCTION IF EXISTS public.v2_open_end(text);
DROP FUNCTION IF EXISTS public.v2_year_to_int(text);

COMMIT;


-- #####################################################################
-- VERIFICATION
-- #####################################################################

-- W1. The legacy columns are gone. EXPECTED: 0
SELECT count(*) AS legacy_columns_left
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ( (table_name = 'Experience' AND column_name IN ('startDate','endDate','isCurrent'))
     OR (table_name = 'Education'  AND column_name IN ('startYear','endYear')) );

-- W2. Final shape. EXPECTED exactly:
--   Education  createdAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   Education  endYearInt   | integer                     | YES | (null)
--   Education  startYearInt | integer                     | NO  | (null)
--   Education  updatedAt    | timestamp without time zone | NO  | (null)
--   Experience createdAt    | timestamp without time zone | NO  | CURRENT_TIMESTAMP
--   Experience endedOn      | date                        | YES | (null)
--   Experience logoAssetId  | text                        | YES | (null)
--   Experience startedOn    | date                        | NO  | (null)
--   Experience updatedAt    | timestamp without time zone | NO  | (null)
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name IN ('Experience','Education')
ORDER BY table_name, column_name;

-- W3. The data survived the drop untouched. EXPECTED:
--   Wiingy 2025-07-01 (null) / Nykaa 2025-01-01 2025-07-01 / 2021 2025 / 2,8,1
SELECT "company", "startedOn", "endedOn" FROM "Experience" ORDER BY "sortOrder";
SELECT "startYearInt", "endYearInt" FROM "Education";
SELECT (SELECT count(*) FROM "Experience")       AS experiences,
       (SELECT count(*) FROM "ExperienceBullet") AS bullets,
       (SELECT count(*) FROM "Education")        AS education;

-- W4. No trigger and no helper function is left behind. EXPECTED: 0, 0
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid IN ('"Experience"'::regclass, '"Education"'::regclass) AND NOT tgisinternal) AS triggers_left,
  (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('experience_dates_sync','education_years_sync','v2_month_to_date','v2_open_end','v2_year_to_int')) AS helpers_left;

-- W5. Constraints intact and still VALID after the column drops.
-- EXPECTED 9 rows, convalidated = t on all of them:
--   Education_endYear_check, Education_pkey, Education_startYear_check,
--   Education_year_order_check, Experience_dates_day01_check,
--   Experience_dates_order_check, Experience_logoAssetId_fkey,
--   Experience_logo_source_check, Experience_pkey
SELECT conrelid::regclass AS "table", conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('"Experience"'::regclass, '"Education"'::regclass)
ORDER BY 1, 2;

-- W6. Reload the public site and the two admin screens once more. Neither
-- reads the dropped columns, so nothing should change — this is the check
-- that no cached Prisma client somewhere is still on the old model.

-- W7. Then, locally, with DATABASE_URL still pointing at the branch:
--        cd packages/db && bun run db:verify
--     and separately against production. It should come back clean apart from
--     the two known text_pattern_ops false positives
--     (MediaAsset_key_prefix_idx, NoteNode_path_prefix_idx) that db:verify
--     already whitelists.


-- #####################################################################
-- ROLLBACK for STAGE 2. Re-creates what v1 needs, from the typed columns.
-- Only worth running if you must go back to the v1 deployment.
-- #####################################################################
--
--   BEGIN;
--   ALTER TABLE "Experience"
--     ADD COLUMN "startDate" TEXT,
--     ADD COLUMN "endDate"   TEXT,
--     ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT false;
--   UPDATE "Experience" SET
--     "startDate" = to_char("startedOn", 'FMMonth YYYY'),
--     "endDate"   = COALESCE(to_char("endedOn", 'FMMonth YYYY'), 'Present'),
--     "isCurrent" = ("endedOn" IS NULL);
--   ALTER TABLE "Experience"
--     ALTER COLUMN "startDate" SET NOT NULL,
--     ALTER COLUMN "endDate"   SET NOT NULL;
--   ALTER TABLE "Education"
--     ADD COLUMN "startYear" TEXT,
--     ADD COLUMN "endYear"   TEXT;
--   UPDATE "Education" SET
--     "startYear" = "startYearInt"::text,
--     "endYear"   = COALESCE("endYearInt"::text, 'Present');
--   ALTER TABLE "Education"
--     ALTER COLUMN "startYear" SET NOT NULL,
--     ALTER COLUMN "endYear"   SET NOT NULL;
--   ALTER TABLE "Experience" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   ALTER TABLE "Education"  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   COMMIT;
--   -- then re-run EXPAND sections Z and C and E's trigger block to restore the
--   -- bridge, if v1 and v2 have to coexist again.
--
-- Two honest caveats. It re-renders the strings canonically, so a hand-typed
-- 'Jan 2025' comes back as 'January 2025'. And it reinstates isCurrent = true
-- for any role whose end was merely unknown rather than ongoing; there is no
-- such row today, and v2 cannot create one.


-- #####################################################################
-- APPENDIX · optional, later, and worth nothing but tidiness.
--
-- If the physical names startYearInt / endYearInt bother you, they can be
-- renamed to startYear / endYear — but ONLY in lockstep with a deploy that
-- removes the two @map annotations from packages/db/prisma/schema.prisma,
-- because the running v2 code reads the mapped names. That is a third cutover
-- with its own (small, admin-only-plus-stale-ISR) window, for zero functional
-- gain. Recommendation: don't. Keep the @map, and regenerate
-- packages/db/v2-migration-draft/target-ddl.sql so the canonical DDL in the
-- repo says startYearInt too.
--
-- If you do it anyway, the order is: drop @map in the schema, commit, push,
-- wait for Ready but DO NOT promote... which Vercel's git integration will not
-- let you do. So in practice: run the renames, then immediately push. The
-- window is one build.
--
--   ALTER TABLE "Education" RENAME COLUMN "startYearInt" TO "startYear";
--   ALTER TABLE "Education" RENAME COLUMN "endYearInt"   TO "endYear";
--   -- the three CHECK bodies follow the rename automatically; no re-creation
--   -- needed, and they stay VALID.
-- #####################################################################
