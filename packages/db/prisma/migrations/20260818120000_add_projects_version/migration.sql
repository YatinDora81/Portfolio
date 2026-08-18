-- The projects section now has two layouts — v1 the work ledger, v2 the build
-- log — and this row is the switch that says which one visitors get. Unlike the
-- hero, neither layout owns any rows of its own: both render the same Project
-- records, so there is nothing to tag and no schema change to make. SiteConfig
-- is already a plain key/value table.
--
-- The reading code treats anything that is not 'v1' as 'v2', missing row
-- included, so this seeds the default rather than enabling it. And because no
-- deployed code reads 'projectsVersion' yet, applying this migration ahead of
-- the code deploy changes nothing a visitor can see.
INSERT INTO "SiteConfig" ("id", "key", "value")
VALUES (gen_random_uuid()::text, 'projectsVersion', 'v2')
ON CONFLICT ("key") DO NOTHING;
