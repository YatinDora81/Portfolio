-- Step 2 of 3: fill the lifecycle columns from what the rows already say.
--
-- Guarded on "status" IS NULL throughout, so re-running is a no-op rather than
-- a re-classification: once an admin has moved a post to ARCHIVED, this must
-- never drag it back to whatever the old boolean happens to still say.
--
-- Recorded before applying, so the result can be checked rather than trusted:
--   Blog     10 rows — show = true: 0, show = false: 10
--   Project   6 rows — no visibility column existed; every row was public
-- Therefore this must produce Blog 10 DRAFT / 0 PUBLISHED, and Project 6
-- PUBLISHED. Any other numbers mean something is wrong — stop and look.

-- Blog: the old boolean is the whole answer. show = true was live, so it is
-- PUBLISHED; everything else was hidden, and hidden means DRAFT.
UPDATE "Blog"
SET "status" = CASE WHEN "show" = true THEN 'PUBLISHED'::"ContentStatus"
                    ELSE 'DRAFT'::"ContentStatus" END
WHERE "status" IS NULL;

-- Project had no flag, and every row was reaching visitors. Anything other than
-- PUBLISHED here would silently take the entire projects section off the live
-- site the moment the reading code starts filtering on status.
UPDATE "Project"
SET "status" = 'PUBLISHED'::"ContentStatus"
WHERE "status" IS NULL;

-- A PUBLISHED row needs a publishedAt, because that is half of the visibility
-- predicate ("PUBLISHED and publishedAt <= now"). A published project with a
-- NULL one would fail that test and vanish.
--
-- Project has no creation timestamp to borrow, so the migration's own clock is
-- the honest answer: these went live at some unrecorded point in the past, and
-- now() is the only defensible stand-in that keeps them <= now.
UPDATE "Project"
SET "publishedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;

-- Blog's publishedAt is NOT NULL DEFAULT now() and every row already carries a
-- real date, so there is deliberately no equivalent statement for it. Writing
-- one would overwrite editorial dates going back to March.
