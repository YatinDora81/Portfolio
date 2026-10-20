-- =====================================================================
-- PROJECTS RESYNC. Extracted from projects-expand.sql STAGE E-FINAL.
--
-- Run in its OWN transaction immediately before you push the v2 code,
-- and again if the deploy is delayed (RUNBOOK Step 28).
--
-- With the triggers from projects-expand.sql STAGE 10 armed this should
-- be a no-op, and that is exactly why it is worth running: if it changes
-- anything, a v1 write got past the triggers and you want to know before
-- the deploy, not after. The guard refuses to run once v2 has written an
-- assetId row, so it cannot destroy v2 data if you run it a day late by
-- mistake.
--
-- Expected: DELETE 6 / INSERT 0 6, and gallery_rows = array_elements.
-- =====================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "ProjectImage" WHERE "assetId" IS NOT NULL) THEN
        RAISE EXCEPTION 'ProjectImage holds assetId rows - v2 is already writing here; do NOT resync from Project.images';
    END IF;
END
$$;

DELETE FROM "ProjectImage";

INSERT INTO "ProjectImage" ("id", "projectId", "assetId", "externalUrl", "sortOrder")
SELECT gen_random_uuid()::text, p."id", NULL::text, g."img", (g."ord" - 1)::int
  FROM "Project" p
  CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) WITH ORDINALITY AS g("img", "ord")
 WHERE g."img" IS NOT NULL AND btrim(g."img") <> '';

INSERT INTO "_v2_backup_project_images" ("projectId", "images")
SELECT "id", "images" FROM "Project"
ON CONFLICT ("projectId") DO UPDATE
   SET "images" = EXCLUDED."images", "capturedAt" = now();

SELECT (SELECT count(*) FROM "ProjectImage")                                    AS gallery_rows,
       (SELECT count(*) FROM "Project" p
          CROSS JOIN LATERAL unnest(COALESCE(p."images", '{}'::text[])) x)       AS array_elements;

COMMIT;
