-- A named mutex in Postgres, for work that must run exactly once. Purely
-- additive — one new table, nothing existing is touched — so it can be applied
-- ahead of the code deploy and rolled back by dropping the table again.
CREATE TABLE "JobLock" (
  "key"      TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL,
  "lockedBy" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JobLock_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "JobLock_expiresAt_idx" ON "JobLock" ("expiresAt");
