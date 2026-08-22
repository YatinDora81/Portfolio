-- Step 1 of 3: add the lifecycle as NULLABLE columns. Nothing is backfilled
-- here and nothing existing is dropped, so this is safe to apply ahead of the
-- code deploy and safe to roll back by dropping the columns again. Split into
-- three because a REQUIRED column cannot be added to a table that has rows.

CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "Blog"
  ADD COLUMN "status"    "ContentStatus",
  ADD COLUMN "publishAt" TIMESTAMP(3);

ALTER TABLE "Project"
  ADD COLUMN "status"      "ContentStatus",
  ADD COLUMN "publishAt"   TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- DEFAULT only so existing rows get a value; Prisma's @updatedAt writes it client-side.
ALTER TABLE "Project" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Project" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "Blog_status_publishAt_idx"      ON "Blog"    ("status", "publishAt");
CREATE INDEX "Blog_status_publishedAt_idx"    ON "Blog"    ("status", "publishedAt");
CREATE INDEX "Project_status_publishAt_idx"   ON "Project" ("status", "publishAt");
CREATE INDEX "Project_status_publishedAt_idx" ON "Project" ("status", "publishedAt");
