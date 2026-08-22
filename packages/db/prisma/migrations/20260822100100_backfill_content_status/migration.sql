-- Step 2 of 3: fill the lifecycle columns from what the rows already say.
-- Guarded on "status" IS NULL throughout, so re-running is a no-op rather than
-- a re-classification. Expected result: Blog 10 DRAFT, Project 6 PUBLISHED.

UPDATE "Blog"
SET "status" = CASE WHEN "show" = true THEN 'PUBLISHED'::"ContentStatus"
                    ELSE 'DRAFT'::"ContentStatus" END
WHERE "status" IS NULL;

-- Project had no visibility column; every row was already reaching visitors.
UPDATE "Project"
SET "status" = 'PUBLISHED'::"ContentStatus"
WHERE "status" IS NULL;

-- A NULL publishedAt fails the "PUBLISHED and publishedAt <= now" visibility test.
UPDATE "Project"
SET "publishedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;
