-- =============================================================================
-- CLUSTER 11 of 11: about-quotes-notes            EXPAND (additive only)
-- target: PRODUCTION (Neon, Postgres 17, role is database owner, NOT superuser)
--
-- WHY THIS FILE EXISTS
--   The ten classified clusters cover 32 of the 43 v2 models. This file closes
--   the gap for the five that need DDL and that no other /tmp/v2/prod file
--   names: AboutParagraph, ContactPurpose, Quote, NoteNode, NoteAnswer.
--   It is derived from packages/db/v2-migration-draft/45-about-education-quotes.sql
--   (timestamps + Quote.sortOrder) and the notes half of 80-notes-github.sql
--   (three CHECKs), re-written for an in-place production target.
--
--   The six remaining uncovered models need NO DDL at all and are asserted as
--   such in preflight P0: ProjectBullet, ReplyTemplate, LinkClick,
--   MaintenanceState, AnalyticsSalt, RateLimitBucket. Education's own columns
--   belong to experience-education-expand.sql, NOT here.
--
-- THE ONE THING THAT MAKES THIS FILE NON-OPTIONAL
--   apps/web/app/lib/data.ts:356 in the v2 working tree is
--       prisma.quote.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })
--   Production has no "Quote"."sortOrder". Without this EXPAND, the v2 DEPLOY
--   makes the public landing page throw 42703 on the thought-of-the-day read.
--   apps/docs/app/(dashboard)/quotes/page.tsx:21 fails the same way.
--
-- RUN AS ONE TRANSACTION. Read PART 0 first, outside any transaction.
-- =============================================================================


-- =============================================================================
-- PART 0. PREFLIGHT. READ-ONLY. Run every query, read every answer, BEFORE you
--         open the transaction below. An open transaction holding ACCESS
--         EXCLUSIVE while you read your screen is the only way this cluster can
--         hurt the public site.
-- =============================================================================

-- P0. The six no-DDL tables really need no DDL: every column the v2 schema
--     declares already exists with the right nullability. Expect 6 rows, all t.
SELECT 'ProjectBullet'   AS t, count(*) = 4 AS ok FROM information_schema.columns
  WHERE table_schema='public' AND table_name='ProjectBullet'
UNION ALL SELECT 'ReplyTemplate', count(*) = 7 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='ReplyTemplate'
UNION ALL SELECT 'LinkClick', count(*) = 7 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='LinkClick'
UNION ALL SELECT 'MaintenanceState', count(*) = 3 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='MaintenanceState'
UNION ALL SELECT 'AnalyticsSalt', count(*) = 3 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='AnalyticsSalt'
UNION ALL SELECT 'RateLimitBucket', count(*) = 3 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='RateLimitBucket';

-- P1. Nothing here has run yet. Expect all four f.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='Quote' AND column_name='sortOrder')     AS quote_sortorder_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='Quote' AND column_name='createdAt')     AS quote_ts_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='AboutParagraph' AND column_name='createdAt') AS about_ts_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ContactPurpose' AND column_name='createdAt') AS purpose_ts_exists;

-- P2. There is no 'active' column on Quote. An earlier draft invented one.
--     Expect 0 rows. If this returns a row, STOP and re-read schema-v2.md:116.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='Quote' AND column_name='active';

-- P3. Row counts, so the verification below has a number to compare against.
--     data-facts.txt says Quote 28, NoteNode 881. Record what you actually see.
SELECT (SELECT count(*) FROM "Quote")          AS quotes,
       (SELECT count(*) FROM "AboutParagraph") AS paragraphs,
       (SELECT count(*) FROM "ContactPurpose") AS purposes,
       (SELECT count(*) FROM "NoteNode")       AS notenodes,
       (SELECT count(*) FROM "NoteAnswer")     AS noteanswers;

-- P4. The three notes CHECKs are satisfiable TODAY. Expect 0 / 0 / 0.
--     data-facts.txt:161-162 already says parentId=id is 0 and confidence out
--     of range is 0, but it does not report min(depth), so check it here.
SELECT (SELECT count(*) FROM "NoteNode"   WHERE "parentId" = "id")                AS self_parent,
       (SELECT count(*) FROM "NoteNode"   WHERE "depth" < 0)                      AS negative_depth,
       (SELECT count(*) FROM "NoteAnswer" WHERE "confidence" NOT BETWEEN 0 AND 4) AS bad_confidence;

-- P5. The two notes indexes the v2 schema declares already exist under exactly
--     the names it maps. Expect 2 rows. If either is missing, the CONTRACT-side
--     drift check will complain; nothing in EXPAND depends on them.
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND indexname IN ('NoteNode_path_prefix_idx','NoteAnswer_tags_idx')
ORDER BY indexname;

-- P6. No constraint name this file adds is already taken. Expect 0 rows.
SELECT conname FROM pg_constraint
WHERE conname IN ('NoteNode_self_parent_check','NoteNode_depth_check','NoteAnswer_confidence_check');

-- P7. The quote order this backfill is about to freeze. Print it and keep the
--     output: this is the order the live site and the admin are showing right
--     now (both order by id asc today), and the backfill's whole job is that
--     nothing moves on migration day.
SELECT (row_number() OVER (ORDER BY "id")) - 1 AS will_become_sortorder,
       "id", left("quote", 48) AS quote_head, "author"
FROM "Quote" ORDER BY "id";


-- =============================================================================
-- PART 1. EXPAND. One transaction.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';          -- a QUEUED ACCESS EXCLUSIVE request
                                        -- blocks every SELECT behind it. Quote
                                        -- and AboutParagraph are read by the
                                        -- public landing page. 28 and ~6 rows
                                        -- means the work is microseconds; bound
                                        -- the WAIT, not the work.
SET LOCAL statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- 1. GUARD. Aborts before any DDL if preflight was skipped or lied.
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE n bigint;
BEGIN
  IF to_regclass('public."Quote"') IS NULL
     OR to_regclass('public."AboutParagraph"') IS NULL
     OR to_regclass('public."ContactPurpose"') IS NULL
     OR to_regclass('public."NoteNode"') IS NULL
     OR to_regclass('public."NoteAnswer"') IS NULL THEN
    RAISE EXCEPTION 'about-quotes-notes: a target table is missing. Wrong database?';
  END IF;

  SELECT count(*) INTO n FROM "NoteNode" WHERE "parentId" = "id";
  IF n > 0 THEN RAISE EXCEPTION 'NoteNode: % self-parented row(s). Fix them; do not relax the CHECK.', n; END IF;

  SELECT count(*) INTO n FROM "NoteNode" WHERE "depth" < 0;
  IF n > 0 THEN RAISE EXCEPTION 'NoteNode: % row(s) with negative depth.', n; END IF;

  SELECT count(*) INTO n FROM "NoteAnswer" WHERE "confidence" NOT BETWEEN 0 AND 4;
  IF n > 0 THEN RAISE EXCEPTION 'NoteAnswer: % row(s) with confidence outside 0..4.', n; END IF;
END
$guard$;

-- -----------------------------------------------------------------------------
-- 2. Timestamps on the three tables that have none.
--
--    Both stamps carry DEFAULT CURRENT_TIMESTAMP through the whole window, and
--    that is load-bearing, not tidiness. v1's staged creates name neither
--    column: HEAD:apps/docs/app/lib/actions/staging.ts:506 (aboutParagraph),
--    :543 (quote), :550 (contactPurpose). NOT NULL with no default is a 23502
--    that rolls back the operator's entire staged batch.
--
--    These are migration-clock stamps, not real creation times. There is no
--    earlier evidence anywhere in the database, so this is a known, accepted,
--    one-time loss of fidelity, identical to the one hero-expand T1 accepts.
--
--    CURRENT_TIMESTAMP is STABLE, so PG17 stores one attmissingval per column
--    and does NOT rewrite any of the three tables.
-- -----------------------------------------------------------------------------
ALTER TABLE "AboutParagraph"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ContactPurpose"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- NOT HERE: ALTER COLUMN "updatedAt" DROP DEFAULT on AboutParagraph and Quote.
-- That is about-quotes-notes-contract.sql step 3. ContactPurpose.updatedAt
-- KEEPS its default permanently -- schema.prisma declares
-- `updatedAt DateTime @default(now()) @updatedAt` on that model alone, to match
-- ContactMessage. Do not "tidy" it into the contract file.

-- -----------------------------------------------------------------------------
-- 3. Quote.sortOrder. The reason this cluster blocks the DEPLOY.
--
--    Added NULLABLE first, because 28 rows already exist and the v2 schema
--    gives the column no default, so NOT NULL cannot be declared before the
--    backfill.
-- -----------------------------------------------------------------------------
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER;

-- row_number() over the CURRENT id order, minus one.
--   * Both readers order by id asc today (HEAD:apps/web/app/lib/data.ts and
--     HEAD:apps/docs/app/(dashboard)/quotes/page.tsx), so this sequence is
--     exactly the order already on screen. Nothing moves on migration day.
--   * No COLLATE clause, on purpose: "id" is TEXT holding a uuid and Prisma's
--     orderBy sorts under the column's own collation. COLLATE "C" would sort by
--     raw bytes and could disagree for hyphenated uuids -- the one thing this
--     backfill exists to avoid.
--   * Zero-based, because the admin is: reorderRows writes ids.entries()
--     indexes and nextSortOrder returns -1 for an empty table.
--   * Guarded on IS NULL so a re-run cannot renumber quotes an operator has
--     since reordered through the v2 admin.
UPDATE "Quote" AS q
SET "sortOrder" = r.rn
FROM (SELECT "id", (row_number() OVER (ORDER BY "id"))::integer - 1 AS rn FROM "Quote") AS r
WHERE q."id" = r."id" AND q."sortOrder" IS NULL;

-- Now make it NOT NULL -- but WITH A DEFAULT, which the v2 schema does not
-- declare. This is the single deliberate piece of temporary drift in this file
-- and it is what makes the column additive.
--
--   v1's quote create is HEAD:apps/docs/app/lib/actions/staging.ts:543-547:
--       tx.quote.create({ data: { quote, author }, select: { id: true } })
--   It names no sortOrder, because "quote" is excluded from the sortable-entity
--   machinery at HEAD:staging.ts:202
--       type SortableEntity = Exclude<Entity, "quote" | "adminUser" | "heroContent">
--   So NOT NULL with no default = 23502 on the next v1 quote create, taking the
--   whole staged batch with it.
--
--   v2 DOES supply it: apps/docs/app/lib/actions/staging.ts:593-599 calls
--   nextSortOrder(tx, "quote", cursors), whose quote branch is
--   tx.quote.aggregate({ _max: { sortOrder: true } }) ?? -1. So from DEPLOY
--   onward the default is never used, and CONTRACT removes it.
--
--   DEFAULT 0 rather than max+1: a DEFAULT expression cannot see the table it
--   is defaulting on without a subquery, which Postgres forbids in a column
--   default. The consequence of 0 is bounded and cosmetic -- a quote created by
--   v1 during the window sorts first instead of last, in a pool the landing
--   page indexes with `dayOfYear % quotes.length` anyway (schema-v2.md:281), so
--   order is not what the feature depends on. Nothing about it is wrong after
--   the deploy; reorder it in the v2 admin if you care.
ALTER TABLE "Quote" ALTER COLUMN "sortOrder" SET DEFAULT 0;

DO $backfilled$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Quote" WHERE "sortOrder" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Quote: % row(s) still have a NULL sortOrder. The backfill did not cover them; SET NOT NULL would abort.', n;
  END IF;
END
$backfilled$;

ALTER TABLE "Quote" ALTER COLUMN "sortOrder" SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. The three notes CHECKs. Prisma cannot express a CHECK, so the Neon child
--    branch (built by db push / DROP SCHEMA + reload) has none of these, and
--    neither does production. schema-v2.md:835-836 is the source.
--
--    Added VALID, not NOT VALID: 881 and ~881 rows, the guard above already
--    proved zero violations, and the scan is milliseconds. NOT VALID would only
--    move a scan you are not paying for.
--
--    Safe in EXPAND for both versions at once: the predicates are exactly what
--    both the v1 and the v2 notes code already maintain, and the notes vault
--    lives only in apps/docs (schema-v2.md:578, zero public readers), so a
--    mistake here cannot touch the public site.
--
--    DROP CONSTRAINT IF EXISTS first so the file is re-runnable; ADD CONSTRAINT
--    has no IF NOT EXISTS and would abort the transaction on a second run.
-- -----------------------------------------------------------------------------
ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_self_parent_check";
ALTER TABLE "NoteNode"   ADD  CONSTRAINT "NoteNode_self_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_depth_check";
ALTER TABLE "NoteNode"   ADD  CONSTRAINT "NoteNode_depth_check"
  CHECK ("depth" >= 0);

ALTER TABLE "NoteAnswer" DROP CONSTRAINT IF EXISTS "NoteAnswer_confidence_check";
ALTER TABLE "NoteAnswer" ADD  CONSTRAINT "NoteAnswer_confidence_check"
  CHECK ("confidence" BETWEEN 0 AND 4);

-- -----------------------------------------------------------------------------
-- 5. VERIFICATION, inside the transaction, so a failure rolls everything back.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE n bigint; d text;
BEGIN
  -- V1. Quote.sortOrder is NOT NULL, has the temporary DEFAULT 0, and is a
  --     gap-free 0..n-1 sequence.
  SELECT count(*) INTO n FROM "Quote";
  IF (SELECT count(DISTINCT "sortOrder") FROM "Quote") <> n
     OR (SELECT min("sortOrder") FROM "Quote") <> 0
     OR (SELECT max("sortOrder") FROM "Quote") <> n - 1 THEN
    RAISE EXCEPTION 'Quote.sortOrder is not a gap-free 0..% sequence', n - 1;
  END IF;

  SELECT column_default INTO d FROM information_schema.columns
   WHERE table_schema='public' AND table_name='Quote' AND column_name='sortOrder';
  IF d IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Quote.sortOrder default is % , expected 0 -- a v1 quote create will 23502 without it', coalesce(d,'<none>');
  END IF;

  -- V2. All six new timestamp columns are NOT NULL and all six still carry
  --     CURRENT_TIMESTAMP. If any lost its default, a v1 create will 23502.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public'
     AND (table_name, column_name) IN (
       ('AboutParagraph','createdAt'), ('AboutParagraph','updatedAt'),
       ('ContactPurpose','createdAt'), ('ContactPurpose','updatedAt'),
       ('Quote','createdAt'),          ('Quote','updatedAt'))
     AND is_nullable = 'NO'
     AND column_default = 'CURRENT_TIMESTAMP';
  IF n <> 6 THEN
    RAISE EXCEPTION 'expected 6 NOT NULL timestamp columns defaulting to CURRENT_TIMESTAMP, found %', n;
  END IF;

  -- V3. The three notes CHECKs exist and are validated.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'c' AND convalidated
     AND conname IN ('NoteNode_self_parent_check','NoteNode_depth_check','NoteAnswer_confidence_check');
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 validated notes CHECKs, found %', n; END IF;

  -- V4. Nothing was destroyed. Quote still has quote + author, and no 'active'
  --     column was invented.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Quote' AND column_name='active') THEN
    RAISE EXCEPTION 'a Quote.active column appeared. Nothing in either code version writes it.';
  END IF;

  RAISE NOTICE 'about-quotes-notes EXPAND verified: % quotes renumbered 0..%, 6 timestamp columns, 3 notes CHECKs', n, n;
END
$verify$;

COMMIT;


-- =============================================================================
-- PART 2. POST-COMMIT READ. Paste the output into the run log.
-- =============================================================================
SELECT "sortOrder", "id", left("quote", 48) AS quote_head, "author", "createdAt"
FROM "Quote" ORDER BY "sortOrder";


-- =============================================================================
-- WHY EVERY STATEMENT ABOVE IS SAFE FOR THE DEPLOYED v1 CODE
--
-- 1. Prisma never emits SELECT * and never emits a column-less INSERT; it
--    builds an explicit column list from the datamodel the client was generated
--    from. So Quote.sortOrder, and all six timestamp columns, are absent from
--    every statement the v1 client sends -- they are not merely tolerated, they
--    are unmentionable.
-- 2. The three v1 creates that could have 23502'd are each covered by a
--    DEFAULT: aboutParagraph (HEAD:staging.ts:506), quote (:543),
--    contactPurpose (:550). The quote create is the only one that also needed
--    sortOrder, which is why sortOrder gets a DEFAULT 0 it does not keep.
-- 3. The three v1 updates name only content / quote+author / label+emoji
--    (HEAD:staging.ts around :660-690), all columns that still exist unchanged.
-- 4. No column is dropped, renamed, retyped, narrowed or made NOT NULL without
--    a default. No enum is narrowed. No foreign key is added, so no v1 insert
--    acquires a new referent it must satisfy.
-- 5. The three notes CHECKs are on admin-only tables with zero public readers,
--    and the guard proved zero current violations.
-- 6. ISR: neither helps nor hurts, for the same reason as the settings cluster.
--    A mid-window regeneration of "/" re-renders with v1 code against columns
--    that all still exist and whose values did not change, producing identical
--    output. ISR only becomes a hazard if CONTRACT runs early.
-- 7. No R2 object and no SMTP send is reachable from any table in this cluster,
--    so a rollback here has no external side effect to fail to undo.
-- =============================================================================
