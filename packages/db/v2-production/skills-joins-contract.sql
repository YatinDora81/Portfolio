-- =====================================================================
-- PRODUCTION CUTOVER, cluster: skills-joins      STAGE 2 of 2: CONTRACT
--
-- DO NOT RUN THIS UNTIL ALL OF THE FOLLOWING ARE TRUE:
--   1. /tmp/v2/prod/skills-joins-expand.sql committed and verified.
--   2. The v2 code is DEPLOYED to Vercel and confirmed serving -- not
--      merely built. Confirm by forcing a regeneration
--      (POST /api/revalidate with REVALIDATE_SECRET) and reloading
--      https://www.yatindora.in/ : #skills must render and every
--      experience/project card must show its chips. That proves the v2
--      Prisma client is reading "Skill"."showInGrid" and the two explicit
--      join tables against THIS database.
--   3. You have saved one experience and one project through the v2 admin
--      and verified the chip order round-trips. That proves the v2 write
--      path is live, which is what makes the implicit tables droppable.
--   4. You are content not to roll the deployment back cheaply. After
--      this file, a rollback to v1 needs section R2, which is a restore,
--      not a no-op.
--
-- Nothing in this file is reversible by ROLLBACK once committed, so read
-- the guard output before you COMMIT.
--
-- ORDER IN THIS FILE IS LOAD-BEARING. Two of the steps break v2 at
-- runtime if done in the wrong order:
--
--   (a) The reverse mirror triggers created by EXPAND statements 14-15
--       live on "ExperienceSkill" / "ProjectSkill" and their plpgsql
--       bodies name "_ExperienceToSkill" / "_ProjectToSkill". plpgsql
--       bodies are NOT dependency-tracked, so DROP TABLE on the implicit
--       tables succeeds and leaves the triggers in place. Every
--       subsequent v2 write -- apps/docs/app/lib/actions/experiences.ts:87
--       tx.experienceSkill.createMany, projects.ts:99
--       tx.projectSkill.createMany -- would then fail with
--       42P01 undefined_table and roll back the operator's save.
--       So: drop the triggers, THEN the tables.  Steps 2-3 before 4.
--
--   (b) The visibility sync trigger created by EXPAND statement 4 names
--       NEW."show" in its body. ALTER TABLE ... DROP COLUMN does not drop
--       a BEFORE ROW trigger that has no column list, and again the body
--       is not dependency-tracked. Dropping "show" while that trigger
--       lives makes EVERY v2 INSERT or UPDATE on "Skill" fail at runtime
--       (record "new" has no field "show"), which takes out the whole
--       staged-save batch in apps/docs/app/lib/actions/staging.ts.
--       So: drop the trigger, THEN the column.  Step 6 before step 7.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';


-- ---------------------------------------------------------------------
-- 1. GUARD. Refuse to drop a source of truth that still disagrees with
--    its replacement. If any of these raise, something wrote one side
--    only -- investigate before dropping anything.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  IF to_regclass('public."ExperienceSkill"') IS NULL
     OR to_regclass('public."ProjectSkill"') IS NULL THEN
    RAISE EXCEPTION 'contract: an explicit join table is missing -- EXPAND did not run';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = 'Skill' AND column_name = 'showInGrid') THEN
    RAISE EXCEPTION 'contract: Skill."showInGrid" is missing -- EXPAND did not run';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'Skill' AND column_name = 'show') THEN
    SELECT count(*) INTO bad FROM "Skill" WHERE "show" <> "showInGrid";
    IF bad > 0 THEN
      RAISE EXCEPTION 'contract: % Skill rows where show <> showInGrid -- the sync trigger was bypassed, resolve by hand', bad;
    END IF;
  END IF;

  IF to_regclass('public."_ExperienceToSkill"') IS NOT NULL THEN
    SELECT count(*) INTO bad FROM (
      (SELECT "A","B" FROM "_ExperienceToSkill" EXCEPT SELECT "experienceId","skillId" FROM "ExperienceSkill")
      UNION ALL
      (SELECT "experienceId","skillId" FROM "ExperienceSkill" EXCEPT SELECT "A","B" FROM "_ExperienceToSkill")
    ) d;
    IF bad > 0 THEN
      RAISE EXCEPTION 'contract: % experience-skill pair(s) differ between implicit and explicit -- refusing to drop the implicit table', bad;
    END IF;
  END IF;

  IF to_regclass('public."_ProjectToSkill"') IS NOT NULL THEN
    SELECT count(*) INTO bad FROM (
      (SELECT "A","B" FROM "_ProjectToSkill" EXCEPT SELECT "projectId","skillId" FROM "ProjectSkill")
      UNION ALL
      (SELECT "projectId","skillId" FROM "ProjectSkill" EXCEPT SELECT "A","B" FROM "_ProjectToSkill")
    ) d;
    IF bad > 0 THEN
      RAISE EXCEPTION 'contract: % project-skill pair(s) differ between implicit and explicit -- refusing to drop the implicit table', bad;
    END IF;
  END IF;

  -- a NULL sortOrder is impossible (NOT NULL), but a row that the mirror
  -- inserted and nothing has since reordered is worth seeing before the
  -- old representation disappears
  RAISE NOTICE 'contract guard ok: ExperienceSkill=% rows, ProjectSkill=% rows, Skill=% rows',
    (SELECT count(*) FROM "ExperienceSkill"),
    (SELECT count(*) FROM "ProjectSkill"),
    (SELECT count(*) FROM "Skill");
END
$$;


-- ---------------------------------------------------------------------
-- 2. Drop the REVERSE mirror triggers FIRST. See note (a) above.
--    After this, v2 writes to the explicit tables stop propagating to the
--    implicit ones, which is fine because the implicit ones die two
--    statements later -- and is exactly why this must be one transaction
--    with steps 3-4 and not a separate deployment step.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS "experience_skill_mirror_rev_trg" ON "ExperienceSkill";
DROP TRIGGER IF EXISTS "project_skill_mirror_rev_trg"    ON "ProjectSkill";

-- 3. Drop the FORWARD mirror triggers. DROP TABLE in step 4 would take
--    them anyway; doing it explicitly keeps the intent readable and keeps
--    this file re-runnable if step 4 has already happened.
DROP TRIGGER IF EXISTS "experience_skill_mirror_fwd_trg" ON "_ExperienceToSkill";
DROP TRIGGER IF EXISTS "project_skill_mirror_fwd_trg"    ON "_ProjectToSkill";


-- ---------------------------------------------------------------------
-- 4. Drop the implicit join tables.
--    What this breaks: every v1 read of a chip list, i.e. git HEAD
--      apps/web/app/lib/data.ts:192   skills: { select: { name: true } }
--      apps/web/app/lib/data.ts:243   skills: { select: { name, iconKey } }
--      apps/docs/app/(dashboard)/experiences/page.tsx:28
--      apps/docs/app/(dashboard)/experiences/[id]/page.tsx:9
--      apps/docs/app/(dashboard)/projects/page.tsx:35
--      apps/docs/app/(dashboard)/projects/[id]/page.tsx:9
--    and every v1 write, i.e. the connect/set at
--      apps/docs/app/lib/actions/experiences.ts:42,66
--      apps/docs/app/lib/actions/projects.ts:48,82
--    All of which is why this statement is in CONTRACT and not in EXPAND.
--    The only remaining reference anywhere in the v2 tree is
--    packages/db/scripts/transform.ts:238,241,273, a migration tool that
--    reads the JSON dump, not the database. Nothing deployed touches them.
--    Their two "_B_index" indexes and four CASCADE foreign keys go with
--    them; no CASCADE needed, nothing references these tables.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS "_ExperienceToSkill";
DROP TABLE IF EXISTS "_ProjectToSkill";

-- 5. Now the mirror functions are unreferenced.
DROP FUNCTION IF EXISTS "experience_skill_mirror_rev"();
DROP FUNCTION IF EXISTS "project_skill_mirror_rev"();
DROP FUNCTION IF EXISTS "experience_skill_mirror_fwd"();
DROP FUNCTION IF EXISTS "project_skill_mirror_fwd"();


-- ---------------------------------------------------------------------
-- 6. Drop the visibility sync trigger BEFORE the column. See note (b).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS "skill_show_sync" ON "Skill";
DROP FUNCTION IF EXISTS "skill_show_sync_fn"();


-- ---------------------------------------------------------------------
-- 7. Finish the rename by dropping the old half.
--    What this breaks: the five v1 sites listed in the EXPAND header
--    (data.ts:181, dashboard/page.tsx:41, hero/page.tsx:16,
--    skills/page.tsx:34,36, staging.ts:535,663,666). All of them are gone
--    from the deployed code by the time this runs.
--    After this, "Skill" is byte-identical in shape to
--    v2-migration-draft/target-ddl.sql:170-180, with one cosmetic
--    difference Prisma does not look at: "showInGrid" sits last in
--    ordinal position instead of fourth. `prisma migrate diff` compares
--    names, types, nullability and defaults, not attnum, so the diff is
--    still empty -- except for the one permanent, must-never-be-applied
--    DROP INDEX "Skill_name_lower_key" that the functional index causes.
-- ---------------------------------------------------------------------
ALTER TABLE "Skill" DROP COLUMN IF EXISTS "show";


-- ---------------------------------------------------------------------
-- VERIFICATION. Read before COMMIT.
-- ---------------------------------------------------------------------

-- C1. "Skill" now has exactly the v2 shape. expected exactly 7 rows, and
--     NO row named 'show':
--       id, name, iconKey, sortOrder, createdAt, updatedAt, showInGrid
--     with showInGrid = boolean / NO / true
SELECT ordinal_position, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'Skill'
 ORDER BY ordinal_position;

-- C2. Visibility survived the whole exercise unchanged.
--     expected 1 row: 47 | 45 | 2 | {React.js,WebSocket}
SELECT count(*)                                                          AS total,
       count(*) FILTER (WHERE "showInGrid")                              AS in_grid,
       count(*) FILTER (WHERE NOT "showInGrid")                          AS hidden,
       array_agg("name" ORDER BY "name") FILTER (WHERE NOT "showInGrid")   AS hidden_names
  FROM "Skill";

-- C3. Both implicit tables are gone. expected: t | t
SELECT to_regclass('public."_ExperienceToSkill"') IS NULL AS implicit_experience_dropped,
       to_regclass('public."_ProjectToSkill"')    IS NULL AS implicit_project_dropped;

-- C4. Every pair survived. expected: 17 | 38 (unless the admin has since
--     edited a chip list through v2, in which case compare against what
--     the admin shows, not against these numbers).
SELECT (SELECT count(*) FROM "ExperienceSkill") AS experience_skill_rows,
       (SELECT count(*) FROM "ProjectSkill")    AS project_skill_rows;

-- C5. No orphans, i.e. the CASCADE FKs are live. expected: 0 | 0 | 0 | 0
SELECT (SELECT count(*) FROM "ExperienceSkill" x
          WHERE NOT EXISTS (SELECT 1 FROM "Experience" e WHERE e.id = x."experienceId")) AS orphan_experience,
       (SELECT count(*) FROM "ExperienceSkill" x
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s.id = x."skillId"))           AS orphan_experience_skill,
       (SELECT count(*) FROM "ProjectSkill" p
          WHERE NOT EXISTS (SELECT 1 FROM "Project" pr WHERE pr.id = p."projectId"))     AS orphan_project,
       (SELECT count(*) FROM "ProjectSkill" p
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s.id = p."skillId"))           AS orphan_project_skill;

-- C6. No trigger from this cluster is left anywhere. expected: 0 rows.
--     A row here means a v2 write is about to fail with 42P01 or
--     'record "new" has no field "show"'.
SELECT t.relname AS table_name, g.tgname
  FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid
 WHERE NOT g.tgisinternal
   AND g.tgname IN ('skill_show_sync',
                    'experience_skill_mirror_fwd_trg','project_skill_mirror_fwd_trg',
                    'experience_skill_mirror_rev_trg','project_skill_mirror_rev_trg');

-- C7. No function from this cluster is left. expected: 0 rows.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = current_schema()
   AND p.proname IN ('skill_show_sync_fn',
                     'experience_skill_mirror_fwd','project_skill_mirror_fwd',
                     'experience_skill_mirror_rev','project_skill_mirror_rev');

-- C8. The three Skill indexes are still there and still valid.
--     expected 3 rows: Skill_name_key | Skill_name_lower_key | Skill_pkey
SELECT c.relname AS index, i.indisunique, i.indisvalid
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indrelid = '"Skill"'::regclass ORDER BY c.relname;

COMMIT;


-- =====================================================================
-- SECTION R. ROLLBACKS.
-- =====================================================================
--
-- R1. UNDO EXPAND. Use this BEFORE the deploy, if the v1 smoke test after
--     EXPAND fails. Lossless: it discards only the invented sortOrder and
--     the duplicated visibility column, both of which the v1 schema has
--     nowhere to hold. Run as one transaction.
--
--       BEGIN;
--         DROP TRIGGER IF EXISTS "experience_skill_mirror_rev_trg" ON "ExperienceSkill";
--         DROP TRIGGER IF EXISTS "project_skill_mirror_rev_trg"    ON "ProjectSkill";
--         DROP TRIGGER IF EXISTS "experience_skill_mirror_fwd_trg" ON "_ExperienceToSkill";
--         DROP TRIGGER IF EXISTS "project_skill_mirror_fwd_trg"    ON "_ProjectToSkill";
--         DROP FUNCTION IF EXISTS "experience_skill_mirror_rev"();
--         DROP FUNCTION IF EXISTS "project_skill_mirror_rev"();
--         DROP FUNCTION IF EXISTS "experience_skill_mirror_fwd"();
--         DROP FUNCTION IF EXISTS "project_skill_mirror_fwd"();
--         -- anything the mirror learned during the window, pushed back to
--         -- the representation v1 reads, before the new tables go away.
--         -- (With the mirrors running this is already a no-op; it is here
--         -- so the rollback is correct even if a trigger was disabled.)
--         INSERT INTO "_ExperienceToSkill" ("A","B")
--           SELECT "experienceId","skillId" FROM "ExperienceSkill"
--           ON CONFLICT ("A","B") DO NOTHING;
--         DELETE FROM "_ExperienceToSkill" j
--          WHERE NOT EXISTS (SELECT 1 FROM "ExperienceSkill" x
--                             WHERE x."experienceId" = j."A" AND x."skillId" = j."B");
--         INSERT INTO "_ProjectToSkill" ("A","B")
--           SELECT "projectId","skillId" FROM "ProjectSkill"
--           ON CONFLICT ("A","B") DO NOTHING;
--         DELETE FROM "_ProjectToSkill" j
--          WHERE NOT EXISTS (SELECT 1 FROM "ProjectSkill" p
--                             WHERE p."projectId" = j."A" AND p."skillId" = j."B");
--         DROP TABLE IF EXISTS "ExperienceSkill";
--         DROP TABLE IF EXISTS "ProjectSkill";
--         DROP TRIGGER IF EXISTS "skill_show_sync" ON "Skill";
--         DROP FUNCTION IF EXISTS "skill_show_sync_fn"();
--         -- "show" already carries every value, kept in step by the trigger
--         ALTER TABLE "Skill" DROP COLUMN IF EXISTS "showInGrid";
--         DROP INDEX IF EXISTS "Skill_name_lower_key";
--         DROP INDEX IF EXISTS "Skill_name_key";
--       COMMIT;
--
--     If EXPAND has not been committed yet, the rollback is simply
--     ROLLBACK; the whole file is one transaction.
--
-- R2. UNDO CONTRACT, i.e. go back to a schema v1 can serve AFTER this
--     file has committed. This is no longer a no-op: the implicit tables
--     and the "show" column have to be rebuilt and refilled. The implicit
--     DDL below is copied verbatim from
--     packages/db/prisma/migrations/20260307195336_init/migration.sql
--     (lines 192-201 for the four foreign keys).
--
--       BEGIN;
--         ALTER TABLE "Skill" ADD COLUMN "show" BOOLEAN NOT NULL DEFAULT true;
--         UPDATE "Skill" SET "show" = "showInGrid";
--
--         CREATE TABLE "_ExperienceToSkill" (
--             "A" TEXT NOT NULL,
--             "B" TEXT NOT NULL,
--             CONSTRAINT "_ExperienceToSkill_AB_pkey" PRIMARY KEY ("A","B")
--         );
--         CREATE TABLE "_ProjectToSkill" (
--             "A" TEXT NOT NULL,
--             "B" TEXT NOT NULL,
--             CONSTRAINT "_ProjectToSkill_AB_pkey" PRIMARY KEY ("A","B")
--         );
--         CREATE INDEX "_ExperienceToSkill_B_index" ON "_ExperienceToSkill"("B");
--         CREATE INDEX "_ProjectToSkill_B_index"    ON "_ProjectToSkill"("B");
--         ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_A_fkey"
--           FOREIGN KEY ("A") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--         ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_B_fkey"
--           FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--         ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_A_fkey"
--           FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--         ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_B_fkey"
--           FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--
--         INSERT INTO "_ExperienceToSkill" ("A","B")
--           SELECT "experienceId","skillId" FROM "ExperienceSkill";
--         INSERT INTO "_ProjectToSkill" ("A","B")
--           SELECT "projectId","skillId" FROM "ProjectSkill";
--
--         -- keep the explicit tables and re-create the EXPAND triggers if
--         -- you intend to roll forward again; drop them only once you are
--         -- certain v1 is where you are staying. Dropping them loses the
--         -- chip order, which v1 cannot represent.
--       COMMIT;
--
--     Then redeploy the v1 commit. Note that dropping the unique indexes
--     is NOT part of R2: v1 tolerates them, the data satisfies them, and
--     keeping them means a later retry of EXPAND is a smaller change.
-- =====================================================================
