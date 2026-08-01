-- Durable storage for the contact section's contribution graph. The upstream
-- mirror (github-contributions-api.jogruber.de) is an unauthenticated hobby
-- service with no SLA, and it serves only a TRAILING 365 days — so these tables
-- are both the outage fallback and the only place history older than that window
-- will ever exist. A day not captured before it scrolls out is unrecoverable.
--
-- Shape: one row per calendar year holding one character per day, keyed to Jan 1
-- rather than to the fetch window. A trailing year slides one day every day, so an
-- offset stored against it drifts; a calendar year does not move, which reduces
-- every merge to "write the character at this day-of-year".
--
-- Raw per-day COUNTS are stored, never the API's `level`. That level is quantile
-- derived over the API's own sliding window, so the same day reports 3 one month
-- and 2 the next — it is a presentation artifact, not a property of the day.
-- Levels, streaks and totals are all recomputed from counts at read time.
--
-- Purely additive: nothing existing is touched, so this can be applied ahead of
-- the code deploy, and rolling back is dropping two tables.

CREATE TABLE "GithubProfile" (
  "id"        TEXT NOT NULL,
  "handle"    TEXT NOT NULL,
  "total"     INTEGER NOT NULL DEFAULT 0,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GithubProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GithubYear" (
  "id"     TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "year"   INTEGER NOT NULL,
  "days"   TEXT NOT NULL,
  "spikes" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "GithubYear_pkey" PRIMARY KEY ("id")
);

-- The length IS the calendar. A row that is not 365 or 366 characters cannot be
-- indexed by day-of-year at all, so the database refuses it outright rather than
-- letting a truncated write corrupt the archive somewhere nobody looks.
ALTER TABLE "GithubYear" ADD CONSTRAINT "GithubYear_days_length_check"
  CHECK (length("days") IN (365, 366));

-- GitHub launched in 2008; the floor is loose enough not to argue with an import
-- and tight enough to catch a date parsed into nonsense.
ALTER TABLE "GithubYear" ADD CONSTRAINT "GithubYear_year_check"
  CHECK ("year" BETWEEN 2005 AND 2200);

-- One profile per account, one row per account-year. Both uniques are the real
-- constraint the refresh upserts against, not merely an access path.
CREATE UNIQUE INDEX "GithubProfile_handle_key"   ON "GithubProfile"("handle");
CREATE UNIQUE INDEX "GithubYear_handle_year_key" ON "GithubYear"("handle", "year");
