-- =============================================================================
-- cluster 80-notes-github
-- target: the Neon child branch (copy-on-write clone of production, no traffic)
-- Postgres 17, role is the database owner and NOT a superuser.
--
-- Covers schema-v2.md ordered steps 20 (GithubYear's foreign key) and 27
-- (declare the two notes indexes under their existing names, add the three
-- notes CHECKs).
-- =============================================================================
--
-- WHAT THIS CLUSTER DOES
--
--   1. NoteNode_path_prefix_idx and NoteAnswer_tags_idx: reconcile names only.
--      Both indexes already exist. They were created by
--      packages/db/prisma/migrations/20260803120000_add_notes/migration.sql:78
--      and :81 as raw SQL that Prisma's datamodel did not know about, and
--      /tmp/v2/data-facts.txt:191 confirms 20260803120000_add_notes is in
--      _prisma_migrations, so the branch carries them.
--
--      Old DDL (migration 20260803120000, verbatim):
--        CREATE INDEX "NoteNode_path_prefix_idx" ON "NoteNode" ("path" text_pattern_ops);
--        CREATE INDEX "NoteAnswer_tags_idx" ON "NoteAnswer" USING GIN ("tags");
--
--      New schema (packages/db/prisma/schema.prisma:571 and :587):
--        @@index([path(ops: raw("text_pattern_ops"))], map: "NoteNode_path_prefix_idx")
--        @@index([tags], type: Gin, map: "NoteAnswer_tags_idx")
--
--      Those two declarations compile to exactly the two CREATE INDEX
--      statements above: same table, same single key column, same access
--      method, same operator class, same name. The `map:` values were copied
--      verbatim out of that migration precisely so this would land as a
--      recorded no-op (/tmp/v2/changes.txt:71). So the correct emission here is
--      a NO-OP, not a rename and not a recreate.
--
--      Two details worth stating, because getting either wrong is drift:
--        * The GIN index is declared BARE — `@@index([tags], type: Gin)`, with
--          no `ops: ArrayOps`. An earlier draft (/tmp/v2/idxtest/new_notes.txt:44)
--          had ArrayOps and the final schema dropped it, deliberately, to match
--          the bare production DDL. array_ops is GIN's default opclass for
--          text[], so both spellings produce a byte-identical catalog entry and
--          pg_get_indexdef prints `USING gin (tags)` either way; the difference
--          is only in what Prisma renders, and bare is what round-trips.
--        * text_pattern_ops is NOT btree's default opclass for text, so Prisma
--          must and does spell it as raw(). pg_get_indexdef prints it.
--
--      The two DO blocks below are therefore reconcilers, not migrations: if
--      the expected index is present under the expected name they do nothing;
--      if it is present under some OTHER name (a `db push` recreated it under
--      Prisma's default name, which is the exact hazard schema-v2.md:589-591 says
--      the `map:` exists to prevent) they RENAME it; if it is absent they
--      create it; and if the name is taken by an index with a different
--      definition they abort loudly rather than guess.
--
--   2. Three new notes CHECKs, each preceded by its own zero-row assertion in
--      the same DO block so a violation aborts with a counted message instead
--      of Postgres's bare "check constraint is violated by some row":
--        NoteNode_parentId_check      "parentId" IS NULL OR "parentId" <> "id"
--        NoteNode_depth_check         "depth" >= 0
--        NoteAnswer_confidence_check  "confidence" BETWEEN 0 AND 4
--      From schema-v2.md:835-836. No writer can violate any of them today
--      (/tmp/v2/data-facts.txt:161-162: parentId=id is 0 rows, confidence out
--      of range is 0 rows), so these record an invariant rather than fix a bug.
--      They do NOT make the application's cycle guards dead code: a two-row
--      cycle (A parents B, B parents A) is still legal in the database and
--      still has to be caught in the mover (schema-v2.md:595-597).
--
--   3. GithubYear gains a real foreign key to GithubProfile(handle):
--        GithubYear_handle_fkey  ON DELETE RESTRICT ON UPDATE CASCADE
--      RESTRICT, not CASCADE. schema-v2.md:500-502 is emphatic and this file
--      agrees: nothing in the repo ever deletes a GithubProfile, so CASCADE
--      protects nothing and arms one DELETE against a one-row table to destroy
--      an archive that cannot be rebuilt. ON UPDATE CASCADE is the useful half:
--      handle is the join key, so renaming a profile's handle must carry its
--      years with it rather than orphan them.
--
-- ROLLBACK
--   ROLLBACK the transaction if it has not committed. After commit:
--
--     ALTER TABLE "GithubYear" DROP CONSTRAINT IF EXISTS "GithubYear_handle_fkey";
--     ALTER TABLE "NoteAnswer" DROP CONSTRAINT IF EXISTS "NoteAnswer_confidence_check";
--     ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_depth_check";
--     ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_parentId_check";
--
--   Do NOT drop the two indexes when rolling back. They are pre-existing
--   production objects that this cluster only inspected; dropping them would
--   silently de-optimise the notes folder export and every tag predicate, and
--   would take the branch further from production, not closer.
--
--   If the reconcilers in section 1 performed a RENAME, the rollback for that
--   is the reverse rename, and the printed NOTICE names both sides. But a
--   rename firing at all means the branch had already drifted from
--   20260803120000, which is worth stopping to understand before rolling
--   anything back.
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional. Run the whole file inside
--   one BEGIN / COMMIT. Specifically:
--     * CREATE INDEX without CONCURRENTLY is transactional. There is no
--       CREATE INDEX CONCURRENTLY here, and there must not be: CONCURRENTLY
--       cannot run in a transaction block.
--     * ALTER INDEX ... RENAME TO is transactional.
--     * ADD CONSTRAINT ... CHECK and ADD CONSTRAINT ... FOREIGN KEY are
--       transactional.
--     * No ALTER TYPE ... ADD VALUE, no VACUUM, no CREATE EXTENSION, no
--       session_replication_role, no DISABLE TRIGGER. Nothing here needs
--       superuser.
--   Lock note: the two ADD CONSTRAINT ... CHECK statements take ACCESS
--   EXCLUSIVE on NoteNode / NoteAnswer and scan them (881 and 776 rows). The
--   FK takes ACCESS EXCLUSIVE on GithubYear and SHARE ROW EXCLUSIVE on
--   GithubProfile and scans 2 rows. All three are effectively instant, and the
--   branch serves no traffic.
--
-- WHY EVERY CHECK HERE IS ADDED VALID, NOT NOT VALID
--   schema-v2.md:846 asks for NOT VALID + VALIDATE on BUSY tables. Neither of
--   these is busy: the notes vault lives only in apps/docs, has zero portfolio
--   relevance (schema-v2.md:578-579), and the branch takes no traffic at all.
--   NOT VALID followed by VALIDATE CONSTRAINT inside this one transaction would
--   also buy nothing, because the ACCESS EXCLUSIVE lock from the ADD is held
--   until COMMIT either way. Adding them VALID keeps convalidated = true, which
--   is what V4 asserts and what lets the planner use them.
--
-- IDEMPOTENCY
--   Re-running the whole file is a no-op. The index reconcilers compare the
--   catalog before acting, and all four constraint additions are guarded on
--   pg_constraint. Nothing here is guarded on a data_type or on a value, so
--   there is no second-run coercion hazard.
--
-- SCOPE / NON-GOALS
--   * NoteAnswer.tags is NOT touched. Production declares it
--     `"tags" TEXT[] DEFAULT ARRAY[]::TEXT[]` with no NOT NULL
--     (20260803120000_add_notes/migration.sql:46), while the hand-written
--     ContactMessage.spamReasons in 20260822110000_add_inbox_workflow/migration.sql:15 does carry NOT NULL.
--     The new schema says `tags String[] @default([])` for both shapes, because
--     Prisma has no nullable scalar list and treats a NULL array as an empty
--     list on read. Changing the column would be a rewrite in service of a
--     distinction the datamodel cannot express. Left alone deliberately; see
--     the open question at the foot of this file.
--   * No index is added on GithubYear."handle" for the new FK. Postgres does
--     not require one, GithubYear_handle_year_key already leads with handle so
--     the RESTRICT and CASCADE checks have an access path, and the new schema
--     declares no such index — adding one would be drift.
--   * GithubProfile gets no DDL. Its only v2 change is the `years`
--     back-relation, which is a Prisma-side construct with no SQL.
--   * GithubYear_days_length_check and GithubYear_year_check already exist
--     (20260730120000_add_github_activity/migration.sql:40 and :45) and
--     schema-v2.md:834 keeps both unchanged. They are asserted present in P8
--     and V5, not re-created.
--   * MediaAsset_key_prefix_idx is the other text_pattern_ops index in the new
--     schema (schema.prisma:622). It belongs to the media cluster, not here.
--
-- CROSS-CLUSTER
--   No other file in /tmp/v2/sql/ writes to NoteNode, NoteAnswer, GithubYear or
--   GithubProfile; the only mentions elsewhere are two comments citing
--   GithubYear's CHECK names as house style. This cluster is order-independent.
-- =============================================================================


-- =============================================================================
-- PREFLIGHT. Every one of these must return the stated result BEFORE any DDL.
-- Run them all, read them all, then run the DDL. They take no locks beyond
-- ACCESS SHARE and change nothing.
-- =============================================================================

-- P1. Row counts, for the record and for the after/before comparison in V8.
--     EXPECTED: noteNodes 881, noteAnswers 776, githubYears 2.
--     noteNodes and the invariants below come from /tmp/v2/data-facts.txt:161;
--     noteAnswers 776 comes from the migration brief, since data-facts carries
--     NoteAnswer's confidence invariant but not its count. githubProfiles is
--     expected to be 1 per schema-v2.md:487-491, but /tmp/v2/data-facts.txt
--     does NOT carry a GithubProfile count, so that number is REPORTED, not
--     asserted. What matters for the FK is P2, not this.
SELECT
  (SELECT count(*) FROM "NoteNode")      AS "noteNodes",
  (SELECT count(*) FROM "NoteAnswer")    AS "noteAnswers",
  (SELECT count(*) FROM "GithubProfile") AS "githubProfiles",
  (SELECT count(*) FROM "GithubYear")    AS "githubYears";

-- P2. THE ONE ASSERTION THAT CAN STOP THIS CLUSTER: orphan GithubYear rows.
--     EXPECTED: 0 rows. /tmp/v2/data-facts.txt:163 reads
--     "GithubYear orphans: none days len: [365, 365] years: [2025, 2026]".
--
--     REPAIR, IF THIS EVER RETURNS A ROW: INSERT the missing GithubProfile.
--     NEVER DELETE THE GithubYear ROW. Not as a convenience, not "just on the
--     branch". These rows are the ONLY copy of contribution history older than
--     GitHub's trailing window: the upstream mirror
--     (github-contributions-api.jogruber.de) is an unauthenticated hobby
--     service that serves a TRAILING ~365 days, so a day that scrolls out of
--     that window and is not in this table is gone permanently and nothing
--     anywhere can rebuild it (20260730120000_add_github_activity:1-5,
--     schema-v2.md:494-497). A deleted year is unrecoverable; a fabricated
--     profile row is trivially correctable, because GithubProfile holds only a
--     handle, a trailing-window total and a fetch timestamp, and the next
--     successful refresh overwrites the last two anyway.
--
--     The repair, for a printed handle H:
--       INSERT INTO "GithubProfile" ("id", "handle", "total", "fetchedAt")
--       VALUES (gen_random_uuid()::text, H, 0, '1970-01-01T00:00:00Z')
--       ON CONFLICT ("handle") DO NOTHING;
--     total 0 and an epoch fetchedAt are the honest "never fetched" encoding:
--     schema-v2.md:489-491 defines fetchedAt as the cutoff past which stored
--     zeros mean "never fetched" rather than "shipped nothing", so an epoch
--     stamp says exactly that and the next refresh corrects it. Do NOT invent
--     a total by summing the days archive: schema-v2.md:492-493 says the two
--     windows differ by a day or two and must not be reconciled.
SELECT "y"."id", "y"."handle", "y"."year", length("y"."days") AS "daysLength"
FROM "GithubYear" AS "y"
LEFT JOIN "GithubProfile" AS "p" ON "p"."handle" = "y"."handle"
WHERE "p"."handle" IS NULL
ORDER BY "y"."handle", "y"."year";

-- P3. FK prerequisite: the referenced side must be covered by a unique,
--     non-partial, immediate index. Postgres resolves a REFERENCES target
--     through pg_index, so GithubProfile_handle_key being a bare
--     CREATE UNIQUE INDEX
--     (20260730120000_add_github_activity/migration.sql:50) rather than a
--     UNIQUE CONSTRAINT is fine — that is how Prisma writes every unique in
--     this repo, and it is what pg_constraint.conindid in V6 resolves to.
--     EXPECTED: exactly 1 row.
--       GithubProfile_handle_key | t (unique) | f (not partial) | t (immediate)
SELECT "c"."relname" AS "indexName",
       "i"."indisunique", "i"."indpred" IS NOT NULL AS "isPartial", "i"."indimmediate"
FROM "pg_index" AS "i"
JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
WHERE "i"."indrelid" = '"GithubProfile"'::regclass
  AND "i"."indisunique"
  AND "i"."indnatts" = 1
  AND (SELECT "attname" FROM "pg_attribute"
       WHERE "attrelid" = "i"."indrelid" AND "attnum" = "i"."indkey"[0]) = 'handle';

-- P4. GithubYear."handle" must be NOT NULL. If it were nullable a NULL handle
--     would satisfy the FK by default MATCH SIMPLE semantics and silently
--     become an unattributable year, which is the failure mode the FK exists
--     to close.
--     EXPECTED: 1 row, is_nullable 'NO', data_type 'text'.
SELECT "column_name", "data_type", "is_nullable"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'GithubYear'
  AND "column_name" = 'handle';

-- P5. Zero-row assertion for NoteNode_parentId_check.
--     EXPECTED: 0 rows. /tmp/v2/data-facts.txt:161 "parentId=id: 0".
SELECT "id", "parentId", "path"
FROM "NoteNode"
WHERE "parentId" IS NOT NULL AND "parentId" = "id";

-- P6. Zero-row assertion for NoteNode_depth_check.
--     EXPECTED: 0 rows. depth is INTEGER NOT NULL DEFAULT 0 and the writers
--     derive it from the path, so a negative value would mean a corrupt
--     subtree rewrite rather than a bad input.
SELECT "id", "depth", "path"
FROM "NoteNode"
WHERE "depth" < 0;

-- P7. Zero-row assertion for NoteAnswer_confidence_check.
--     EXPECTED: 0 rows. /tmp/v2/data-facts.txt:162
--     "NoteAnswer confidence out of range: 0". 0 is not out of range: it is the
--     overloaded "unrated" value the search language's conf:0 clause depends on
--     (schema-v2.md:607-608), so the CHECK is BETWEEN 0 AND 4, not 1 AND 4.
SELECT "nodeId", "confidence"
FROM "NoteAnswer"
WHERE "confidence" < 0 OR "confidence" > 4;

-- P8. Current constraint inventory on the four tables. This is the drift gate:
--     read it before touching anything.
--     EXPECTED: exactly 8 rows.
--       GithubProfile | GithubProfile_pkey             | p
--       GithubYear    | GithubYear_days_length_check   | c
--       GithubYear    | GithubYear_pkey                | p
--       GithubYear    | GithubYear_year_check          | c
--       NoteAnswer    | NoteAnswer_nodeId_fkey         | f
--       NoteAnswer    | NoteAnswer_pkey                | p
--       NoteNode      | NoteNode_parentId_fkey         | f
--       NoteNode      | NoteNode_pkey                  | p
--     In particular: NO GithubYear_handle_fkey, NO NoteNode_parentId_check, NO
--     NoteNode_depth_check, NO NoteAnswer_confidence_check. If any of those
--     four is already listed, this cluster has already run and the DDL below
--     will no-op on it.
SELECT "t"."relname" AS "table", "k"."conname", "k"."contype", "k"."convalidated"
FROM "pg_constraint" AS "k"
JOIN "pg_class" AS "t" ON "t"."oid" = "k"."conrelid"
WHERE "k"."conrelid" IN (
  '"NoteNode"'::regclass, '"NoteAnswer"'::regclass,
  '"GithubProfile"'::regclass, '"GithubYear"'::regclass
)
  AND "k"."contype" IN ('p', 'u', 'f', 'c')
ORDER BY "t"."relname", "k"."conname";

-- P9. Current index inventory on the two notes tables, with the real DDL
--     Postgres will reproduce. /tmp/v2/data-facts.txt carries NO index
--     inventory, so this query — not the facts file — is the evidence that the
--     two raw indexes survived onto the branch. Compare each line against
--     20260803120000_add_notes/migration.sql.
--     EXPECTED: exactly 8 rows — NoteAnswer's 3 and NoteNode's 5, counting the
--     indexes that back each primary key and the path unique — in this order
--     and with these definitions (the schema name will be whatever
--     current_schema() is, typically public; pg_get_indexdef quotes an
--     identifier only when it needs to, so `path`, `tags`, `confidence` and
--     `id` come back bare while "nodeId", "deletedAt", "parentId" and
--     "sortOrder" come back quoted):
--       NoteAnswer | NoteAnswer_confidence_idx       | CREATE INDEX "NoteAnswer_confidence_idx" ON public."NoteAnswer" USING btree (confidence)
--       NoteAnswer | NoteAnswer_pkey                 | CREATE UNIQUE INDEX "NoteAnswer_pkey" ON public."NoteAnswer" USING btree ("nodeId")
--       NoteAnswer | NoteAnswer_tags_idx             | CREATE INDEX "NoteAnswer_tags_idx" ON public."NoteAnswer" USING gin (tags)
--       NoteNode   | NoteNode_deletedAt_idx          | CREATE INDEX "NoteNode_deletedAt_idx" ON public."NoteNode" USING btree ("deletedAt")
--       NoteNode   | NoteNode_parentId_sortOrder_idx | CREATE INDEX "NoteNode_parentId_sortOrder_idx" ON public."NoteNode" USING btree ("parentId", "sortOrder")
--       NoteNode   | NoteNode_path_key               | CREATE UNIQUE INDEX "NoteNode_path_key" ON public."NoteNode" USING btree (path)
--       NoteNode   | NoteNode_path_prefix_idx        | CREATE INDEX "NoteNode_path_prefix_idx" ON public."NoteNode" USING btree (path text_pattern_ops)
--       NoteNode   | NoteNode_pkey                   | CREATE UNIQUE INDEX "NoteNode_pkey" ON public."NoteNode" USING btree (id)
--     Every one of those eight names is a name the new schema still expects, so
--     the correct end state is "these eight, unchanged". Any NINTH index, or any
--     name not on that list, is drift that has to be explained before the DDL
--     below runs — in particular NoteNode_path_idx or a Prisma-default
--     NoteAnswer_tags_idx variant would mean a `db push` has been through here.
SELECT "t"."relname" AS "table", "c"."relname" AS "indexName",
       pg_get_indexdef("i"."indexrelid") AS "definition"
FROM "pg_index" AS "i"
JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
JOIN "pg_class" AS "t" ON "t"."oid" = "i"."indrelid"
WHERE "i"."indrelid" IN ('"NoteNode"'::regclass, '"NoteAnswer"'::regclass)
ORDER BY "t"."relname", "c"."relname";


-- =============================================================================
-- DDL / DML.
--
-- Order: the two index reconcilers first (cheapest, and they are the ones that
-- reveal whether the branch has already drifted), then the three notes CHECKs,
-- then the GithubYear FK. There is no dependency between the three sections;
-- this order simply puts the diagnostics first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reconcile the two previously-raw indexes to the names the new schema
--    declares. On an undrifted branch BOTH of these blocks print
--    "already correct" and emit no DDL at all.
--
--    The match is made on pg_get_indexdef, not on the index name, because the
--    name is exactly what may be wrong. A `db push` against the OLD schema
--    would have dropped both (they were invisible to the datamodel); a
--    `db push` against the NEW schema recreates them under the declared names;
--    a push against an intermediate draft could have created the same index
--    under Prisma's default name — NoteNode_path_idx / NoteAnswer_tags_idx —
--    which is the drift schema-v2.md:589-591 says the `map:` exists to prevent.
--    Renaming is strictly better than DROP + CREATE: it is metadata-only,
--    keeps the existing index valid and its statistics intact, and cannot
--    leave a window with no index at all.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  "v_target"   text := 'NoteNode_path_prefix_idx';
  "v_found"    text;
  "v_nameTaken" text;
  "v_existingDef" text;
BEGIN
  -- Any btree on NoteNode whose single key is path with the text_pattern_ops
  -- opclass, whatever it is called. pg_get_indexdef leaves an all-lowercase
  -- identifier unquoted, hence `path` and not `"path"` in the pattern.
  SELECT "c"."relname" INTO "v_found"
  FROM "pg_index" AS "i"
  JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
  WHERE "i"."indrelid" = '"NoteNode"'::regclass
    AND pg_get_indexdef("i"."indexrelid") ~ 'USING btree \(path text_pattern_ops\)$'
  ORDER BY ("c"."relname" = "v_target") DESC, "c"."relname"
  LIMIT 1;

  SELECT "c"."relname" INTO "v_nameTaken"
  FROM "pg_class" AS "c"
  WHERE "c"."relname" = "v_target" AND "c"."relkind" = 'i'
    AND "c"."relnamespace" = (SELECT "oid" FROM "pg_namespace" WHERE "nspname" = current_schema());

  -- Resolved into a variable rather than inlined into the RAISE arguments, and
  -- through quote_ident, because regclass down-cases an unquoted name: a bare
  -- 'NoteNode_path_prefix_idx'::regclass looks for notenode_path_prefix_idx and
  -- fails. Every identifier in this repo is camelCase, so this is not a corner
  -- case, it is the norm.
  IF "v_nameTaken" IS NOT NULL THEN
    "v_existingDef" := pg_get_indexdef(quote_ident("v_target")::regclass);
  END IF;

  IF "v_found" = "v_target" THEN
    RAISE NOTICE '% already exists with the expected definition; no-op.', "v_target";

  ELSIF "v_found" IS NOT NULL AND "v_nameTaken" IS NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO %I', "v_found", "v_target");
    RAISE NOTICE 'DRIFT REPAIRED: renamed index % to %. Roll back with: ALTER INDEX "%" RENAME TO "%".',
      "v_found", "v_target", "v_target", "v_found";

  ELSIF "v_found" IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot rename % to %: that name is already taken by a different index. Current definition: %',
      "v_found", "v_target", "v_existingDef";

  ELSIF "v_nameTaken" IS NOT NULL THEN
    RAISE EXCEPTION 'Index % exists but does not match the expected definition. Found: %. Expected: CREATE INDEX "NoteNode_path_prefix_idx" ON "NoteNode" ("path" text_pattern_ops). Resolve by hand.',
      "v_target", "v_existingDef";

  ELSE
    -- Absent entirely. Recreated verbatim from
    -- 20260803120000_add_notes/migration.sql:78. Its real consumer today is
    -- the case-sensitive folder export, not the search language's `in:` scope
    -- (that compiles to ILIKE, which a text_pattern_ops btree cannot serve —
    -- schema-v2.md:592-594 corrects the original migration's justification).
    -- It is declared in Prisma now so that `db push`, which README.md:240-246 documents
    -- as the setup path, can no longer drop it.
    CREATE INDEX "NoteNode_path_prefix_idx" ON "NoteNode" ("path" text_pattern_ops);
    RAISE NOTICE 'Index % was MISSING and has been created. Investigate why: 20260803120000 is recorded as applied.', "v_target";
  END IF;
END
$$;

DO $$
DECLARE
  "v_target"   text := 'NoteAnswer_tags_idx';
  "v_found"    text;
  "v_nameTaken" text;
  "v_existingDef" text;
BEGIN
  -- Bare GIN on tags. array_ops is the default opclass for text[] under gin,
  -- so pg_get_indexdef prints `USING gin (tags)` with no opclass named, which
  -- is also what the bare `@@index([tags], type: Gin)` declaration round-trips
  -- to. Matching on `USING gin (tags)` therefore matches both spellings.
  SELECT "c"."relname" INTO "v_found"
  FROM "pg_index" AS "i"
  JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
  WHERE "i"."indrelid" = '"NoteAnswer"'::regclass
    AND pg_get_indexdef("i"."indexrelid") ~ 'USING gin \(tags( array_ops)?\)$'
  ORDER BY ("c"."relname" = "v_target") DESC, "c"."relname"
  LIMIT 1;

  SELECT "c"."relname" INTO "v_nameTaken"
  FROM "pg_class" AS "c"
  WHERE "c"."relname" = "v_target" AND "c"."relkind" = 'i'
    AND "c"."relnamespace" = (SELECT "oid" FROM "pg_namespace" WHERE "nspname" = current_schema());

  -- Resolved into a variable rather than inlined into the RAISE arguments, and
  -- through quote_ident, because regclass down-cases an unquoted name: a bare
  -- 'NoteNode_path_prefix_idx'::regclass looks for notenode_path_prefix_idx and
  -- fails. Every identifier in this repo is camelCase, so this is not a corner
  -- case, it is the norm.
  IF "v_nameTaken" IS NOT NULL THEN
    "v_existingDef" := pg_get_indexdef(quote_ident("v_target")::regclass);
  END IF;

  IF "v_found" = "v_target" THEN
    RAISE NOTICE '% already exists with the expected definition; no-op.', "v_target";

  ELSIF "v_found" IS NOT NULL AND "v_nameTaken" IS NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO %I', "v_found", "v_target");
    RAISE NOTICE 'DRIFT REPAIRED: renamed index % to %. Roll back with: ALTER INDEX "%" RENAME TO "%".',
      "v_found", "v_target", "v_target", "v_found";

  ELSIF "v_found" IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot rename % to %: that name is already taken by a different index. Current definition: %',
      "v_found", "v_target", "v_existingDef";

  ELSIF "v_nameTaken" IS NOT NULL THEN
    RAISE EXCEPTION 'Index % exists but does not match the expected definition. Found: %. Expected: CREATE INDEX "NoteAnswer_tags_idx" ON "NoteAnswer" USING GIN ("tags"). Resolve by hand.',
      "v_target", "v_existingDef";

  ELSE
    -- Absent entirely. Recreated verbatim from
    -- 20260803120000_add_notes/migration.sql:81. Note for anyone tuning this
    -- later: `tag:` compiles to hasSome, which emits `&&`, not `@>`
    -- (schema-v2.md:603-605 corrects the draft), and at a few hundred rows the
    -- planner will likely take the primary key through the EXISTS that Prisma
    -- wraps the relation filter in. It is kept because dropping it is a
    -- one-way bet against growth, not because it was measured.
    CREATE INDEX "NoteAnswer_tags_idx" ON "NoteAnswer" USING GIN ("tags");
    RAISE NOTICE 'Index % was MISSING and has been created. Investigate why: 20260803120000 is recorded as applied.', "v_target";
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. The three notes CHECKs, each behind its own zero-row assertion.
--
--    Prisma cannot model a CHECK, so these live only in SQL and a `db push`
--    will never recreate them — the same hazard as Skill_name_lower_key
--    (schema-v2.md:842-844), except that losing a CHECK loses an invariant
--    rather than data, so it is recoverable by re-running this section.
--    Named Table_column_check, the house style set by HeroTitle_version_check,
--    GithubYear_year_check and AuditEvent_action_check.
-- -----------------------------------------------------------------------------

DO $$
DECLARE "v_bad" bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"NoteNode"'::regclass AND "conname" = 'NoteNode_parentId_check'
  ) THEN
    RAISE NOTICE 'NoteNode_parentId_check already exists; no-op.';
  ELSE
    SELECT count(*) INTO "v_bad" FROM "NoteNode" WHERE "parentId" IS NOT NULL AND "parentId" = "id";
    IF "v_bad" > 0 THEN
      RAISE EXCEPTION 'ABORT: % NoteNode row(s) are their own parent. Preflight P5 lists them. Fix the rows, do not weaken the constraint.', "v_bad";
    END IF;

    -- A node cannot be its own parent. The IS NULL arm is spelled out rather
    -- than left to three-valued logic so the constraint reads as its intent:
    -- 18 of the 881 rows are roots with a NULL parentId and all 18 are legal.
    --
    -- This closes the one-row cycle only. A two-row cycle is still legal in
    -- the database, so the mover's recursive guard stays load-bearing; the
    -- path prefix test it uses is the real cycle defence and this CHECK is the
    -- cheap floor under it.
    ALTER TABLE "NoteNode"
      ADD CONSTRAINT "NoteNode_parentId_check"
      CHECK ("parentId" IS NULL OR "parentId" <> "id");
  END IF;
END
$$;

DO $$
DECLARE "v_bad" bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"NoteNode"'::regclass AND "conname" = 'NoteNode_depth_check'
  ) THEN
    RAISE NOTICE 'NoteNode_depth_check already exists; no-op.';
  ELSE
    SELECT count(*) INTO "v_bad" FROM "NoteNode" WHERE "depth" < 0;
    IF "v_bad" > 0 THEN
      RAISE EXCEPTION 'ABORT: % NoteNode row(s) have a negative depth. Preflight P6 lists them.', "v_bad";
    END IF;

    -- depth is a denormalised count of path separators, rewritten for the whole
    -- subtree on every create, rename, move, trash, restore, duplicate and
    -- import. Negative is not a bad input, it is arithmetic that went wrong
    -- during one of those rewrites, which is exactly the class of bug a CHECK
    -- catches at the write instead of in a render weeks later. Max depth is 4
    -- today (/tmp/v2/data-facts.txt:161); no upper bound is imposed, because
    -- the tree is allowed to grow and path's own length is the real limit.
    ALTER TABLE "NoteNode"
      ADD CONSTRAINT "NoteNode_depth_check"
      CHECK ("depth" >= 0);
  END IF;
END
$$;

DO $$
DECLARE "v_bad" bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"NoteAnswer"'::regclass AND "conname" = 'NoteAnswer_confidence_check'
  ) THEN
    RAISE NOTICE 'NoteAnswer_confidence_check already exists; no-op.';
  ELSE
    SELECT count(*) INTO "v_bad" FROM "NoteAnswer" WHERE "confidence" < 0 OR "confidence" > 4;
    IF "v_bad" > 0 THEN
      RAISE EXCEPTION 'ABORT: % NoteAnswer row(s) have a confidence outside 0..4. Preflight P7 lists them.', "v_bad";
    END IF;

    -- 0 unrated, 1 again, 2 shaky, 3 good, 4 solid. The floor is 0 and not 1
    -- because 0 is overloaded as "unrated" and the search language leans on
    -- that: conf:0 must also match a question with no answer row at all
    -- (schema-v2.md:607-608). The ceiling is the one that earns its keep — the
    -- revise queue sorts by this column and a 7 would sort past every real
    -- rating and quietly fall off the queue.
    ALTER TABLE "NoteAnswer"
      ADD CONSTRAINT "NoteAnswer_confidence_check"
      CHECK ("confidence" BETWEEN 0 AND 4);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. GithubYear -> GithubProfile(handle), RESTRICT on delete, CASCADE on
--    update.
--
--    Preflight P2 is the gate and it has already printed any orphan. The guard
--    below re-runs it so the abort message says what happened, and so the
--    "INSERT the profile, never DELETE the year" instruction is attached to the
--    error rather than buried in a comment sixty lines up.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  "v_orphanRows"    bigint;
  "v_orphanHandles" text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = '"GithubYear"'::regclass AND "conname" = 'GithubYear_handle_fkey'
  ) THEN
    RAISE NOTICE 'GithubYear_handle_fkey already exists; no-op.';
  ELSE
    SELECT count(*), string_agg(DISTINCT "y"."handle", ', ')
      INTO "v_orphanRows", "v_orphanHandles"
    FROM "GithubYear" AS "y"
    LEFT JOIN "GithubProfile" AS "p" ON "p"."handle" = "y"."handle"
    WHERE "p"."handle" IS NULL;

    IF "v_orphanRows" > 0 THEN
      RAISE EXCEPTION
        'ABORT: % orphan GithubYear row(s) for handle(s) [%]. REPAIR BY INSERTING THE MISSING GithubProfile, NEVER BY DELETING THE GithubYear ROW: these rows are the only copy of contribution history older than GitHub''s trailing ~365-day window and nothing can rebuild them. See preflight P2 for the exact INSERT.',
        "v_orphanRows", "v_orphanHandles";
    END IF;

    -- RESTRICT, not CASCADE. schema-v2.md:500-502: nothing in this repository
    -- ever deletes a GithubProfile, so CASCADE would protect nothing while
    -- arming a single DELETE against a one-row table to wipe an irreplaceable
    -- archive. RESTRICT makes that DELETE fail instead, which is the whole
    -- point. The consequence to accept: a genuine "retire this handle" will
    -- now need an explicit two-step, and the second step should be an export,
    -- not a delete.
    --
    -- ON UPDATE CASCADE is the half that does work. handle is the join key on
    -- both sides and GithubProfile.handle is mutable in principle (the handle
    -- is derived from the SocialLink whose iconKey is 'github' —
    -- schema-v2.md:487-489, /tmp/v2/data-facts.txt:237-238 — so editing that
    -- link can change it), and a rename must carry the years with it rather
    -- than orphan them.
    --
    -- Added VALID: 2 rows, both already proven attached by the guard above.
    ALTER TABLE "GithubYear"
      ADD CONSTRAINT "GithubYear_handle_fkey"
      FOREIGN KEY ("handle") REFERENCES "GithubProfile"("handle")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;


-- =============================================================================
-- VERIFICATION. Run after the DDL, in the same transaction, before COMMIT.
-- =============================================================================

-- V1. The two reconciled indexes, by name and by definition. This is the one
--     that decides whether `prisma migrate diff` comes back empty.
--     EXPECTED: exactly 2 rows.
--       NoteAnswer_tags_idx      | CREATE INDEX "NoteAnswer_tags_idx" ON public."NoteAnswer" USING gin (tags)
--       NoteNode_path_prefix_idx | CREATE INDEX "NoteNode_path_prefix_idx" ON public."NoteNode" USING btree (path text_pattern_ops)
SELECT "c"."relname" AS "indexName", pg_get_indexdef("i"."indexrelid") AS "definition"
FROM "pg_index" AS "i"
JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
WHERE "c"."relname" IN ('NoteNode_path_prefix_idx', 'NoteAnswer_tags_idx')
ORDER BY "c"."relname";

-- V2. Nothing has an unexpected NAME. Every index on the two notes tables must
--     be one the new schema declares, and every one it declares must be
--     present. A `false` in either column is drift.
--     EXPECTED: exactly 8 rows, the same eight P9 listed, "declaredByPrisma"
--     true on all 8, and the count query in V3 returning 8 / 0.
SELECT "t"."relname" AS "table", "c"."relname" AS "indexName",
       "c"."relname" IN (
         'NoteNode_pkey', 'NoteNode_path_key', 'NoteNode_parentId_sortOrder_idx',
         'NoteNode_deletedAt_idx', 'NoteNode_path_prefix_idx',
         'NoteAnswer_pkey', 'NoteAnswer_confidence_idx', 'NoteAnswer_tags_idx'
       ) AS "declaredByPrisma"
FROM "pg_index" AS "i"
JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
JOIN "pg_class" AS "t" ON "t"."oid" = "i"."indrelid"
WHERE "i"."indrelid" IN ('"NoteNode"'::regclass, '"NoteAnswer"'::regclass)
ORDER BY "t"."relname", "c"."relname";

-- V3. The same thing as two numbers, for a scriptable pass/fail.
--     EXPECTED: 1 row, present 8, unexpected 0.
--     (8 = NoteNode's 5 including its pkey and unique, plus NoteAnswer's 3.)
SELECT
  (SELECT count(*) FROM "pg_index" AS "i"
   JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
   WHERE "i"."indrelid" IN ('"NoteNode"'::regclass, '"NoteAnswer"'::regclass)
     AND "c"."relname" IN (
       'NoteNode_pkey', 'NoteNode_path_key', 'NoteNode_parentId_sortOrder_idx',
       'NoteNode_deletedAt_idx', 'NoteNode_path_prefix_idx',
       'NoteAnswer_pkey', 'NoteAnswer_confidence_idx', 'NoteAnswer_tags_idx'
     )) AS "present",
  (SELECT count(*) FROM "pg_index" AS "i"
   JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indexrelid"
   WHERE "i"."indrelid" IN ('"NoteNode"'::regclass, '"NoteAnswer"'::regclass)
     AND "c"."relname" NOT IN (
       'NoteNode_pkey', 'NoteNode_path_key', 'NoteNode_parentId_sortOrder_idx',
       'NoteNode_deletedAt_idx', 'NoteNode_path_prefix_idx',
       'NoteAnswer_pkey', 'NoteAnswer_confidence_idx', 'NoteAnswer_tags_idx'
     )) AS "unexpected";

-- V4. The three new CHECKs exist, are validated, and say what they should.
--     convalidated must be true: a NOT VALID constraint is not trusted by the
--     planner and, more to the point here, would mean an existing row is
--     exempt from the invariant.
--     EXPECTED: exactly 3 rows. The definition text below is Postgres's own
--     normalisation of what was written above — BETWEEN is expanded into two
--     comparisons, parentheses are added, and an identifier is quoted only when
--     it has to be (so "parentId" is quoted and id, depth and confidence are
--     not). Compare it for meaning, not character by character.
--       NoteAnswer | NoteAnswer_confidence_check | t | CHECK (((confidence >= 0) AND (confidence <= 4)))
--       NoteNode   | NoteNode_depth_check        | t | CHECK ((depth >= 0))
--       NoteNode   | NoteNode_parentId_check     | t | CHECK ((("parentId" IS NULL) OR ("parentId" <> id)))
SELECT "t"."relname" AS "table", "k"."conname", "k"."convalidated",
       pg_get_constraintdef("k"."oid") AS "definition"
FROM "pg_constraint" AS "k"
JOIN "pg_class" AS "t" ON "t"."oid" = "k"."conrelid"
WHERE "k"."conname" IN (
  'NoteNode_parentId_check', 'NoteNode_depth_check', 'NoteAnswer_confidence_check'
)
ORDER BY "t"."relname", "k"."conname";

-- V5. The GithubYear FK exists with the right actions, and the two pre-existing
--     GithubYear CHECKs are untouched.
--     confdeltype 'r' = RESTRICT. confupdtype 'c' = CASCADE. Anything else,
--     especially 'c' in confdeltype, is the bug schema-v2.md:500 warns about
--     and must be dropped and re-added.
--     EXPECTED: exactly 3 rows. confdeltype and confupdtype are blank on a
--     CHECK. The two CHECK definitions must be IDENTICAL to what they were in
--     P8 — this cluster does not touch them.
--       GithubYear_days_length_check | c |      |   | t | CHECK ((length(days) = ANY (ARRAY[365, 366])))
--       GithubYear_handle_fkey       | f | r    | c | t | FOREIGN KEY (handle) REFERENCES "GithubProfile"(handle) ON UPDATE CASCADE ON DELETE RESTRICT
--       GithubYear_year_check        | c |      |   | t | CHECK (((year >= 2005) AND (year <= 2200)))
SELECT "k"."conname", "k"."contype", "k"."confdeltype", "k"."confupdtype",
       "k"."convalidated", pg_get_constraintdef("k"."oid") AS "definition"
FROM "pg_constraint" AS "k"
WHERE "k"."conrelid" = '"GithubYear"'::regclass
  AND "k"."contype" IN ('f', 'c')
ORDER BY "k"."conname";

-- V6. The FK resolved to the intended unique index on the referenced side.
--     EXPECTED: 1 row.
--       GithubYear_handle_fkey | GithubProfile | GithubProfile_handle_key
SELECT "k"."conname",
       "r"."relname" AS "referencedTable",
       "x"."relname" AS "viaUniqueIndex"
FROM "pg_constraint" AS "k"
JOIN "pg_class" AS "r" ON "r"."oid" = "k"."confrelid"
LEFT JOIN "pg_class" AS "x" ON "x"."oid" = "k"."conindid"
WHERE "k"."conname" = 'GithubYear_handle_fkey';

-- V7. Every GithubYear row still has its profile, and no year vanished.
--     EXPECTED: 1 row, years 2, attached 2, orphans 0, distinctHandles 1,
--     minYear 2025, maxYear 2026, daysLengths {365} — both rows are 365
--     characters, so the DISTINCT collapses to a single element
--     (/tmp/v2/data-facts.txt:163). 2026 being 365 long is correct: 2026 is not
--     a leap year, and the row holds the whole calendar year, zero-filled ahead
--     of today.
SELECT count(*)                                              AS "years",
       count("p"."handle")                                   AS "attached",
       count(*) - count("p"."handle")                        AS "orphans",
       count(DISTINCT "y"."handle")                          AS "distinctHandles",
       min("y"."year")                                       AS "minYear",
       max("y"."year")                                       AS "maxYear",
       array_agg(DISTINCT length("y"."days") ORDER BY length("y"."days")) AS "daysLengths"
FROM "GithubYear" AS "y"
LEFT JOIN "GithubProfile" AS "p" ON "p"."handle" = "y"."handle";

-- V8. Row counts unchanged. No statement in this cluster inserts, updates or
--     deletes a single row; it only adds constraints and index metadata.
--     EXPECTED: identical to preflight P1 — noteNodes 881, noteAnswers 776,
--     githubYears 2, githubProfiles whatever P1 reported.
SELECT
  (SELECT count(*) FROM "NoteNode")      AS "noteNodes",
  (SELECT count(*) FROM "NoteAnswer")    AS "noteAnswers",
  (SELECT count(*) FROM "GithubProfile") AS "githubProfiles",
  (SELECT count(*) FROM "GithubYear")    AS "githubYears";

-- V9. The notes tree is structurally intact, as a sanity check on the CHECKs
--     not having been added against a table somebody else was mid-transforming.
--     EXPECTED: 1 row, nodes 881, roots 18, maxDepth 4, selfParents 0,
--     answered 776, answersWithoutNode 0 (/tmp/v2/data-facts.txt:161-162).
SELECT (SELECT count(*) FROM "NoteNode")                                  AS "nodes",
       (SELECT count(*) FROM "NoteNode" WHERE "parentId" IS NULL)         AS "roots",
       (SELECT max("depth") FROM "NoteNode")                              AS "maxDepth",
       (SELECT count(*) FROM "NoteNode" WHERE "parentId" = "id")          AS "selfParents",
       (SELECT count(*) FROM "NoteAnswer")                                AS "answered",
       (SELECT count(*) FROM "NoteAnswer" AS "a"
        WHERE NOT EXISTS (SELECT 1 FROM "NoteNode" AS "n" WHERE "n"."id" = "a"."nodeId")) AS "answersWithoutNode";


-- =============================================================================
-- OPTIONAL NEGATIVE TESTS.
--
-- V4 and V5 prove the constraints EXIST and are validated. They do not prove
-- they FIRE. These four blocks do, by attempting a violating write inside a
-- plpgsql subtransaction (the BEGIN ... EXCEPTION block) and requiring the
-- expected SQLSTATE. Every attempt is rolled back to the subtransaction's
-- savepoint, so no row is created, changed or destroyed, and no sequence is
-- consumed — NoteNode's id is a Prisma-side uuid, not a serial.
--
-- Safe to run in the same transaction as everything above, and safe to skip
-- entirely. The cost of running them is a handful of dead tuples on a
-- throwaway branch. The 'probe' sentinel is how a write that WRONGLY succeeded
-- gets undone: raising inside the subtransaction rolls it back either way.
-- =============================================================================

DO $$
DECLARE "v_fired" boolean := false;
BEGIN
  BEGIN
    INSERT INTO "NoteNode" ("id", "parentId", "kind", "title", "slug", "path", "depth", "updatedAt")
    VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1',
            'FOLDER', 'probe', 'probe', '~probe/parentId-check', 0, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'probe';
  EXCEPTION
    WHEN check_violation THEN "v_fired" := true;
    WHEN others THEN IF SQLERRM <> 'probe' THEN RAISE; END IF;
  END;
  IF "v_fired" THEN
    RAISE NOTICE 'PASS: NoteNode_parentId_check rejects a self-parenting insert.';
  ELSE
    RAISE EXCEPTION 'FAIL: a self-parenting NoteNode insert was accepted.';
  END IF;
END
$$;

DO $$
DECLARE "v_fired" boolean := false;
BEGIN
  BEGIN
    INSERT INTO "NoteNode" ("id", "kind", "title", "slug", "path", "depth", "updatedAt")
    VALUES ('00000000-0000-0000-0000-0000000000c2',
            'FOLDER', 'probe', 'probe', '~probe/depth-check', -1, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'probe';
  EXCEPTION
    WHEN check_violation THEN "v_fired" := true;
    WHEN others THEN IF SQLERRM <> 'probe' THEN RAISE; END IF;
  END;
  IF "v_fired" THEN
    RAISE NOTICE 'PASS: NoteNode_depth_check rejects a negative depth.';
  ELSE
    RAISE EXCEPTION 'FAIL: a negative NoteNode.depth was accepted.';
  END IF;
END
$$;

DO $$
DECLARE
  "v_fired"  boolean := false;
  "v_nodeId" text;
BEGIN
  SELECT "nodeId" INTO "v_nodeId" FROM "NoteAnswer" LIMIT 1;
  IF "v_nodeId" IS NULL THEN
    RAISE NOTICE 'SKIP: NoteAnswer is empty, nothing to probe.';
  ELSE
    BEGIN
      UPDATE "NoteAnswer" SET "confidence" = 5 WHERE "nodeId" = "v_nodeId";
      RAISE EXCEPTION 'probe';
    EXCEPTION
      WHEN check_violation THEN "v_fired" := true;
      WHEN others THEN IF SQLERRM <> 'probe' THEN RAISE; END IF;
    END;
    IF "v_fired" THEN
      RAISE NOTICE 'PASS: NoteAnswer_confidence_check rejects confidence 5.';
    ELSE
      RAISE EXCEPTION 'FAIL: NoteAnswer.confidence = 5 was accepted.';
    END IF;
  END IF;
END
$$;

DO $$
DECLARE "v_fired" boolean := false;
BEGIN
  BEGIN
    INSERT INTO "GithubYear" ("id", "handle", "year", "days", "spikes")
    VALUES ('00000000-0000-0000-0000-0000000000c3', '~probe-no-such-handle', 2024,
            repeat('0', 366), '');
    RAISE EXCEPTION 'probe';
  EXCEPTION
    WHEN foreign_key_violation THEN "v_fired" := true;
    WHEN others THEN IF SQLERRM <> 'probe' THEN RAISE; END IF;
  END;
  IF "v_fired" THEN
    RAISE NOTICE 'PASS: GithubYear_handle_fkey rejects an unknown handle.';
  ELSE
    RAISE EXCEPTION 'FAIL: a GithubYear row with no GithubProfile was accepted.';
  END IF;
END
$$;

-- There is deliberately NO negative test for ON DELETE RESTRICT. Proving it
-- would mean issuing DELETE FROM "GithubProfile", and the plan's own acceptance
-- test for this step was exactly that — which schema-v2.md:503-506 rejects,
-- because it either errors (proving nothing you did not already know from V5)
-- or, retried with CASCADE out of frustration, empties the archive. V5 reads
-- confdeltype from the catalog instead. That is sufficient and it is safe.


-- =============================================================================
-- DATA LOSS LEDGER
--
--   Nothing in this cluster destroys a value. No column is dropped, retyped,
--   narrowed or renamed; no row is inserted, updated or deleted; both indexes
--   are reconciled by rename rather than by DROP and CREATE. V8 asserts the row
--   counts are unchanged and V9 asserts the tree is unchanged.
--
--   Three losses of CAPABILITY, none of information:
--
--   1. GithubYear can no longer hold a handle that has no GithubProfile row.
--      That combination was reachable before today, because handle was free
--      text on both sides with no relation between them. No such row exists
--      (preflight P2, /tmp/v2/data-facts.txt:163), so nothing is lost now — but
--      any future import that writes years before their profile will be
--      rejected rather than quietly stored. That is the intended trade, and it
--      is why the repair for an orphan is an INSERT into GithubProfile and
--      never a DELETE from GithubYear.
--
--   2. GithubProfile can no longer be deleted while any of its years exist.
--      This is the point of RESTRICT and it is a deliberate loss of a
--      destructive capability: the years are the only copy of contribution
--      history older than GitHub's trailing ~365-day window, so the database
--      should refuse. Retiring a handle now takes an explicit, considered
--      two-step, and the first step should be an export.
--
--   3. NoteNode can no longer store depth < 0 or a self-parent, and NoteAnswer
--      can no longer store a confidence outside 0..4. No row uses any of those
--      encodings for anything, and no writer produces them, so no meaning is
--      being taken away. The one thing to be aware of: if the revise queue ever
--      wants a fifth rating or a "suspended" sentinel, it has to widen this
--      CHECK first, and 5 is not available as a sentinel any more.
--
--   NOT lost, worth naming because it looks like a candidate: the `tags` array
--   column keeps its exact current nullability. This cluster does not rewrite
--   it, so an existing NULL tags value (if any exists) survives and continues
--   to read back as [] through Prisma.
-- =============================================================================

-- =============================================================================
-- OPEN QUESTIONS, honestly flagged rather than assumed away
--
--   1. This file was written without connecting to any database, so the index
--      DEFINITIONS above are derived from migration 20260803120000 plus
--      /tmp/v2/data-facts.txt:191 confirming that migration is recorded as
--      applied. /tmp/v2/data-facts.txt carries no index inventory. Preflight P9
--      is therefore the first real look at the catalog, and the two reconcilers
--      are written to handle every outcome P9 can report rather than to assume
--      the happy one.
--
--   2. `prisma migrate diff` has not been run, because running it opens a
--      connection. The claim that the end state is diff-clean rests on
--      name-and-definition equality with what the two `@@index(... map: ...)`
--      declarations compile to. V1 to V3 are the queries that prove or
--      disprove it once a connection is allowed.
--
--   3. NoteAnswer.tags is `TEXT[]` with no NOT NULL, while the otherwise
--      identical ContactMessage.spamReasons is `TEXT[] NOT NULL`. Prisma spells
--      both `String[]` because it has no nullable scalar list, and its
--      migration engine does not diff nullability on list columns, so neither
--      form should register as drift. Unverified without a connection. If a
--      diff ever does flag it, the fix is one statement
--      (`UPDATE ... SET "tags" = '{}' WHERE "tags" IS NULL;` then
--      `ALTER TABLE "NoteAnswer" ALTER COLUMN "tags" SET NOT NULL;`) and it
--      belongs in its own commit, not smuggled into this one.
-- =============================================================================
