-- Company / project marks, previously hardcoded in the web app.
-- Nullable and additive: existing rows keep working and simply render no mark
-- until a URL is set from the admin dashboard.
ALTER TABLE "Experience" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN "logoUrl" TEXT;
