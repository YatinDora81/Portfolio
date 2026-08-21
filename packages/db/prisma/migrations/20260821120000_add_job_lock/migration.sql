-- A named mutex in Postgres. Purely additive — one new table, nothing existing
-- is touched — so it can be applied ahead of the code deploy and rolled back by
-- dropping the table again.
--
-- It exists because there is no cron in this project and there is not going to
-- be one: scheduled work runs off whichever request happens to arrive after it
-- came due, which means several requests can arrive at once and every one of
-- them thinks the work is its to do. Acquiring is a single conditional
-- UPDATE ... WHERE "expiresAt" < now, so Postgres picks the winner and the
-- losers match zero rows.
--
-- "expiresAt" rather than a plain held/free flag: a serverless invocation that
-- dies mid-work never runs its release, and a lock with no expiry would then be
-- held by nobody, forever, with no way to tell that from held-and-working.
CREATE TABLE "JobLock" (
  "key"      TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL,

  -- Random per acquisition. Release is guarded on it so a caller whose lock has
  -- already expired and been stolen cannot release the new holder's lock on its
  -- way out — the failure that would turn this table into a source of the
  -- corruption it was added to prevent.
  "lockedBy" TEXT NOT NULL,

  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobLock_pkey" PRIMARY KEY ("key")
);

-- Sweeping expired rows is the only query that does not already know its key.
CREATE INDEX "JobLock_expiresAt_idx" ON "JobLock" ("expiresAt");
