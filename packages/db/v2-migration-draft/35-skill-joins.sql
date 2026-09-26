-- =====================================================================
-- cluster 35-skill-joins
-- target: the Neon child branch only. Production is not touched.
-- =====================================================================
--
-- WHAT THIS DOES
--   Prisma's two implicit many-to-many tables become explicit join models
--   that own a chip order:
--
--     "_ExperienceToSkill" (A = Experience.id, B = Skill.id, 17 rows)
--        ->  "ExperienceSkill" (experienceId, skillId, sortOrder)
--     "_ProjectToSkill"    (A = Project.id,    B = Skill.id, 38 rows)
--        ->  "ProjectSkill"    (projectId, skillId, sortOrder)
--
--   Both new tables use the composite primary key the schema declares
--   (@@id([experienceId, skillId]) / @@id([projectId, skillId])), carry
--   "sortOrder" INTEGER NOT NULL with NO DEFAULT, and get the two indexes
--   each model declares. The pairs are copied across verbatim, then both
--   implicit tables are dropped.
--
-- WHY THE A/B MAPPING IS NOT A GUESS
--   20260307195336_init/migration.sql lines 192-201 declare, literally:
--     "_ExperienceToSkill_A_fkey"  ("A") REFERENCES "Experience"("id")
--     "_ExperienceToSkill_B_fkey"  ("B") REFERENCES "Skill"("id")
--     "_ProjectToSkill_A_fkey"     ("A") REFERENCES "Project"("id")
--     "_ProjectToSkill_B_fkey"     ("B") REFERENCES "Skill"("id")
--   No later migration touches either table (grep over all 24 migrations:
--   only init mentions them; 20260528140143_baseline_drift_reconcile does
--   not). Preflight 6 re-reads those four constraint definitions out of
--   pg_constraint on the branch itself, and preflight 7 proves the join
--   direction against the live rows, so the mapping is verified twice at
--   run time and not inherited from this comment.
--
-- WHERE sortOrder COMES FROM
--   Nothing in the old data records a chip order: the implicit table has
--   exactly two columns and no read passes an orderBy today, so the order
--   a visitor currently sees is whatever the planner returned. There is no
--   ordering to preserve. This migration therefore INVENTS a deterministic
--   one: row_number() partitioned by the parent, ordered by the skill's own
--   grid order and then by name, which is the order the #skills grid already
--   renders in, minus 1 so it is 0-based.
--
--   0-based is the repo's convention, not a choice made here:
--     apps/docs/app/(dashboard)/experiences/form.tsx:68  bullets.map((b, i) => ({ ...b, sortOrder: i }))
--     apps/docs/app/lib/actions/experiences.ts:29        const count = (_max.sortOrder ?? -1) + 1;
--     apps/docs/app/lib/actions/projects.ts:117          ids.map((id, sortOrder) => ...)
--   and /tmp/v2/plan.txt step 15 specifies the new writer as
--   createMany of { skillId, sortOrder: i }. If the code half ever lands
--   1-based, this backfill is off by one against it.
--
--   Skill."name" is the tie-break because it is UNIQUE and, per
--   /tmp/v2/data-facts.txt, has no lower() duplicates among the 47 skills,
--   so the ordering key is total inside every partition. Skill."sortOrder"
--   alone is not known to be unique. Preflight 8 asserts totality anyway.
--   This migration reads only Skill."id", "name" and "sortOrder"; it never
--   touches Skill."show" / "showInGrid", so it is independent of the
--   Skill rename cluster and can run before or after it.
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional on Postgres 17. Run the
--   whole file inside one BEGIN/COMMIT. No CONCURRENTLY, no VACUUM, no
--   extension, no session_replication_role, no DISABLE TRIGGER: the two
--   tables being written are brand new and empty, so nothing needs
--   triggers or FK checks deferred. Owner privileges are sufficient.
--
-- IDEMPOTENCY, HONESTLY
--   CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, INSERT ...
--   ON CONFLICT DO NOTHING and DROP TABLE IF EXISTS make every statement
--   a no-op on a second run *within the same transaction attempt*.
--   Once the DROPs COMMIT the file can no longer be re-run: the two
--   INSERT ... SELECT statements reference "_ExperienceToSkill" and
--   "_ProjectToSkill" by name and will fail with 42P01 undefined_table.
--   That is deliberate - a silent no-op there would hide a half-migrated
--   branch. To re-run after a commit, restore the branch or recreate the
--   implicit tables with the rollback block below first.
--
--   The primary key and both foreign keys are declared INLINE in
--   CREATE TABLE rather than as ALTER TABLE ... ADD CONSTRAINT, because
--   ADD CONSTRAINT has no IF NOT EXISTS and would abort the transaction on
--   a re-run. The resulting pg_constraint rows are identical either way -
--   same names, same columns, same ON DELETE/ON UPDATE actions - so
--   `prisma migrate diff` against the new schema still comes back empty.
--
-- ROLLBACK
--   Inside the transaction: ROLLBACK. Nothing else is needed; the DROPs
--   are undone with everything else.
--   After a COMMIT, this restores the pre-migration state exactly (the
--   implicit DDL is copied verbatim from the init migration):
--
--     CREATE TABLE "_ExperienceToSkill" (
--         "A" TEXT NOT NULL,
--         "B" TEXT NOT NULL,
--         CONSTRAINT "_ExperienceToSkill_AB_pkey" PRIMARY KEY ("A","B")
--     );
--     CREATE TABLE "_ProjectToSkill" (
--         "A" TEXT NOT NULL,
--         "B" TEXT NOT NULL,
--         CONSTRAINT "_ProjectToSkill_AB_pkey" PRIMARY KEY ("A","B")
--     );
--     CREATE INDEX "_ExperienceToSkill_B_index" ON "_ExperienceToSkill"("B");
--     CREATE INDEX "_ProjectToSkill_B_index" ON "_ProjectToSkill"("B");
--     ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_A_fkey"
--       FOREIGN KEY ("A") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--     ALTER TABLE "_ExperienceToSkill" ADD CONSTRAINT "_ExperienceToSkill_B_fkey"
--       FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--     ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_A_fkey"
--       FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--     ALTER TABLE "_ProjectToSkill" ADD CONSTRAINT "_ProjectToSkill_B_fkey"
--       FOREIGN KEY ("B") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--     INSERT INTO "_ExperienceToSkill" ("A", "B")
--       SELECT "experienceId", "skillId" FROM "ExperienceSkill";
--     INSERT INTO "_ProjectToSkill" ("A", "B")
--       SELECT "projectId", "skillId" FROM "ProjectSkill";
--     DROP TABLE "ExperienceSkill";
--     DROP TABLE "ProjectSkill";
--
--   The rollback is lossless in both directions for the pairs. It discards
--   the invented "sortOrder", which the old schema has nowhere to hold.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PREFLIGHT. Run these first and read them. Every one must match.
-- ---------------------------------------------------------------------

-- 1. Both sources present, both targets absent.
--    expected: t | t | t | t
SELECT to_regclass('public."_ExperienceToSkill"') IS NOT NULL AS src_experience_present,
       to_regclass('public."_ProjectToSkill"')    IS NOT NULL AS src_project_present,
       to_regclass('public."ExperienceSkill"')    IS NULL     AS target_experience_absent,
       to_regclass('public."ProjectSkill"')       IS NULL     AS target_project_absent;

-- 2. Source row counts.
--    expected: 17 | 38
SELECT (SELECT count(*) FROM "_ExperienceToSkill") AS experience_to_skill,
       (SELECT count(*) FROM "_ProjectToSkill")    AS project_to_skill;

-- 3. No NULL keys. The columns are declared NOT NULL in init, so this is
--    a paranoia check that costs nothing at 55 rows.
--    expected: 0 | 0
SELECT (SELECT count(*) FROM "_ExperienceToSkill" WHERE "A" IS NULL OR "B" IS NULL) AS null_experience_keys,
       (SELECT count(*) FROM "_ProjectToSkill"    WHERE "A" IS NULL OR "B" IS NULL) AS null_project_keys;

-- 4. No orphans on either side. Guaranteed by the four CASCADE foreign
--    keys, asserted because the new tables re-declare those FKs and an
--    orphan would abort the INSERT mid-transaction.
--    expected: 0 | 0 | 0 | 0
SELECT (SELECT count(*) FROM "_ExperienceToSkill" j
          WHERE NOT EXISTS (SELECT 1 FROM "Experience" e WHERE e."id" = j."A")) AS orphan_experience,
       (SELECT count(*) FROM "_ExperienceToSkill" j
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s."id" = j."B"))      AS orphan_experience_skill,
       (SELECT count(*) FROM "_ProjectToSkill" j
          WHERE NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = j."A"))    AS orphan_project,
       (SELECT count(*) FROM "_ProjectToSkill" j
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s."id" = j."B"))      AS orphan_project_skill;

-- 5. No duplicate pairs. The AB primary keys forbid it; asserted because
--    the new composite PK has to accept the same set.
--    expected: 0 | 0
SELECT (SELECT count(*) FROM (SELECT "A", "B" FROM "_ExperienceToSkill"
                              GROUP BY 1, 2 HAVING count(*) > 1) d) AS dup_experience_pairs,
       (SELECT count(*) FROM (SELECT "A", "B" FROM "_ProjectToSkill"
                              GROUP BY 1, 2 HAVING count(*) > 1) d) AS dup_project_pairs;

-- 6. Confirm the A/B mapping from the catalog, not from the init file.
--    The ::regclass casts raise 42P01 if either table is already gone, so
--    run preflight 1 first and stop there if it says otherwise.
--    expected exactly these six rows:
--      _ExperienceToSkill_A_fkey  | FOREIGN KEY ("A") REFERENCES "Experience"(id) ON UPDATE CASCADE ON DELETE CASCADE
--      _ExperienceToSkill_AB_pkey | PRIMARY KEY ("A", "B")
--      _ExperienceToSkill_B_fkey  | FOREIGN KEY ("B") REFERENCES "Skill"(id) ON UPDATE CASCADE ON DELETE CASCADE
--      _ProjectToSkill_A_fkey     | FOREIGN KEY ("A") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE
--      _ProjectToSkill_AB_pkey    | PRIMARY KEY ("A", "B")
--      _ProjectToSkill_B_fkey     | FOREIGN KEY ("B") REFERENCES "Skill"(id) ON UPDATE CASCADE ON DELETE CASCADE
--    If "A" turns out to reference Skill on either table, STOP: the two
--    INSERT statements below are written A -> parent, B -> skill.
SELECT c."conname", pg_get_constraintdef(c."oid") AS definition
  FROM pg_constraint c
 WHERE c."conrelid" IN ('public."_ExperienceToSkill"'::regclass,
                        'public."_ProjectToSkill"'::regclass)
 ORDER BY c."conname";

-- 7. Confirm the same mapping against the live rows. Ids are uuids, so a
--    column pointing at the wrong table joins to nothing.
--    expected: 17 | 0 | 17 | 38 | 0 | 38
SELECT (SELECT count(*) FROM "_ExperienceToSkill" j JOIN "Experience" e ON e."id" = j."A") AS xp_a_in_experience,
       (SELECT count(*) FROM "_ExperienceToSkill" j JOIN "Skill"      s ON s."id" = j."A") AS xp_a_in_skill,
       (SELECT count(*) FROM "_ExperienceToSkill" j JOIN "Skill"      s ON s."id" = j."B") AS xp_b_in_skill,
       (SELECT count(*) FROM "_ProjectToSkill"    j JOIN "Project"    p ON p."id" = j."A") AS pr_a_in_project,
       (SELECT count(*) FROM "_ProjectToSkill"    j JOIN "Skill"      s ON s."id" = j."A") AS pr_a_in_skill,
       (SELECT count(*) FROM "_ProjectToSkill"    j JOIN "Skill"      s ON s."id" = j."B") AS pr_b_in_skill;

-- 8. The ordering key (skill sortOrder, skill name) is total inside every
--    partition, so row_number() is deterministic and a re-run of the same
--    backfill would produce byte-identical sortOrder values.
--    expected: 0 | 0
SELECT (SELECT count(*) FROM (
          SELECT j."A", s."sortOrder", s."name"
            FROM "_ExperienceToSkill" j JOIN "Skill" s ON s."id" = j."B"
           GROUP BY 1, 2, 3 HAVING count(*) > 1) d) AS ambiguous_experience_order,
       (SELECT count(*) FROM (
          SELECT j."A", s."sortOrder", s."name"
            FROM "_ProjectToSkill" j JOIN "Skill" s ON s."id" = j."B"
           GROUP BY 1, 2, 3 HAVING count(*) > 1) d) AS ambiguous_project_order;


-- ---------------------------------------------------------------------
-- DDL. Create both explicit join tables.
-- Names are exactly what Prisma will diff against:
--   PK      <Table>_pkey
--   FK      <Table>_<column>_fkey
--   index   <Table>_<column>[_<column>]_idx
-- onDelete: Cascade on both relations in the new schema, and Prisma emits
-- ON UPDATE CASCADE alongside it, matching the implicit tables it replaces.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ExperienceSkill" (
    "experienceId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ExperienceSkill_pkey" PRIMARY KEY ("experienceId", "skillId"),
    CONSTRAINT "ExperienceSkill_experienceId_fkey" FOREIGN KEY ("experienceId")
        REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceSkill_skillId_fkey" FOREIGN KEY ("skillId")
        REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("projectId", "skillId"),
    CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId")
        REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- @@index([experienceId, sortOrder]) / @@index([projectId, sortOrder]):
-- the ordered read path.
CREATE INDEX IF NOT EXISTS "ExperienceSkill_experienceId_sortOrder_idx"
    ON "ExperienceSkill" ("experienceId", "sortOrder");

CREATE INDEX IF NOT EXISTS "ProjectSkill_projectId_sortOrder_idx"
    ON "ProjectSkill" ("projectId", "sortOrder");

-- @@index([skillId]): carried over from the implicit "_B_index". It exists
-- for the cascade delete when a Skill row goes away, not for a reader - no
-- query looks experiences or projects up by skill.
CREATE INDEX IF NOT EXISTS "ExperienceSkill_skillId_idx"
    ON "ExperienceSkill" ("skillId");

CREATE INDEX IF NOT EXISTS "ProjectSkill_skillId_idx"
    ON "ProjectSkill" ("skillId");

-- No index on the leading PK column alone: the composite PK's btree and
-- the ("experienceId", "sortOrder") index both serve a parent-prefix
-- lookup, and the new schema declares no such index. Adding one would
-- itself show up as drift.


-- ---------------------------------------------------------------------
-- DML. Copy the pairs, inventing a deterministic 0-based sortOrder.
-- ON CONFLICT DO NOTHING so a retry inside the same transaction attempt
-- is a no-op rather than a PK violation.
-- ---------------------------------------------------------------------

INSERT INTO "ExperienceSkill" ("experienceId", "skillId", "sortOrder")
SELECT j."A",
       j."B",
       (row_number() OVER (PARTITION BY j."A" ORDER BY s."sortOrder" ASC, s."name" ASC))::int - 1
  FROM "_ExperienceToSkill" j
  JOIN "Skill" s ON s."id" = j."B"
ON CONFLICT ("experienceId", "skillId") DO NOTHING;

INSERT INTO "ProjectSkill" ("projectId", "skillId", "sortOrder")
SELECT j."A",
       j."B",
       (row_number() OVER (PARTITION BY j."A" ORDER BY s."sortOrder" ASC, s."name" ASC))::int - 1
  FROM "_ProjectToSkill" j
  JOIN "Skill" s ON s."id" = j."B"
ON CONFLICT ("projectId", "skillId") DO NOTHING;


-- ---------------------------------------------------------------------
-- GUARD. Prove the pair sets are identical BEFORE the sources are gone.
-- This is the one check that cannot live in the verification section,
-- because after the DROP there is nothing left to compare against.
-- Raises and aborts the transaction on any difference, in either
-- direction, on either table.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    missing_experience bigint;
    extra_experience   bigint;
    missing_project    bigint;
    extra_project      bigint;
BEGIN
    SELECT count(*) INTO missing_experience FROM (
        SELECT "A", "B" FROM "_ExperienceToSkill"
        EXCEPT SELECT "experienceId", "skillId" FROM "ExperienceSkill") d;

    SELECT count(*) INTO extra_experience FROM (
        SELECT "experienceId", "skillId" FROM "ExperienceSkill"
        EXCEPT SELECT "A", "B" FROM "_ExperienceToSkill") d;

    SELECT count(*) INTO missing_project FROM (
        SELECT "A", "B" FROM "_ProjectToSkill"
        EXCEPT SELECT "projectId", "skillId" FROM "ProjectSkill") d;

    SELECT count(*) INTO extra_project FROM (
        SELECT "projectId", "skillId" FROM "ProjectSkill"
        EXCEPT SELECT "A", "B" FROM "_ProjectToSkill") d;

    IF missing_experience <> 0 OR extra_experience <> 0
       OR missing_project <> 0 OR extra_project <> 0 THEN
        RAISE EXCEPTION
            'skill join backfill mismatch: experience missing=% extra=%, project missing=% extra=%',
            missing_experience, extra_experience, missing_project, extra_project;
    END IF;
END
$$;


-- ---------------------------------------------------------------------
-- DROP the implicit tables. Their two indexes ("_B_index") and four
-- foreign keys go with them automatically; no explicit DROP needed, and
-- no CASCADE either - nothing references these tables.
-- Everything they held is a pair, and every pair is now in the explicit
-- table, proven one statement above.
-- ---------------------------------------------------------------------

DROP TABLE IF EXISTS "_ExperienceToSkill";
DROP TABLE IF EXISTS "_ProjectToSkill";


-- ---------------------------------------------------------------------
-- VERIFICATION. Run after the DDL/DML, before COMMIT.
-- ---------------------------------------------------------------------

-- V1. Every source row landed, nothing extra.
--     expected: 17 | 38
SELECT (SELECT count(*) FROM "ExperienceSkill") AS experience_skill_rows,
       (SELECT count(*) FROM "ProjectSkill")    AS project_skill_rows;

-- V2. The implicit tables are gone.
--     expected: t | t
SELECT to_regclass('public."_ExperienceToSkill"') IS NULL AS experience_source_dropped,
       to_regclass('public."_ProjectToSkill"')    IS NULL AS project_source_dropped;

-- V3. sortOrder is a dense 0-based sequence inside every parent: min 0,
--     max = count - 1, no duplicates. Any parent that fails shows up here.
--     expected: 0 rows
SELECT 'ExperienceSkill' AS tbl, "experienceId" AS parent_id,
       count(*) AS chips, min("sortOrder") AS lo, max("sortOrder") AS hi,
       count(DISTINCT "sortOrder") AS distinct_order
  FROM "ExperienceSkill"
 GROUP BY "experienceId"
HAVING min("sortOrder") <> 0
    OR max("sortOrder") <> count(*) - 1
    OR count(DISTINCT "sortOrder") <> count(*)
UNION ALL
SELECT 'ProjectSkill', "projectId",
       count(*), min("sortOrder"), max("sortOrder"), count(DISTINCT "sortOrder")
  FROM "ProjectSkill"
 GROUP BY "projectId"
HAVING min("sortOrder") <> 0
    OR max("sortOrder") <> count(*) - 1
    OR count(DISTINCT "sortOrder") <> count(*);

-- V4. Per-parent chip counts, for the record.
--     expected: sum(chips) = 17 over the ExperienceSkill rows and 38 over
--     the ProjectSkill rows, and at most 8 rows (2 experiences, 6 projects).
--     /tmp/v2/data-facts.txt does not state the per-parent distribution, so
--     fewer than 8 rows is not a failure - it means some parent has no
--     chips at all, which the old implicit table allowed too.
SELECT 'ExperienceSkill' AS tbl, "experienceId" AS parent_id, count(*) AS chips
  FROM "ExperienceSkill" GROUP BY "experienceId"
UNION ALL
SELECT 'ProjectSkill', "projectId", count(*)
  FROM "ProjectSkill" GROUP BY "projectId"
 ORDER BY 1, 2;

-- V5. No orphan survived the copy, and the FKs are live.
--     expected: 0 | 0 | 0 | 0
SELECT (SELECT count(*) FROM "ExperienceSkill" x
          WHERE NOT EXISTS (SELECT 1 FROM "Experience" e WHERE e."id" = x."experienceId")) AS orphan_experience,
       (SELECT count(*) FROM "ExperienceSkill" x
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s."id" = x."skillId"))           AS orphan_experience_skill,
       (SELECT count(*) FROM "ProjectSkill" p
          WHERE NOT EXISTS (SELECT 1 FROM "Project" pr WHERE pr."id" = p."projectId"))     AS orphan_project,
       (SELECT count(*) FROM "ProjectSkill" p
          WHERE NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s."id" = p."skillId"))           AS orphan_project_skill;

-- V6. Column shape. sortOrder must be integer, NOT NULL, and have NO
--     default - the whole point of the coupled code change.
--     expected exactly these six rows, in this order:
--       ExperienceSkill | experienceId | text    | NO | (null)
--       ExperienceSkill | skillId      | text    | NO | (null)
--       ExperienceSkill | sortOrder    | integer | NO | (null)
--       ProjectSkill    | projectId    | text    | NO | (null)
--       ProjectSkill    | skillId      | text    | NO | (null)
--       ProjectSkill    | sortOrder    | integer | NO | (null)
SELECT c."table_name", c."column_name", c."data_type", c."is_nullable", c."column_default"
  FROM information_schema."columns" c
 WHERE c."table_schema" = 'public'
   AND c."table_name" IN ('ExperienceSkill', 'ProjectSkill')
 ORDER BY c."table_name", c."ordinal_position";

-- V7. Constraint names, so `prisma migrate diff` stays empty.
--     expected exactly these six rows:
--       ExperienceSkill | ExperienceSkill_experienceId_fkey | FOREIGN KEY ("experienceId") REFERENCES "Experience"(id) ON UPDATE CASCADE ON DELETE CASCADE
--       ExperienceSkill | ExperienceSkill_pkey              | PRIMARY KEY ("experienceId", "skillId")
--       ExperienceSkill | ExperienceSkill_skillId_fkey      | FOREIGN KEY ("skillId") REFERENCES "Skill"(id) ON UPDATE CASCADE ON DELETE CASCADE
--       ProjectSkill    | ProjectSkill_pkey                 | PRIMARY KEY ("projectId", "skillId")
--       ProjectSkill    | ProjectSkill_projectId_fkey       | FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON UPDATE CASCADE ON DELETE CASCADE
--       ProjectSkill    | ProjectSkill_skillId_fkey         | FOREIGN KEY ("skillId") REFERENCES "Skill"(id) ON UPDATE CASCADE ON DELETE CASCADE
--     No CHECK constraints: schema-v2.md's CHECK inventory lists none for
--     either join table.
SELECT t."relname" AS table_name, c."conname", pg_get_constraintdef(c."oid") AS definition
  FROM pg_constraint c
  JOIN pg_class t ON t."oid" = c."conrelid"
 WHERE t."relname" IN ('ExperienceSkill', 'ProjectSkill')
 ORDER BY t."relname", c."conname";

-- V8. Index names, same reason. The *_pkey rows are the PK's own btree.
--     expected exactly these six rows:
--       ExperienceSkill | ExperienceSkill_experienceId_sortOrder_idx
--       ExperienceSkill | ExperienceSkill_pkey
--       ExperienceSkill | ExperienceSkill_skillId_idx
--       ProjectSkill    | ProjectSkill_pkey
--       ProjectSkill    | ProjectSkill_projectId_sortOrder_idx
--       ProjectSkill    | ProjectSkill_skillId_idx
SELECT i."tablename", i."indexname"
  FROM pg_indexes i
 WHERE i."schemaname" = 'public'
   AND i."tablename" IN ('ExperienceSkill', 'ProjectSkill')
 ORDER BY i."tablename", i."indexname";

-- V9. Eyeball the order that got frozen in, one row per chip.
--     expected: 55 rows, sortOrder ascending and gapless within each parent,
--     skill names in grid order then alphabetical.
SELECT 'experience' AS kind, e."company" AS parent, x."sortOrder", s."name"
  FROM "ExperienceSkill" x
  JOIN "Experience" e ON e."id" = x."experienceId"
  JOIN "Skill" s ON s."id" = x."skillId"
UNION ALL
SELECT 'project', p."title", ps."sortOrder", s."name"
  FROM "ProjectSkill" ps
  JOIN "Project" p ON p."id" = ps."projectId"
  JOIN "Skill" s ON s."id" = ps."skillId"
 ORDER BY 1, 2, 3;
