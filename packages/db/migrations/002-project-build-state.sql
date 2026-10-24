-- ============================================================================
-- PROJECT BUILD STATE. Additive, idempotent, re-runnable.
--
-- "buildState" is a property of the row's subject; "status" is whether a
-- visitor can reach the row at all. A BUILDING project needs to be PUBLISHED
-- for the feature to mean anything, so this is a new column rather than two
-- more "ContentStatus" members.
--
-- "ProjectMilestone" holds the named surfaces the blueprint cover draws: the
-- first three rows by "sortOrder" fill the three panes, left to right. The
-- writer only issues an UPDATE when a value has actually moved, because the
-- admin reads "updatedAt" for "billing: doing for 71 days".
--
-- Nothing here drops, renames or narrows an existing object, so the currently
-- deployed code keeps working against it and this composes with the pending
-- v2-production/*-contract.sql files rather than racing them. "Project" still
-- carries the undropped "images" column, so the verification block below does
-- not assert a total column count on it.
--
--   psql "$PGPROD" -v ON_ERROR_STOP=1 -f migrations/002-project-build-state.sql
-- ============================================================================

SET lock_timeout = '3s';
SET statement_timeout = '30s';

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_type" t
          JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
         WHERE t."typname" = 'BuildState' AND n."nspname" = current_schema()
    ) THEN
        CREATE TYPE "BuildState" AS ENUM ('SHIPPED', 'BUILDING', 'PAUSED');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "pg_type" t
          JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
         WHERE t."typname" = 'MilestoneState' AND n."nspname" = current_schema()
    ) THEN
        CREATE TYPE "MilestoneState" AS ENUM ('DONE', 'DOING', 'NEXT');
    END IF;
END
$$;

ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "buildState" "BuildState" NOT NULL DEFAULT 'SHIPPED';

ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "buildVersion" TEXT;

ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "etaLabel" TEXT;

CREATE INDEX IF NOT EXISTS "Project_buildState_idx"
    ON "Project" ("buildState");

CREATE TABLE IF NOT EXISTS "ProjectMilestone" (
    "id"        TEXT             NOT NULL,
    "projectId" TEXT             NOT NULL,
    "label"     TEXT             NOT NULL,
    "state"     "MilestoneState" NOT NULL DEFAULT 'NEXT',
    "sortOrder" INTEGER          NOT NULL,
    "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- no default: Prisma's @updatedAt writes it, and a server-side default
    -- would let a direct INSERT invent a freshness date
    "updatedAt" TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id"),

    -- a blank label draws an empty box, which reads as a bug rather than as an
    -- unnamed surface
    CONSTRAINT "ProjectMilestone_label_check"
        CHECK (btrim("label") <> ''),

    CONSTRAINT "ProjectMilestone_sortOrder_nonneg_check"
        CHECK ("sortOrder" >= 0)
);

CREATE INDEX IF NOT EXISTS "ProjectMilestone_projectId_sortOrder_idx"
    ON "ProjectMilestone" ("projectId", "sortOrder");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
         WHERE "conname" = 'ProjectMilestone_projectId_fkey'
           AND "conrelid" = '"ProjectMilestone"'::regclass
    ) THEN
        ALTER TABLE "ProjectMilestone"
            ADD CONSTRAINT "ProjectMilestone_projectId_fkey"
            FOREIGN KEY ("projectId") REFERENCES "Project"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
DECLARE
    "newcols" INTEGER;
    "cols"    INTEGER;
    "idx"     INTEGER;
    "fks"     INTEGER;
    "states"  TEXT;
    "stones"  TEXT;
BEGIN
    SELECT count(*) INTO "newcols" FROM "information_schema"."columns"
     WHERE "table_schema" = 'public' AND "table_name" = 'Project'
       AND "column_name" IN ('buildState', 'buildVersion', 'etaLabel');

    SELECT count(*) INTO "cols" FROM "information_schema"."columns"
     WHERE "table_schema" = 'public' AND "table_name" = 'ProjectMilestone';

    SELECT count(*) INTO "idx" FROM "pg_indexes"
     WHERE "schemaname" = 'public' AND "tablename" = 'ProjectMilestone';

    SELECT count(*) INTO "fks" FROM "pg_constraint"
     WHERE "conrelid" = '"ProjectMilestone"'::regclass AND "contype" = 'f';

    -- declaration order is the sort order, so assert the sequence, not the set
    SELECT string_agg("enumlabel", ',' ORDER BY "enumsortorder") INTO "states"
      FROM "pg_enum" WHERE "enumtypid" = '"BuildState"'::regtype;

    SELECT string_agg("enumlabel", ',' ORDER BY "enumsortorder") INTO "stones"
      FROM "pg_enum" WHERE "enumtypid" = '"MilestoneState"'::regtype;

    IF "newcols" <> 3 THEN
        RAISE EXCEPTION 'Project gained % of the 3 build columns', "newcols";
    END IF;
    IF "cols" <> 7 THEN
        RAISE EXCEPTION 'ProjectMilestone has % columns, expected 7', "cols";
    END IF;
    IF "idx" < 2 THEN
        RAISE EXCEPTION 'ProjectMilestone has % indexes, expected at least 2', "idx";
    END IF;
    IF "fks" <> 1 THEN
        RAISE EXCEPTION 'ProjectMilestone has % foreign keys, expected 1', "fks";
    END IF;
    IF "states" <> 'SHIPPED,BUILDING,PAUSED' THEN
        RAISE EXCEPTION 'BuildState reads %, expected SHIPPED,BUILDING,PAUSED', "states";
    END IF;
    IF "stones" <> 'DONE,DOING,NEXT' THEN
        RAISE EXCEPTION 'MilestoneState reads %, expected DONE,DOING,NEXT', "stones";
    END IF;

    RAISE NOTICE 'project-build-state verified: % Project columns, ProjectMilestone with % columns, % indexes, % foreign key',
        "newcols", "cols", "idx", "fks";
END
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK. Lossless only while no project has left SHIPPED; past that the
-- milestone rows and the states are the data, so take a dump first.
--
--   BEGIN;
--   DROP TABLE IF EXISTS "ProjectMilestone";
--   DROP INDEX IF EXISTS "Project_buildState_idx";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "etaLabel";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "buildVersion";
--   ALTER TABLE "Project" DROP COLUMN IF EXISTS "buildState";
--   DROP TYPE IF EXISTS "MilestoneState";
--   DROP TYPE IF EXISTS "BuildState";
--   COMMIT;
-- ============================================================================
