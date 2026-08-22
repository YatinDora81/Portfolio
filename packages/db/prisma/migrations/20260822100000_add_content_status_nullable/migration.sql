-- Step 1 of 3: add the lifecycle as NULLABLE columns. Nothing is backfilled
-- here and nothing existing is dropped, so this is safe to apply ahead of the
-- code deploy and safe to roll back by dropping the columns again.
--
-- Three migrations rather than one because adding a REQUIRED column to a table
-- that already has rows fails outright: Postgres has no value to put in the
-- existing ones. So: add it nullable (here), fill it (step 2), then require it
-- (step 3). At no point is there a row the schema cannot describe.
--
-- "show" stays. Reading it stops in this deploy; dropping it is a separate
-- change once production has run a week on "status" alone, because a column
-- dropped is a rollback that no longer exists.

CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- Blog already has "publishedAt" — the date the article prints — and it is NOT
-- the same question as "is this live". It keeps its editorial meaning; only
-- "status" and the scheduled time are new here.
ALTER TABLE "Blog"
  ADD COLUMN "status"    "ContentStatus",
  ADD COLUMN "publishAt" TIMESTAMP(3);

-- Project had no visibility column at all: every row was public from the moment
-- it was inserted. It needs the whole set.
ALTER TABLE "Project"
  ADD COLUMN "status"      "ContentStatus",
  ADD COLUMN "publishAt"   TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Added with the lifecycle because the stale detector needs something to
-- compare against, and a project had no edit timestamp. DEFAULT only so the six
-- existing rows have a value; dropped immediately after, since Prisma's
-- @updatedAt writes it from the client and a lingering DB default would show up
-- as schema drift.
ALTER TABLE "Project" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Project" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "Blog_status_publishAt_idx"      ON "Blog"    ("status", "publishAt");
CREATE INDEX "Blog_status_publishedAt_idx"    ON "Blog"    ("status", "publishedAt");
CREATE INDEX "Project_status_publishAt_idx"   ON "Project" ("status", "publishAt");
CREATE INDEX "Project_status_publishedAt_idx" ON "Project" ("status", "publishedAt");
