-- =============================================================================
-- CLUSTER 11 of 11: about-quotes-notes            CONTRACT
-- target: PRODUCTION. Run ONLY after the v2 code is the live deployment on BOTH
--         Vercel projects and has been confirmed serving (see GATE below).
--
-- THIS FILE DROPS NO COLUMN AND NO TABLE. It removes two temporary defaults
-- that EXPAND deliberately left behind. That means v1 SURVIVES this entire file
-- except for one thing: after step 2, a v1 quote create raises 23502 instead of
-- silently taking sortOrder 0, and after step 3 a v1 aboutParagraph or quote
-- create raises 23502 on updatedAt. So this file ends the free Vercel
-- instant-rollback for those three creates -- and nothing else.
--
-- If you never run this file, the only consequence is that
-- `bun run db:verify --from=PROD_DATABASE_URL` reports drift on three columns.
-- Nothing functional depends on it. It is safe to leave for a week.
-- =============================================================================


-- =============================================================================
-- GATE. Human, not SQL. All four must be true.
--   1. Both Vercel projects (web and docs) are Ready on the v2 commit and
--      promoted to the production alias, and a few minutes have passed so
--      requests still executing on the previous deployment have drained.
--   2. https://www.yatindora.in/ returns 200 and shows a thought-of-the-day
--      quote. That line is the ONLY public reader of Quote
--      (apps/web/app/lib/data.ts:356) and its orderBy names sortOrder, so a
--      rendered quote is proof the v2 read path works against the new column.
--   3. The admin /quotes page lists all quotes in order
--      (apps/docs/app/(dashboard)/quotes/page.tsx:21) and /about renders the
--      paragraph list and the contact purposes.
--   4. ONE save round-trips through the v2 admin: add a quote, confirm it lands
--      LAST in the list, then delete it. Landing last is the proof that
--      nextSortOrder is supplying the value -- which is the precondition for
--      step 2 dropping the default.
-- =============================================================================


-- =============================================================================
-- PREFLIGHT. READ-ONLY. Run before the transaction.
-- =============================================================================

-- C0. EXPAND actually ran. Expect all t.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='Quote' AND column_name='sortOrder'
            AND is_nullable='NO')                                    AS sortorder_notnull,
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Quote' AND column_name='sortOrder') = '0'
                                                                     AS sortorder_default_still_0,
  (SELECT count(*) FROM pg_constraint WHERE contype='c'
    AND conname IN ('NoteNode_self_parent_check','NoteNode_depth_check','NoteAnswer_confidence_check')) = 3
                                                                     AS notes_checks_present;

-- C1. Nothing created during the window is sitting on the temporary default in
--     a way that looks wrong. Expect 0 or 1 rows; more than one row at
--     sortOrder 0 is impossible (they would have to collide), so this really
--     lists "quotes created by v1 in the window", which sort first.
--     Cosmetic only. Reorder them in the v2 admin now if you want, BEFORE you
--     drop the default -- not because you have to, but because this is the last
--     moment the evidence is legible.
SELECT "sortOrder", "id", left("quote", 48) AS quote_head, "createdAt"
FROM "Quote" ORDER BY "sortOrder" LIMIT 5;

-- C2. Proof the v2 writer is live: at least one row whose updatedAt was written
--     by the client rather than by the column default. After the GATE step 4
--     save-and-delete this should be non-zero on at least one of the three
--     tables. Informational, not a hard gate.
SELECT 'Quote' AS t, count(*) FILTER (WHERE "updatedAt" > "createdAt" + interval '1 second') AS client_written FROM "Quote"
UNION ALL SELECT 'AboutParagraph', count(*) FILTER (WHERE "updatedAt" > "createdAt" + interval '1 second') FROM "AboutParagraph"
UNION ALL SELECT 'ContactPurpose', count(*) FILTER (WHERE "updatedAt" > "createdAt" + interval '1 second') FROM "ContactPurpose";


-- =============================================================================
-- CONTRACT. One transaction.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- 1. GUARD. Refuse to remove the defaults if EXPAND did not land, because then
--    a v1 create is still the only kind of create there is.
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Quote" WHERE "sortOrder" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Quote: % NULL sortOrder. EXPAND did not complete; do not contract.', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='AboutParagraph' AND column_name='updatedAt') THEN
    RAISE EXCEPTION 'AboutParagraph.updatedAt is missing. Run about-quotes-notes-expand.sql first.';
  END IF;
END
$guard$;

-- -----------------------------------------------------------------------------
-- 2. Drop the temporary DEFAULT 0 on Quote.sortOrder.
--
--    Safe now and only now: the v2 create supplies the value explicitly
--    (apps/docs/app/lib/actions/staging.ts:593-599 -> nextSortOrder's quote
--    branch at :481-484). From this statement on, the v1 create at
--    HEAD:staging.ts:543 raises 23502.
-- -----------------------------------------------------------------------------
ALTER TABLE "Quote" ALTER COLUMN "sortOrder" DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- 3. Drop the temporary DEFAULT on the two updatedAt columns the v2 schema
--    declares as bare @updatedAt.
--
--    Prisma's @updatedAt is client-side: the v2 client writes the column on
--    every create and every update, so the default is now dead scaffolding.
--
--    createdAt KEEPS its default on all three tables -- schema.prisma declares
--    @default(now()) for it.
--
--    ContactPurpose.updatedAt KEEPS its default -- schema.prisma declares
--    `updatedAt DateTime @default(now()) @updatedAt` on that model alone, to
--    match ContactMessage. Dropping it here is the single easiest way to make
--    `prisma migrate diff` come back non-empty for this cluster. It is absent
--    from the list below on purpose. Do not add it.
-- -----------------------------------------------------------------------------
ALTER TABLE "AboutParagraph" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Quote"          ALTER COLUMN "updatedAt" DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- 4. VERIFICATION, in-transaction.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE n bigint;
BEGIN
  -- W1. Exactly the three defaults that should be gone are gone, and exactly
  --     the four that should remain remain.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND column_default IS NULL
     AND (table_name, column_name) IN (
       ('Quote','sortOrder'), ('Quote','updatedAt'), ('AboutParagraph','updatedAt'));
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 dropped defaults, found %', n; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND column_default = 'CURRENT_TIMESTAMP'
     AND (table_name, column_name) IN (
       ('Quote','createdAt'), ('AboutParagraph','createdAt'),
       ('ContactPurpose','createdAt'), ('ContactPurpose','updatedAt'));
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 surviving CURRENT_TIMESTAMP defaults (3 createdAt + ContactPurpose.updatedAt), found %', n;
  END IF;

  -- W2. Still NOT NULL, still gap-free, nothing lost.
  SELECT count(*) INTO n FROM "Quote";
  IF (SELECT count(DISTINCT "sortOrder") FROM "Quote") <> n THEN
    RAISE EXCEPTION 'Quote.sortOrder has duplicates across % rows', n;
  END IF;

  -- W3. The three notes CHECKs survived.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype='c' AND convalidated
     AND conname IN ('NoteNode_self_parent_check','NoteNode_depth_check','NoteAnswer_confidence_check');
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 notes CHECKs, found %', n; END IF;
END
$verify$;

COMMIT;


-- =============================================================================
-- ROLLBACK
--
-- EXPAND, after COMMIT -- lossless, and runnable with v1 still live, because
-- nothing it added existed before:
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "NoteAnswer" DROP CONSTRAINT IF EXISTS "NoteAnswer_confidence_check";
--   ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_depth_check";
--   ALTER TABLE "NoteNode"   DROP CONSTRAINT IF EXISTS "NoteNode_self_parent_check";
--   ALTER TABLE "Quote"          DROP COLUMN IF EXISTS "sortOrder",
--                                DROP COLUMN IF EXISTS "createdAt",
--                                DROP COLUMN IF EXISTS "updatedAt";
--   ALTER TABLE "ContactPurpose" DROP COLUMN IF EXISTS "createdAt",
--                                DROP COLUMN IF EXISTS "updatedAt";
--   ALTER TABLE "AboutParagraph" DROP COLUMN IF EXISTS "createdAt",
--                                DROP COLUMN IF EXISTS "updatedAt";
--   COMMIT;
--
-- It discards the invented sortOrder sequence and the migration-clock stamps,
-- neither of which the v1 schema has anywhere to hold. No row content is lost.
-- Do NOT touch Education here -- its createdAt/updatedAt belong to
-- experience-education-expand.sql and dropping them from this file would take
-- that cluster's columns with them.
--
-- CONTRACT, after COMMIT -- one statement each, safe with either code version
-- deployed, and exactly what you run if you ever need to point v1,
-- packages/db/seed.ts or any of packages/db/scripts/* at this database again:
--
--   BEGIN;
--   ALTER TABLE "Quote"          ALTER COLUMN "sortOrder" SET DEFAULT 0;
--   ALTER TABLE "Quote"          ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   ALTER TABLE "AboutParagraph" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
--   COMMIT;
--
-- There is nothing in this cluster that a dump restore is the only undo for.
-- =============================================================================
