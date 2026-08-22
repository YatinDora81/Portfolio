-- Step 3 of 3: require the lifecycle column now that step 2 has filled it.
-- Not additive — SET NOT NULL re-scans and fails loudly on any row the backfill
-- missed. The default is DRAFT, so an insert that ignores the column is hidden.

ALTER TABLE "Blog"    ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Blog"    ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "Project" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
