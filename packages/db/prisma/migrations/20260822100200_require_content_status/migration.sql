-- Step 3 of 3: require the lifecycle column now that every row has one.
--
-- Safe only because step 2 ran and was checked: Blog 10 DRAFT / 0 PUBLISHED
-- (matching the 0 rows that had show = true), Project 6 PUBLISHED, zero NULLs
-- in either table. SET NOT NULL re-scans and would fail loudly on a row the
-- backfill missed, which is the point of doing it as its own statement.
--
-- The default is DRAFT and not PUBLISHED, and that is the whole safety
-- property: a row inserted by a seed, a bulk import or a future migration that
-- does not know about this column is invisible until somebody says otherwise.
-- The boolean this replaces defaulted to visible, which is the opposite bet and
-- the reason an unfinished post could ever have reached the site by accident.

ALTER TABLE "Blog"    ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Blog"    ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "Project" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
