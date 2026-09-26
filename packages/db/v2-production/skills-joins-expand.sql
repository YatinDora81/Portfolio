-- =====================================================================
-- PRODUCTION CUTOVER, cluster: skills-joins        STAGE 1 of 2: EXPAND
-- Run this while the CURRENTLY DEPLOYED v1 code is live and serving.
-- Nothing here is allowed to break v1. Nothing here drops anything.
-- =====================================================================
--
-- WHAT THIS CLUSTER CHANGES, AND WHERE IT LANDS
--
--   change                                             stage
--   ------------------------------------------------   -------------------
--   Skill."show" -> Skill."showInGrid"                 SPLIT: add+sync here,
--                                                      drop "show" in CONTRACT
--   Skill."name" UNIQUE                                EXPAND
--   UNIQUE on lower(Skill."name")                      EXPAND
--   new table "ExperienceSkill" (+3 idx, 2 FK)         EXPAND
--   new table "ProjectSkill"    (+3 idx, 2 FK)         EXPAND
--   backfill both from the implicit tables             EXPAND
--   keep the two representations in step during the
--     window (mirror triggers)                        EXPAND
--   DROP "_ExperienceToSkill" / "_ProjectToSkill"      CONTRACT
--   DROP Skill."show"                                  CONTRACT
--
-- THE RENAME IS NOT ADDITIVE, SO IT IS NOT DONE AS A RENAME.
--   ALTER TABLE "Skill" RENAME COLUMN "show" TO "showInGrid" is a
--   catalogue-only, instant, lossless operation -- and it takes the
--   public site down the moment it commits, because git HEAD contains:
--     apps/web/app/lib/data.ts:181         where: { show: true }
--   which is getSkills(), called unconditionally from
--     apps/web/app/page.tsx:66
--   getSkills() is NOT wrapped in unstable_cache (only siteConfig,
--   projects and blogs are), so it hits Postgres on every regeneration of
--   "/". "/" is ISR with `export const revalidate = 86400`
--   (apps/web/app/page.tsx:276), which makes the failure WORSE, not
--   better: the last good HTML keeps being served, so the breakage is
--   invisible, and it detonates at an unpredictable later moment -- the
--   24h expiry, or the next admin save, which calls revalidatePath /
--   revalidateTag and forces a synchronous regeneration against a column
--   that no longer exists (42703 undefined_column). Same for the admin:
--     apps/docs/app/(dashboard)/dashboard/page.tsx:41  skill.count({ where: { show: true } })
--     apps/docs/app/(dashboard)/hero/page.tsx:16       skill.count({ where: { show: true } })
--     apps/docs/app/(dashboard)/skills/page.tsx:34,36  s.show
--     apps/docs/app/lib/actions/staging.ts:535         create ... show:
--     apps/docs/app/lib/actions/staging.ts:663,666     update ... show
--   So the rename is decomposed: ADD the new column, backfill it, keep
--   the two in lockstep with a BEFORE trigger for as long as both exist,
--   DROP the old one after the deploy. Statement 2 below is the "add",
--   statement 3 the backfill, statement 4 the lockstep.
--
-- WHY THE EXTRA COLUMN DOES NOT BREAK v1 (and why the leftover "show"
-- will not break v2 after the deploy): the Prisma client never issues
-- SELECT * and never issues INSERT without a column list. It enumerates
-- exactly the columns in the schema it was generated from. So:
--   - v1 SELECTs on "Skill" do not mention "showInGrid" -> unaffected.
--   - v1 INSERTs on "Skill" do not mention "showInGrid" -> it must
--     therefore have a DEFAULT, which is why statement 2 is
--     NOT NULL DEFAULT true and not NOT NULL bare. A NOT NULL column
--     with no default would make staging.ts:531 tx.skill.create() fail
--     with 23502 not_null_violation and roll back the operator's whole
--     staged batch.
--   - after the deploy, v2 INSERTs on "Skill" do not mention "show",
--     which still exists and is still NOT NULL -- it keeps its own
--     DEFAULT true from 20260307195336_init line 68, so the insert
--     succeeds, and the trigger then copies showInGrid onto it.
--   - v1's audit snapshot (apps/docs/app/lib/audit.ts:133-140 iterates
--     Object.keys of the snapshot row) therefore does NOT gain a spurious
--     "showInGrid" AuditChange row, because the v1 client never selected
--     the column in the first place.
--
-- WHY THE TWO NEW TABLES ARE PURE EXPAND
--   "ExperienceSkill"."sortOrder" is INTEGER NOT NULL with NO DEFAULT,
--   which is normally the textbook v1-breaking column. It is safe here
--   for one reason only: v1 has no generated model for this table and
--   never inserts into it. The rule is about columns added to tables the
--   deployed code writes; this is a brand-new table.
--   The two foreign keys are ON DELETE CASCADE, which is what the v2
--   schema declares (packages/db/prisma/schema.prisma:201,203,252,254)
--   and also what makes them invisible to v1: a v1
--     prisma.experience.delete()            (actions/experiences.ts:93)
--     prisma.project.delete()               (actions/projects.ts:110)
--     tx.skill.deleteMany()                 (staging.ts:741)
--   silently takes the mirror rows with it. Had these been Restrict or
--   NoAction, every one of those three v1 deletes would start failing
--   with 23503 foreign_key_violation the instant this file committed.
--
-- THE WINDOW, AND WHY THE MIRROR TRIGGERS ARE NOT OPTIONAL
--   Between this file and the deploy, the admin app is still v1 and still
--   writes the IMPLICIT tables:
--     apps/docs/app/lib/actions/experiences.ts:42  skills: { connect: ... }
--     apps/docs/app/lib/actions/experiences.ts:66  skills: { set: ... }
--     apps/docs/app/lib/actions/projects.ts:48     skills: { connect: ... }
--     apps/docs/app/lib/actions/projects.ts:82     skills: { set: ... }
--   A single experience save in that window, with no mirror, means the
--   backfilled "ExperienceSkill" is stale, and the deploy silently
--   publishes the OLD chip list; a v1 CREATE in that window means the new
--   role renders with ZERO chips, because nothing ever wrote its mirror
--   rows. No error anywhere. Statements 12-15 close that hole.
--   The mirrors are bidirectional on purpose: that makes the two
--   representations byte-identical at every instant, which is what makes
--   the DEPLOY reversible. If you ship v2, it writes "ProjectSkill",
--   and you then have to roll the deployment back, v1 reads
--   "_ProjectToSkill" and finds it already updated.
--
-- TRANSACTIONALITY
--   Run the whole file as ONE transaction. Every statement is
--   transactional on Postgres 17 and owner privileges are sufficient;
--   no CONCURRENTLY, no superuser, no extension, no
--   session_replication_role, no DISABLE TRIGGER.
--   Locks taken and held to COMMIT:
--     ACCESS EXCLUSIVE on "Skill"               (ADD COLUMN, 2x CREATE INDEX, CREATE TRIGGER)
--     ACCESS EXCLUSIVE on "_ExperienceToSkill", "_ProjectToSkill"  (CREATE TRIGGER)
--     SHARE ROW EXCLUSIVE on "Experience", "Project", "Skill"      (inline FKs)
--   Public reads of #skills and of the experience/project chip lists
--   block for the duration. At 47 skills and 55 join rows that is
--   milliseconds. ADD COLUMN ... DEFAULT true does not rewrite the heap
--   (PG 11+ stores the default in the catalogue). lock_timeout below
--   makes the whole thing give up rather than queue.
--
-- ROLLBACK: see /tmp/v2/prod/skills-joins-contract.sql, section R.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';


-- ---------------------------------------------------------------------
-- 1. PREFLIGHT. One raising guard, so the file is safe non-interactively.
--    Grounded in packages/db/v2-migration-draft/data-facts.txt:
--      Skill: 47 rows, show=false on exactly 'React.js' and 'WebSocket',
--      "lower() duplicates: none";
--      _ExperienceToSkill 17 rows, _ProjectToSkill 38 rows;
--    and in 20260307195336_init/migration.sql:64-74 (Skill DDL) and
--    :192-201 (the four implicit FKs that fix the A/B direction).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  has_show     boolean;
  has_new      boolean;
  n            bigint;
BEGIN
  SELECT count(*) FILTER (WHERE column_name = 'show')       = 1,
         count(*) FILTER (WHERE column_name = 'showInGrid') = 1
    INTO has_show, has_new
    FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'Skill';

  IF NOT has_show AND has_new THEN
    RAISE NOTICE 'expand: Skill."showInGrid" already present, statements 2-4 will no-op';
  ELSIF NOT has_show THEN
    RAISE EXCEPTION 'expand: Skill has neither "show" nor "showInGrid" -- refusing';
  END IF;

  IF to_regclass('public."_ExperienceToSkill"') IS NULL
     OR to_regclass('public."_ProjectToSkill"') IS NULL THEN
    RAISE EXCEPTION 'expand: an implicit skill join table is missing -- v1 still reads it, refusing';
  END IF;

  -- duplicates would abort statements 5 and 6
  SELECT count(*) INTO n FROM (SELECT 1 FROM "Skill" GROUP BY "name" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'expand: % duplicate Skill.name -- dedupe first', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "Skill" GROUP BY lower("name") HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'expand: % case-insensitive duplicate Skill.name -- dedupe first', n; END IF;

  -- orphans would abort the two backfill INSERTs against the new FKs
  SELECT count(*) INTO n FROM "_ExperienceToSkill" j
   WHERE NOT EXISTS (SELECT 1 FROM "Experience" e WHERE e.id = j."A")
      OR NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s.id = j."B");
  IF n > 0 THEN RAISE EXCEPTION 'expand: % orphan rows in _ExperienceToSkill', n; END IF;

  SELECT count(*) INTO n FROM "_ProjectToSkill" j
   WHERE NOT EXISTS (SELECT 1 FROM "Project" p WHERE p.id = j."A")
      OR NOT EXISTS (SELECT 1 FROM "Skill" s WHERE s.id = j."B");
  IF n > 0 THEN RAISE EXCEPTION 'expand: % orphan rows in _ProjectToSkill', n; END IF;

  -- A/B direction, from the catalogue, not from a comment. If "A" points
  -- at Skill on either table, statements 10-11 are written backwards.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = '_ExperienceToSkill_A_fkey'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("A") REFERENCES "Experience"%')
  OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = '_ProjectToSkill_A_fkey'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("A") REFERENCES "Project"%') THEN
    RAISE EXCEPTION 'expand: implicit join A/B direction is not parent->skill -- refusing';
  END IF;

  RAISE NOTICE 'expand preflight ok: Skill=% rows, _ExperienceToSkill=%, _ProjectToSkill=%',
    (SELECT count(*) FROM "Skill"),
    (SELECT count(*) FROM "_ExperienceToSkill"),
    (SELECT count(*) FROM "_ProjectToSkill");
END
$$;


-- ---------------------------------------------------------------------
-- PART A. The rename, decomposed.
-- ---------------------------------------------------------------------

-- 2. ADD the new column next to the old one.
--    NOT NULL DEFAULT true is mandatory, not stylistic: v1's
--    tx.skill.create() (staging.ts:531) does not name this column.
--    DEFAULT true also matches the v2 target exactly
--    (v2-migration-draft/target-ddl.sql:174), so CONTRACT will not have
--    to touch the column at all.
--    v1 after this statement: unaffected. No v1 SELECT, INSERT or UPDATE
--    names "showInGrid"; the Prisma client enumerates columns.
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "showInGrid" BOOLEAN NOT NULL DEFAULT true;

-- 3. BACKFILL. Expected: 2 rows updated ('React.js', 'WebSocket'),
--    per data-facts.txt "show=false: ['React.js', 'WebSocket']".
--    Deliberately does not touch "updatedAt": Skill."updatedAt" is
--    Prisma's @updatedAt, driven by the client, not by a DB trigger, so
--    this backfill leaves every content timestamp where it was and does
--    not make anything look freshly edited.
UPDATE "Skill" SET "showInGrid" = "show" WHERE "showInGrid" IS DISTINCT FROM "show";

-- 4. LOCKSTEP. For as long as both columns exist, a write to either one
--    sets the other. This is what makes the window safe in BOTH
--    directions: a v1 visibility toggle (staging.ts:666) reaches v2's
--    column, and a v2 toggle (staging.ts:724 in the working tree)
--    reaches v1's, so the deployment can be rolled back.
--
--    INSERT arm: both columns carry DEFAULT true, so "which one did the
--    writer name" is undecidable inside a BEFORE trigger. It does not
--    need to be decidable. v1 names only "show", v2 names only
--    "showInGrid", and the only value either ever writes away from the
--    default is false -- so "false wins" reproduces both writers exactly.
--    UPDATE arm: whichever column actually changed is authoritative.
--
--    v1 after this statement: unaffected. A BEFORE ROW trigger that only
--    rewrites NEW fields is invisible to the caller; v1 keeps reading and
--    writing "show" and gets exactly the values it wrote.
CREATE OR REPLACE FUNCTION "skill_show_sync_fn"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW."show" OR NOT NEW."showInGrid" THEN
      NEW."show"       := false;
      NEW."showInGrid" := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."show" <> OLD."show" AND NEW."showInGrid" = OLD."showInGrid" THEN
    NEW."showInGrid" := NEW."show";          -- a v1 writer moved the old column
  ELSIF NEW."showInGrid" <> OLD."showInGrid" THEN
    NEW."show" := NEW."showInGrid";          -- a v2 writer moved the new column
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "skill_show_sync"
  BEFORE INSERT OR UPDATE ON "Skill"
  FOR EACH ROW EXECUTE FUNCTION "skill_show_sync_fn"();


-- ---------------------------------------------------------------------
-- PART B. The two unique indexes on Skill.name.
--
-- HONEST CAVEAT, the only place in this file where v1 behaviour changes:
-- v1's staging.ts:531 skill-create branch does NO duplicate pre-check, so
-- after statement 5 an operator who retypes an existing skill name gets a
-- raw P2002 that rolls back the whole staged batch instead of silently
-- creating a second 'Docker'. That is the behaviour v2 wants and
-- schema-v2.md already flags as needing a readable error; the data has no
-- duplicates today (data-facts.txt), so nothing existing breaks and no
-- read path is affected. It is listed here so nobody is surprised.
-- If you would rather not change v1 behaviour at all, both statements
-- move to CONTRACT with no other consequence for THIS cluster -- but the
-- hero-badge cluster's lower(name) resolution wants statement 6 in place
-- before ITS backfill runs, so check that cluster before moving them.
-- ---------------------------------------------------------------------

-- 5. The declared unique. Name and form are exactly what Prisma emits for
--    `name String @unique` (target-ddl.sql:711): a UNIQUE INDEX called
--    Table_column_key, not a UNIQUE CONSTRAINT.
CREATE UNIQUE INDEX IF NOT EXISTS "Skill_name_key" ON "Skill" ("name");

-- 6. The functional unique. Not expressible in the Prisma schema, so
--    `prisma migrate diff` will forever propose exactly one statement,
--    DROP INDEX "Skill_name_lower_key", which must never be applied, and
--    `prisma db push` will actually drop it -- re-run this one statement
--    if anyone ever pushes. lower(text) is IMMUTABLE, no extension needed.
CREATE UNIQUE INDEX IF NOT EXISTS "Skill_name_lower_key" ON "Skill" (lower("name"));


-- ---------------------------------------------------------------------
-- PART C. The explicit join tables.
-- Constraints are declared INLINE rather than as ALTER TABLE ... ADD
-- CONSTRAINT because ADD CONSTRAINT has no IF NOT EXISTS and would abort
-- the transaction on a re-run. The resulting pg_constraint rows are
-- identical either way, so `prisma migrate diff` stays quiet.
-- v1 after statements 7-9: unaffected. It has no model for either table,
-- never selects from them, never inserts into them; the CASCADE FKs only
-- make v1's existing parent deletes also clear the mirror.
-- ---------------------------------------------------------------------

-- 7.
CREATE TABLE IF NOT EXISTS "ExperienceSkill" (
    "experienceId" TEXT NOT NULL,
    "skillId"      TEXT NOT NULL,
    "sortOrder"    INTEGER NOT NULL,

    CONSTRAINT "ExperienceSkill_pkey" PRIMARY KEY ("experienceId", "skillId"),
    CONSTRAINT "ExperienceSkill_experienceId_fkey" FOREIGN KEY ("experienceId")
        REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceSkill_skillId_fkey" FOREIGN KEY ("skillId")
        REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 8.
CREATE TABLE IF NOT EXISTS "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId"   TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("projectId", "skillId"),
    CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId")
        REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 9. The four declared indexes. The two ordered ones serve the v2 read
--    path (apps/web/app/lib/data.ts:172 and :222-225, orderBy sortOrder asc); the
--    two skillId ones are carried over from the implicit "_B_index" for
--    the cascade delete, not for any reader. No index on the leading PK
--    column alone: the PK btree already serves a parent-prefix lookup and
--    an extra one would itself read as drift.
CREATE INDEX IF NOT EXISTS "ExperienceSkill_experienceId_sortOrder_idx"
    ON "ExperienceSkill" ("experienceId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ExperienceSkill_skillId_idx"
    ON "ExperienceSkill" ("skillId");
CREATE INDEX IF NOT EXISTS "ProjectSkill_projectId_sortOrder_idx"
    ON "ProjectSkill" ("projectId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ProjectSkill_skillId_idx"
    ON "ProjectSkill" ("skillId");


-- ---------------------------------------------------------------------
-- PART D. Backfill the pairs and invent a deterministic sortOrder.
--
-- There is no order to preserve. The implicit table has two columns, and
-- no v1 read passes an orderBy (data.ts:192, data.ts:243 in HEAD), so the
-- chip order a visitor sees today is whatever the planner returned. This
-- invents one: the skill's own grid order, then name, 0-based.
--
-- 0-based, not 1-based, because that is what the v2 writer produces:
--   apps/docs/app/lib/actions/experiences.ts:56-58, 87-89
--     data.skillIds.map((skillId, sortOrder) => ({ skillId, sortOrder }))
--   apps/docs/app/lib/actions/projects.ts:51-53, 99-101  -- same shape
-- If the code half ever lands 1-based, this backfill is off by one.
--
-- Skill."name" is the tie-break because it is UNIQUE (statement 5) and
-- has no lower() duplicates (data-facts.txt), so the key is total inside
-- every partition and a re-run is byte-identical.
-- Runs BEFORE the mirror triggers exist, so it fires nothing. Both are in
-- the same transaction, so there is no instant at which the mirror is
-- backfilled but unguarded.
-- ---------------------------------------------------------------------

-- 10. expected: 17 rows inserted
INSERT INTO "ExperienceSkill" ("experienceId", "skillId", "sortOrder")
SELECT j."A",
       j."B",
       (row_number() OVER (PARTITION BY j."A" ORDER BY s."sortOrder" ASC, s."name" ASC))::int - 1
  FROM "_ExperienceToSkill" j
  JOIN "Skill" s ON s."id" = j."B"
ON CONFLICT ("experienceId", "skillId") DO NOTHING;

-- 11. expected: 38 rows inserted
INSERT INTO "ProjectSkill" ("projectId", "skillId", "sortOrder")
SELECT j."A",
       j."B",
       (row_number() OVER (PARTITION BY j."A" ORDER BY s."sortOrder" ASC, s."name" ASC))::int - 1
  FROM "_ProjectToSkill" j
  JOIN "Skill" s ON s."id" = j."B"
ON CONFLICT ("projectId", "skillId") DO NOTHING;


-- ---------------------------------------------------------------------
-- PART E. The mirrors. These are what make the window survivable.
--
-- Forward  (implicit -> explicit) : covers every v1 write in the window.
-- Reverse  (explicit -> implicit) : covers every v2 write after the
--                                   deploy, which is what lets you roll
--                                   the deployment back.
--
-- WHY THE PAIR DOES NOT LOOP. Both inserts are ON CONFLICT DO NOTHING and
-- both deletes are keyed. Postgres fires an AFTER ROW trigger only for
-- rows it actually wrote, and ON CONFLICT DO NOTHING that does nothing
-- writes no row. So: implicit INSERT -> forward inserts explicit ->
-- reverse tries to insert implicit -> conflicts -> 0 rows -> no further
-- trigger. Two hops, then it stops. DELETE is symmetric: the second hop's
-- DELETE matches 0 rows because the first hop already removed it.
--
-- WHY `UPDATE OF <key cols>` AND THE NO-OP GUARD. Without them, a
-- sortOrder-only UPDATE of "ExperienceSkill" would fire the reverse
-- trigger, whose DELETE-then-INSERT on the implicit table would fire the
-- forward trigger, whose DELETE would remove the very row that was just
-- updated. Scoping the reverse trigger to the key columns, plus the
-- explicit key-unchanged early return, makes that unreachable.
--
-- v1 after statements 12-15: unaffected in what it observes. Its
-- connect/set writes still land in "_ExperienceToSkill" / "_ProjectToSkill"
-- with exactly the rows it asked for; the triggers only add writes to two
-- tables v1 cannot see.
--
-- sortOrder assigned by the forward mirror: max+1 within the parent,
-- starting at 0. Prisma's implicit-m2m `set` issues the DELETEs before
-- the INSERTs inside one transaction, and AFTER ROW triggers fire in row
-- order at end of statement, so a full replace produces 0,1,2,... in the
-- order data.skillIds arrived -- which is precisely what v2 would have
-- written. If Prisma instead diffs the set (removing only what changed),
-- surviving rows keep their old sortOrder and additions land at the end.
-- That is still a valid strictly-increasing order; it is merely no longer
-- gapless, which no reader cares about (both v2 reads are a bare
-- `orderBy: { sortOrder: "asc" }`). Verification V6 below is therefore a
-- pre-window baseline, not a post-window invariant.
-- ---------------------------------------------------------------------

-- 12.
CREATE OR REPLACE FUNCTION "experience_skill_mirror_fwd"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "ExperienceSkill"
     WHERE "experienceId" = OLD."A" AND "skillId" = OLD."B";
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."A" = OLD."A" AND NEW."B" = OLD."B" THEN RETURN NEW; END IF;
    DELETE FROM "ExperienceSkill"
     WHERE "experienceId" = OLD."A" AND "skillId" = OLD."B";
  END IF;

  INSERT INTO "ExperienceSkill" ("experienceId", "skillId", "sortOrder")
  SELECT NEW."A", NEW."B",
         COALESCE((SELECT max("sortOrder") + 1 FROM "ExperienceSkill"
                    WHERE "experienceId" = NEW."A"), 0)
  ON CONFLICT ("experienceId", "skillId") DO NOTHING;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "experience_skill_mirror_fwd_trg"
  AFTER INSERT OR DELETE OR UPDATE OF "A", "B" ON "_ExperienceToSkill"
  FOR EACH ROW EXECUTE FUNCTION "experience_skill_mirror_fwd"();

-- 13.
CREATE OR REPLACE FUNCTION "project_skill_mirror_fwd"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "ProjectSkill"
     WHERE "projectId" = OLD."A" AND "skillId" = OLD."B";
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."A" = OLD."A" AND NEW."B" = OLD."B" THEN RETURN NEW; END IF;
    DELETE FROM "ProjectSkill"
     WHERE "projectId" = OLD."A" AND "skillId" = OLD."B";
  END IF;

  INSERT INTO "ProjectSkill" ("projectId", "skillId", "sortOrder")
  SELECT NEW."A", NEW."B",
         COALESCE((SELECT max("sortOrder") + 1 FROM "ProjectSkill"
                    WHERE "projectId" = NEW."A"), 0)
  ON CONFLICT ("projectId", "skillId") DO NOTHING;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "project_skill_mirror_fwd_trg"
  AFTER INSERT OR DELETE OR UPDATE OF "A", "B" ON "_ProjectToSkill"
  FOR EACH ROW EXECUTE FUNCTION "project_skill_mirror_fwd"();

-- 14.
CREATE OR REPLACE FUNCTION "experience_skill_mirror_rev"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "_ExperienceToSkill"
     WHERE "A" = OLD."experienceId" AND "B" = OLD."skillId";
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."experienceId" = OLD."experienceId" AND NEW."skillId" = OLD."skillId" THEN
      RETURN NEW;                  -- sortOrder-only edit: nothing to mirror
    END IF;
    DELETE FROM "_ExperienceToSkill"
     WHERE "A" = OLD."experienceId" AND "B" = OLD."skillId";
  END IF;

  INSERT INTO "_ExperienceToSkill" ("A", "B")
  VALUES (NEW."experienceId", NEW."skillId")
  ON CONFLICT ("A", "B") DO NOTHING;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "experience_skill_mirror_rev_trg"
  AFTER INSERT OR DELETE OR UPDATE OF "experienceId", "skillId" ON "ExperienceSkill"
  FOR EACH ROW EXECUTE FUNCTION "experience_skill_mirror_rev"();

-- 15.
CREATE OR REPLACE FUNCTION "project_skill_mirror_rev"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "_ProjectToSkill"
     WHERE "A" = OLD."projectId" AND "B" = OLD."skillId";
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."projectId" = OLD."projectId" AND NEW."skillId" = OLD."skillId" THEN
      RETURN NEW;
    END IF;
    DELETE FROM "_ProjectToSkill"
     WHERE "A" = OLD."projectId" AND "B" = OLD."skillId";
  END IF;

  INSERT INTO "_ProjectToSkill" ("A", "B")
  VALUES (NEW."projectId", NEW."skillId")
  ON CONFLICT ("A", "B") DO NOTHING;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "project_skill_mirror_rev_trg"
  AFTER INSERT OR DELETE OR UPDATE OF "projectId", "skillId" ON "ProjectSkill"
  FOR EACH ROW EXECUTE FUNCTION "project_skill_mirror_rev"();


-- ---------------------------------------------------------------------
-- 16. GUARD. Raise rather than commit a half-migrated cluster.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "Skill" WHERE "show" <> "showInGrid";
  IF bad > 0 THEN
    RAISE EXCEPTION 'expand: % Skill rows where show <> showInGrid after backfill', bad;
  END IF;

  SELECT count(*) INTO bad FROM (
    (SELECT "A","B" FROM "_ExperienceToSkill" EXCEPT SELECT "experienceId","skillId" FROM "ExperienceSkill")
    UNION ALL
    (SELECT "experienceId","skillId" FROM "ExperienceSkill" EXCEPT SELECT "A","B" FROM "_ExperienceToSkill")
    UNION ALL
    (SELECT "A","B" FROM "_ProjectToSkill" EXCEPT SELECT "projectId","skillId" FROM "ProjectSkill")
    UNION ALL
    (SELECT "projectId","skillId" FROM "ProjectSkill" EXCEPT SELECT "A","B" FROM "_ProjectToSkill")
  ) d;
  IF bad > 0 THEN
    RAISE EXCEPTION 'expand: % pair(s) differ between the implicit and explicit skill joins', bad;
  END IF;

  RAISE NOTICE 'expand guard ok';
END
$$;


-- ---------------------------------------------------------------------
-- VERIFICATION. Read these BEFORE you COMMIT.
-- ---------------------------------------------------------------------

-- V1. Both Skill columns exist, agree, and carry the right shape.
--     expected 1 row: 47 | 45 | 2 | {React.js,WebSocket} | 0
SELECT count(*)                                                        AS total,
       count(*) FILTER (WHERE "showInGrid")                            AS in_grid,
       count(*) FILTER (WHERE NOT "showInGrid")                        AS hidden,
       array_agg("name" ORDER BY "name") FILTER (WHERE NOT "showInGrid") AS hidden_names,
       count(*) FILTER (WHERE "show" <> "showInGrid")                  AS disagreeing
  FROM "Skill";

-- V2. Column shape. "showInGrid" must be boolean, NOT NULL, DEFAULT true
--     -- the default is what keeps v1's tx.skill.create() working.
--     expected 2 rows:
--       show       | boolean | NO | true
--       showInGrid | boolean | NO | true
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'Skill'
   AND column_name IN ('show','showInGrid')
 ORDER BY column_name;

-- V3. Skill indexes. expected exactly 3 rows, all UNIQUE/valid/ready:
--       Skill_name_key | Skill_name_lower_key | Skill_pkey
SELECT c.relname AS index, i.indisunique, i.indisvalid, i.indisready
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indrelid = '"Skill"'::regclass
 ORDER BY c.relname;

-- V4. Row counts on both sides. expected: 17 | 17 | 38 | 38
SELECT (SELECT count(*) FROM "_ExperienceToSkill") AS implicit_experience,
       (SELECT count(*) FROM "ExperienceSkill")    AS explicit_experience,
       (SELECT count(*) FROM "_ProjectToSkill")    AS implicit_project,
       (SELECT count(*) FROM "ProjectSkill")       AS explicit_project;

-- V5. Both implicit tables are still here. This is the whole point of
--     EXPAND: v1's public site reads them at data.ts:192 and data.ts:243.
--     expected: t | t
SELECT to_regclass('public."_ExperienceToSkill"') IS NOT NULL AS implicit_experience_kept,
       to_regclass('public."_ProjectToSkill"')    IS NOT NULL AS implicit_project_kept;

-- V6. sortOrder is dense and 0-based inside every parent, right now.
--     expected: 0 rows. (A v1 admin save later in the window may open a
--     gap via the mirror's max+1; that is acceptable and not a failure --
--     see PART E.)
SELECT 'ExperienceSkill' AS tbl, "experienceId" AS parent, count(*) AS chips,
       min("sortOrder") AS lo, max("sortOrder") AS hi, count(DISTINCT "sortOrder") AS distinct_order
  FROM "ExperienceSkill" GROUP BY 1,2
HAVING min("sortOrder") <> 0 OR max("sortOrder") <> count(*)-1 OR count(DISTINCT "sortOrder") <> count(*)
UNION ALL
SELECT 'ProjectSkill', "projectId", count(*), min("sortOrder"), max("sortOrder"), count(DISTINCT "sortOrder")
  FROM "ProjectSkill" GROUP BY 1,2
HAVING min("sortOrder") <> 0 OR max("sortOrder") <> count(*)-1 OR count(DISTINCT "sortOrder") <> count(*);

-- V7. Constraints, so `prisma migrate diff` stays empty. expected 6 rows:
--       ExperienceSkill_pkey / _experienceId_fkey / _skillId_fkey
--       ProjectSkill_pkey    / _projectId_fkey    / _skillId_fkey
--     with ON UPDATE CASCADE ON DELETE CASCADE on all four FKs.
SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
 WHERE t.relname IN ('ExperienceSkill','ProjectSkill')
 ORDER BY t.relname, c.conname;

-- V8. Indexes on the new tables. expected 6 rows:
--       ExperienceSkill_experienceId_sortOrder_idx, ExperienceSkill_pkey,
--       ExperienceSkill_skillId_idx, ProjectSkill_pkey,
--       ProjectSkill_projectId_sortOrder_idx, ProjectSkill_skillId_idx
SELECT tablename, indexname FROM pg_indexes
 WHERE schemaname = current_schema() AND tablename IN ('ExperienceSkill','ProjectSkill')
 ORDER BY tablename, indexname;

-- V9. All five triggers are in place and enabled ('O' = fires normally).
--     expected 5 rows:
--       ExperienceSkill    | experience_skill_mirror_rev_trg | O
--       ProjectSkill       | project_skill_mirror_rev_trg    | O
--       Skill              | skill_show_sync                 | O
--       _ExperienceToSkill | experience_skill_mirror_fwd_trg | O
--       _ProjectToSkill    | project_skill_mirror_fwd_trg    | O
SELECT t.relname AS table_name, g.tgname, g.tgenabled
  FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid
 WHERE NOT g.tgisinternal
   AND t.relname IN ('Skill','_ExperienceToSkill','_ProjectToSkill','ExperienceSkill','ProjectSkill')
 ORDER BY t.relname, g.tgname;

-- V10. Eyeball the frozen chip order. expected 55 rows, ascending within
--      each parent, skill names in grid order then alphabetical.
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

COMMIT;


-- =====================================================================
-- AFTER COMMIT, BEFORE THE DEPLOY: smoke the v1 site, which is still the
-- deployed code. All of these must behave exactly as they did before.
--   1. GET https://www.yatindora.in/  -> 200, #skills shows 45 chips,
--      each experience and project card shows its chip list.
--   2. Force a regeneration rather than trusting the 24h ISR cache:
--      POST /api/revalidate with REVALIDATE_SECRET, then reload. This is
--      the step that would have exposed a broken getSkills().
--   3. In the admin: /skills renders, the eye toggle stages, Save works.
--      /dashboard shows "45 skills visible / 2 hidden".
--   4. In the admin: open an experience, save it WITHOUT changing the
--      chips, then re-run V4 and V16's pair guard. Both sides must still
--      agree -- that is the mirror trigger doing its job.
-- If any of that fails, run the ROLLBACK block in
-- /tmp/v2/prod/skills-joins-contract.sql section R. It is lossless.
-- =====================================================================
