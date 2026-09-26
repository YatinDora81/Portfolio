-- ============================================================================
-- PRODUCTION EXPAND  ·  cluster: media-flags-reval-github
-- Run this with the LIVE SITE UP and the CURRENTLY DEPLOYED v1 CODE RUNNING.
-- Everything here is additive or a relaxation. No column is dropped, no type is
-- narrowed, no constraint is added that a v1 writer can violate.
--
-- Postgres 17 / Neon. Role is the database OWNER, not a superuser.
--
-- THIS FILE CARRIES ITS OWN TRANSACTION. One BEGIN below the header, one COMMIT
-- after the verification block, matching the other 21 files in this directory.
-- Do NOT wrap it in an outer BEGIN/COMMIT and do NOT pass psql
-- --single-transaction: the outer BEGIN turns the inner one into a
-- "there is already a transaction in progress" warning and the inner COMMIT
-- then commits the outer transaction, which is confusing rather than wrong.
-- Two things depend on the BEGIN being here rather than supplied by the caller:
--   * SET LOCAL lock_timeout / statement_timeout are a silent NO-OP outside a
--     transaction block (they only emit "WARNING: SET LOCAL can only be used in
--     transaction blocks"). "FeatureFlag" is on the public render path via
--     apps/web/app/lib/flags.ts:13 inside apps/web/app/layout.tsx:70, so the DDL
--     below running with NO lock timeout would let a blocked ACCESS EXCLUSIVE
--     request queue every subsequent FeatureFlag read behind it.
--   * the preflight P6 gate and the verification block are only worth anything
--     if a failure anywhere in the file leaves the database untouched.
-- The verification SELECTs therefore run INSIDE the transaction and COMMIT is
-- the last statement. Read the preflight in PASS 1 (RUNBOOK.md Stage 1), before
-- any DDL; the in-file DO $$ guards are what enforce it in PASS 2.
--
-- WHAT IS DELIBERATELY *NOT* HERE, and why (all four are in the contract file):
--   * FeatureFlag.label / .description DROP  — three deployed v1 admin pages
--     call prisma.featureFlag.findMany() with no `select`, so the v1 client
--     emits an explicit column list that names both columns:
--       git show HEAD:apps/docs/app/(dashboard)/flags/page.tsx        :23
--       git show HEAD:apps/docs/app/(dashboard)/site-config/page.tsx  :19
--       git show HEAD:apps/docs/app/(dashboard)/terminal/page.tsx     :46
--     Dropping either column returns 42703, which Prisma raises as P2022, and
--     all three force-dynamic server components 500.
--   * RevalidationTrigger 'SYSTEM' drop — needs a type recreation, and the
--     ALTER COLUMN TYPE rewrites RevalidationLog under ACCESS EXCLUSIVE while
--     two live writers can be mid-statement (the log INSERT at
--     HEAD:apps/docs/app/lib/revalidation.ts:79 and the retention DELETE at
--     HEAD:packages/db/src/maintenance.ts:163-177, which fires off a *visitor*
--     beacon at HEAD:apps/web/app/api/collect/route.ts:108). No v1 or v2 writer
--     emits SYSTEM, so the narrowing is never urgent. It waits.
--   * GithubYear_handle_fkey — the deployed v1 refresh queues its GithubYear
--     upserts BEFORE the GithubProfile upsert inside one $transaction
--     (HEAD:apps/web/app/lib/github.ts:146-161), and that refresh runs off
--     public traffic (HEAD:apps/web/app/page.tsx:120-134 fires it in after()
--     on any homepage ISR regeneration). See the contract file.
--   * The two index DROPs. Keeping EXPAND purely additive makes its rollback
--     free of anything that has to be rebuilt.
--   * MediaAsset.url is NOT dropped by this cutover at all. The v2 schema still
--     declares `url String` (packages/db/prisma/schema.prisma:598) and the v2
--     code still writes it (apps/docs/app/lib/actions/media.ts:227,
--     media-browser.ts:495 and :804). Its drop is a THIRD stage after a LATER
--     code deploy.
--   * MediaAsset_uploadedById / FeatureFlag_updatedById / RevalidationLog_actorId
--     foreign keys and their indexes belong to the admin-FK cluster (60), not
--     here. The four MediaAsset back-relations are FKs on Project /
--     ProjectImage / Experience / Blog and belong to those clusters.
--
-- ============================================================================
-- "HEAD:" IN THIS FILE MEANS COMMIT 0050cc9. IT NO LONGER MEANS `git HEAD`.
-- ============================================================================
-- Every v1 citation in this file was written when 0050cc9 was the tip. The v2
-- work has since been committed, so `git HEAD` is f760425 and `git show
-- HEAD:<path>` returns the v2 file — which inverts several arguments below.
-- Read every v1 claim with `git show 0050cc9:<path>` and nothing else. 0050cc9 is
-- what Vercel is serving while this file runs. Working-tree/v2 paths are cited
-- bare. The v1 evidence was re-checked that way on 2026-09-27; see the
-- spot-check block at the foot of this header.
--
-- ============================================================================
-- RUN ORDER: THIS FILE IS STEP 15 AND IT RUNS AFTER STEP 14. NOT BEFORE.
-- ============================================================================
-- Sections 2 and 3 below add "FeatureFlag"."updatedByName" and
-- "RevalidationLog"."actorName". So does contact-admin-audit-expand.sql T1
-- section 2, at Step 14, the step immediately before this one. Both ADDs are
-- IF NOT EXISTS, so this file finds the columns already there and reports
-- `ALTER TABLE` with no change. THAT IS THE EXPECTED OUTPUT, not a warning.
--
-- The backfill predicates are the thing that must not diverge, and there is one
-- rule, stated in contact-admin-audit-contract.sql's header (STEP 1) and now
-- honoured by all four files that touch these columns:
--
--   "FeatureFlag"."updatedByName"   MUTABLE      -> IS DISTINCT FROM. Repair.
--   "RevalidationLog"."actorName"   APPEND-ONLY  -> IS NULL. Fill, never repair.
--
-- Section 3's sweep used to be IS DISTINCT FROM for BOTH, which was wrong for
-- "actorName" and is fixed in this revision. "RevalidationLog" is a permanent
-- ledger — one row per revalidation, never re-attributed — and from Step 30
-- onward v2 writes the name at insert time
-- (apps/docs/app/lib/revalidation.ts:102). Re-deriving it from today's
-- "AdminUser"."name" therefore rewrites history rather than repairing it: after
-- an admin rename, every log row this sweep touches starts claiming the
-- revalidation was done under a name that did not exist at the time. During
-- EXPAND the two predicates select exactly the same rows (v1 never writes the
-- column, so every value is NULL), so this changes nothing about the forward run
-- and everything about a re-run.
--
-- WHAT ACTUALLY DEPENDS ON THE ORDER, honestly:
--   * NOT the data. Every sweep in both files INNER JOINs "AdminUser", and with
--     the predicates aligned the end state of a first forward run is identical in
--     either order. Anyone telling you the outcome flips has not traced it.
--   * The gate. Step 14's V6 asserts that all three names agree with their
--     "AdminUser" row. It is the earlier gate, so it is the one that stops the
--     night, and it is only satisfiable because Step 14's own "updatedByName"
--     sweep now repairs rather than fills. Running this file first does not break
--     that — it just moves the repair earlier — but it does mean Step 14's
--     preflight P1 ("the three name columns do not exist yet") returns rows and
--     the operator has lost a tripwire. Keep the documented order.
--   * The ROLLBACK, which is where the real hazard lives. The ROLLBACK block at
--     the foot of this file drops "updatedByName" and "actorName" — two columns
--     the Step 14 cluster also created and requires. Rolling back ONE cluster
--     silently disarms the other, and the v2 flags page
--     (apps/docs/app/(dashboard)/flags/page.tsx:43) and revalidation page (:145)
--     then throw P2022. R1 now opens with a fail-closed guard for exactly that.
--     Do not delete it.
--
-- ============================================================================
-- V1 EVIDENCE RE-VERIFIED AT 0050cc9        (spot check 4 of 5, 2026-09-27)
--
-- WHY THIS FILE IS ONE OF THE FIVE. It is the only EXPAND file that touches a
-- table on the PUBLIC render path with DDL that takes ACCESS EXCLUSIVE — twice,
-- on "FeatureFlag", at section 2's ADD COLUMN and DROP NOT NULL. It is also the
-- only EXPAND file that RELAXES a constraint (label's NOT NULL) and the only one
-- that ARMS a new CHECK against a live v1 writer (MediaAsset_folder_check).
--
-- RE-CHECKED WITH `git show 0050cc9:<path>`, NOT by reading the working tree:
--
--  1. THE PUBLIC READ PATH IS REAL, AND IT CANNOT 500. Both halves confirmed.
--       0050cc9:apps/web/app/layout.tsx:70          getFlags(),  inside a
--                                                   Promise.all in the ROOT layout
--       0050cc9:apps/web/app/lib/flags.ts:13        featureFlag.findMany({
--                                                     select: { key, enabled } })
--       0050cc9:apps/web/app/lib/flags.ts:15-17     catch -> return defaultFlagMap()
--     Three consequences, all load-bearing for this file's safety argument:
--       (a) the v1 public reader selects ONLY key and enabled. It never names
--           "label" or "description", so section 2's DROP NOT NULL and even the
--           contract file's DROP COLUMN are invisible to it.
--       (b) the read is wrapped in unstable_cache AND in a try/catch that falls
--           back to the registry defaults. A FAILED FeatureFlag read therefore
--           cannot take the public site down; the worst case is one render with
--           default flag values.
--       (c) but a BLOCKED read is not a failed read — it hangs, and the fallback
--           never runs. That is the whole reason lock_timeout = '3s' has to be in
--           effect here: it bounds how long OUR ACCESS EXCLUSIVE request waits,
--           and a queued request is what parks every public read behind it. This
--           is why the file carries its own BEGIN (see the top of the header):
--           SET LOCAL outside a transaction block sets nothing.
--
--  2. NO v1 WRITER CAN PUT A NULL IN "label", so relaxing its NOT NULL is inert
--     until v2 ships. CONFIRMED:
--       0050cc9:apps/docs/app/lib/actions/flags.ts:52  the only v1 UPDATE, and it
--         names enabled / updatedById / note — nothing else.
--       0050cc9:packages/db/scripts/seed-flags.ts:14-22  the only v1 INSERT, whose
--         upsert `create` always supplies label AND description.
--     The v1 ADMIN page does not render the stored label either — it takes it from
--     the registry (0050cc9:apps/docs/app/(dashboard)/flags/page.tsx:45
--     `label: def.label`), and resolves "changed by" through a separate
--     adminUser.findMany on "updatedById" (:36, :53) rather than through
--     "updatedByName". So v1 reads neither column this file adds nor the column
--     it relaxes.
--
--  3. THE FOLDER CHECK MATCHES EVERY v1 WRITER. All three key-touching paths
--     write "folder" from the same helper in the same statement. CONFIRMED:
--       0050cc9:apps/docs/app/lib/actions/media.ts:237-242
--         mediaAsset.upsert  create: { key, folder: folderOfKey(key), ... }
--       0050cc9:apps/docs/app/lib/actions/media-browser.ts:506
--         create: { key, folder: folderOfKey(key), uploadedById, ...shared }
--       0050cc9:apps/docs/app/lib/actions/media-browser.ts:802-804
--         updateMany data: { key: destination, url: ..., folder: folderOfKey(destination) }
--     There is no v1 path that writes "folder" without "key", and none that
--     inserts a row letting "folder" fall back to its DEFAULT. Preflight P1 and
--     the fail-closed P6 are what prove the same thing about the rows already
--     stored; do not run this file on P1's word alone.
--
--  4. THE scope BACKFILL'S SEMANTICS COME FROM THE ROUTE'S OWN BRANCH, not from a
--     guess. CONFIRMED at the exact lines:
--       0050cc9:apps/web/app/api/revalidate/route.ts:37  if (paths.length === 0
--                                                          && tags.length === 0) {
--       0050cc9:apps/web/app/api/revalidate/route.ts:39    revalidatePath("/", "layout")
--       0050cc9:apps/web/app/api/revalidate/route.ts:41-42 else per-path, per-tag
--     So empty+empty really does mean the whole site, which is what makes 'SITE'
--     lossless rather than a convention.
--
--  5. scope MUST BE NULLABLE WITH NO DEFAULT, and the reason is the swallowing
--     catch, not tidiness. CONFIRMED:
--       0050cc9:apps/docs/app/lib/revalidation.ts:79-92  the INSERT names 10
--         columns explicitly and neither new one
--       0050cc9:apps/docs/app/lib/revalidation.ts:109-110  catch { logger.error(...) }
--     A NOT NULL scope with no default would raise inside that try and silently
--     lose the log row AND the "TagState" upsert loop that follows it in the same
--     try (:93-107) — the cache-staleness detector's substrate. The failure would
--     be invisible in the admin and invisible in the response.
--
-- VERDICT: every statement in this file is safe against the code actually
-- deployed at 0050cc9, and one claim in the old header was understated rather
-- than wrong — the v1 public reader does not merely "never render" label, it
-- never selects it. Two things needed correcting: the `HEAD:` labels, and
-- section 3's backfill predicate.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';


-- ============================================================================
-- PREFLIGHT  (plain SELECTs; nothing here writes)
-- ============================================================================

-- P1. MediaAsset.folder already equals the derived prefix on every row, so the
--     CHECK below can be added VALID. Expression is a literal transcription of
--     folderOfKey (packages/storage/src/media.ts, `at === -1 ? "uploads"`).
--     EXPECTED: 0 rows.
SELECT "id", "key", "folder" AS "stored",
       COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads') AS "derived"
  FROM "MediaAsset"
 WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads');

-- P2. Neither new name is taken, and the four objects EXPAND creates are absent.
--     EXPECTED: 0 rows.
SELECT 'MediaAsset_key_prefix_idx' AS "object"
 WHERE EXISTS (SELECT 1 FROM "pg_class" WHERE "relname" = 'MediaAsset_key_prefix_idx')
UNION ALL
SELECT 'MediaAsset_folder_check'
 WHERE EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'MediaAsset_folder_check')
UNION ALL
SELECT 'RevalidationScope'
 WHERE EXISTS (SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
                WHERE t."typname" = 'RevalidationScope' AND n."nspname" = current_schema())
UNION ALL
SELECT 'RevalidationLog.scope'
 WHERE EXISTS (SELECT 1 FROM "information_schema"."columns"
                WHERE "table_schema" = current_schema()
                  AND "table_name" = 'RevalidationLog' AND "column_name" = 'scope');

-- P3. Both denormalisation sources resolve. data-facts.txt: 1 distinct
--     updatedById, 1 distinct actorId, orphans none on both.
--     EXPECTED: 1 row — 0 | 0
SELECT (SELECT count(*) FROM "FeatureFlag" f
         WHERE f."updatedById" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = f."updatedById")) AS "orphanFlagActors",
       (SELECT count(*) FROM "RevalidationLog" l
         WHERE l."actorId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "AdminUser" a WHERE a."id" = l."actorId")) AS "orphanLogActors";

-- P4. THE PAPER RECORD of what the contract file will destroy. Keep this output
--     in the run log. For the nine FLAG_DEFINITIONS keys these values are
--     reproducible from packages/shared/src/flags.ts; for any other key they
--     are not, and this is the only copy.
SELECT "key", "label", "description",
       ("key" NOT IN ('section.about','section.skills','section.experience',
                      'section.projects','section.blogs','section.contact',
                      'contact.form','analytics.enabled','easter-eggs.enabled')) AS "offRegistry"
  FROM "FeatureFlag" ORDER BY "key";

-- P5. Row counts, for the verification block. RevalidationLog is NOT frozen:
--     the retention prune (maintenance.ts:163-177) can delete rows at any
--     moment off a visitor beacon, so treat its count as a bound.
SELECT (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
       (SELECT count(*) FROM "FeatureFlag")     AS "flags",
       (SELECT count(*) FROM "RevalidationLog") AS "logs",
       (SELECT count("updatedById") FROM "FeatureFlag")     AS "flagsWithActor",
       (SELECT count("actorId") FROM "RevalidationLog")     AS "logsWithActor";

-- P6. Fail-closed gate on the one condition that would abort a statement below.
DO $$
DECLARE "bad" bigint;
BEGIN
  SELECT count(*) INTO "bad" FROM "MediaAsset"
   WHERE "folder" <> COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads');
  IF "bad" > 0 THEN
    RAISE EXCEPTION 'EXPAND aborted: % MediaAsset row(s) whose folder is not the prefix of key (preflight P1). Repair the rows; do not weaken the CHECK.', "bad";
  END IF;
END $$;

-- P7. THE RUN-ORDER GATE. Fail-closed, and it is what enforces "Step 14 before
--     Step 15" rather than merely asserting it in prose.
--
--     Sections 2 and 3 share two columns with contact-admin-audit-expand.sql
--     (Step 14) — see RUN ORDER in this file's header. This gate does not test
--     for the columns, because both files create them with IF NOT EXISTS and
--     either could have. It tests for the two foreign keys that only Step 14's T1
--     creates, and it tests for them rather than for T1's first statement because
--     they are the LAST thing T1 does before its COMMIT: if both are present, T1
--     committed in full.
--
--     Why abort rather than warn. Running this file first is not destructive, but
--     it costs Step 14 its own tripwire — Step 14's preflight P1 asserts that the
--     three name columns "do not exist yet", which is the only check either file
--     has that would catch EXPAND being replayed over a database that has already
--     had it. Losing that silently, mid-window, is not a trade worth making for
--     the convenience of running two files in the wrong order. The fix is one
--     command: run Step 14, then come back. Nothing here has to be undone first —
--     this gate is the first thing in the transaction that could fail, and it
--     fails before any DDL.
--
--     The converse direction is NOT enforced this way on purpose.
--     contact-admin-audit-expand.sql does not abort when it finds THIS cluster
--     already applied, because if the order has already slipped, that file still
--     MUST run (it owns the AdminUser columns, the five FKs and the enum pass) and
--     aborting it would strand the operator mid-window with no forward path. It
--     carries a documented order note instead, plus a hard guard on the one place
--     the order is genuinely destructive: its rollback.
DO $$
DECLARE "missing" text;
BEGIN
  SELECT string_agg("n", ', ' ORDER BY "n") INTO "missing"
    FROM (VALUES ('FeatureFlag_updatedById_fkey'), ('RevalidationLog_actorId_fkey')) AS "t"("n")
   WHERE NOT EXISTS (SELECT 1 FROM "pg_constraint"
                      WHERE "conname" = "t"."n" AND "contype" = 'f'
                        AND "connamespace" = current_schema()::regnamespace);
  IF "missing" IS NOT NULL THEN
    RAISE EXCEPTION 'EXPAND aborted: out of order. contact-admin-audit-expand.sql (RUNBOOK Step 14) has not committed its T1 — missing foreign key(s): %. Run Step 14 first, then re-run this file. Nothing has been applied; this gate runs before any DDL.', "missing";
  END IF;
END $$;


-- ============================================================================
-- 1. MediaAsset  ·  prefix index + folder CHECK
--
-- v1 IMPACT: none. The index is invisible to the application. The CHECK is
-- satisfied by every v1 write, verified exhaustively against all 14 v1
-- prisma.mediaAsset call sites in HEAD:
--   INSERT paths — both supply folder: folderOfKey(key):
--     HEAD:apps/docs/app/lib/actions/media.ts:237-245         (saveUpload create)
--     HEAD:apps/docs/app/lib/actions/media-browser.ts:504-507 (adopt create)
--   UPDATE paths that touch key — writes key and folder together:
--     HEAD:apps/docs/app/lib/actions/media-browser.ts:802-805 (relocate)
--   UPDATE paths that touch neither key nor folder (CHECK re-evaluated, passes):
--     media.ts:237 update branch (`update: shared`, no key/folder),
--     media.ts:339 (altText), media-browser.ts:935 (filename)
--   There is no v1 path that writes folder without key, and none that inserts
--   a row letting folder fall back to its DEFAULT 'uploads'.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "MediaAsset_key_prefix_idx"
  ON "MediaAsset" ("key" text_pattern_ops);
-- Not CONCURRENTLY: 2 rows, and CONCURRENTLY cannot run inside this
-- transaction. The ACCESS EXCLUSIVE window is microseconds.
-- NOTE: Prisma emits this same form for
-- @@index([key(ops: raw("text_pattern_ops"))], map: "MediaAsset_key_prefix_idx")
-- but `prisma migrate diff` reports text_pattern_ops indexes as pending
-- forever regardless; that is known drift, not a failure of this file.

ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_folder_check"
  CHECK ("folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads'));
-- Added VALID (2 rows, scan is free). Prisma cannot express a CHECK, so this
-- object never appears in target-ddl.sql and must be carried by hand forever.
-- Residual, accepted: if a writer ever did violate it, the failure is a raw
-- 23514 AFTER the bytes are already in R2 (the presigned PUT precedes
-- saveUpload), leaving a re-adoptable orphan object — not data loss.


-- ============================================================================
-- 2. FeatureFlag  ·  updatedByName, + relax label's NOT NULL
--
-- v1 IMPACT: none.
--   * The only v1 UPDATE names enabled / updatedById / note and nothing else
--     (HEAD:apps/docs/app/lib/actions/flags.ts:48-55), so it cannot collide
--     with a new column.
--   * The only v1 INSERT is the seed's upsert create, which always supplies
--     label (HEAD:packages/db/scripts/seed-flags.ts:14-22), so relaxing the
--     NOT NULL cannot let a NULL label appear while v1 is deployed. v1's reads
--     select label but never render it — the page takes its label from
--     FLAG_DEFINITIONS (HEAD:.../flags/page.tsx:41).
-- WHY relax label at all: the v2 seed inserts without it
-- (packages/db/scripts/seed-flags.ts:19, `create({ data: { key, enabled } })`).
-- Leaving label NOT NULL would make that seed fail 23502 in the whole gap
-- between DEPLOY and CONTRACT.
-- ============================================================================

-- SHARED WITH STEP 14. contact-admin-audit-expand.sql T1 section 2 adds this same
-- column, so on the documented run order the ADD is a no-op here and reports
-- `ALTER TABLE` with no change — expected, not a warning. See RUN ORDER in this
-- file's header; preflight P7 is what enforces it.
ALTER TABLE "FeatureFlag" ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

-- MUTABLE COLUMN: IS DISTINCT FROM, so a STALE name is repaired and not merely a
-- missing one. A flag is toggled repeatedly and this column means "who last
-- changed it"; the v1 toggle moves "updatedById" without moving the name
-- (0050cc9:apps/docs/app/lib/actions/flags.ts:52 sets only the id), so with more
-- than one admin the copy goes stale during the window. INNER JOIN, so the v2
-- row that legitimately holds `session.email` rather than a name
-- (apps/docs/app/lib/actions/flags.ts:56-57, which also nulls "updatedById") is
-- never joined and never overwritten. Contrast section 3, which is append-only.
UPDATE "FeatureFlag" f
   SET "updatedByName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = f."updatedById"
   AND f."updatedByName" IS DISTINCT FROM a."name";

ALTER TABLE "FeatureFlag" ALTER COLUMN "label" DROP NOT NULL;


-- ============================================================================
-- 3. RevalidationLog  ·  RevalidationScope + scope + actorName
--
-- v1 IMPACT: none.
--   * The v1 INSERT names 10 columns explicitly
--     (HEAD:apps/docs/app/lib/revalidation.ts:79-92), so both new columns are
--     simply omitted and take NULL. This is the whole reason `scope` is
--     nullable with no default: that INSERT sits inside a try whose catch
--     swallows everything (HEAD:.../revalidation.ts:109-111), so a NOT NULL
--     column with no default would silently lose the log row AND the TagState
--     upsert loop that follows it in the same try.
--   * Every v1 read lists only v1 columns, so added columns are invisible:
--     readRecentLogs   HEAD:apps/docs/app/lib/revalidation.ts:171
--     readHealth       HEAD:apps/docs/app/lib/revalidation.ts:134,139
--     stale detector   HEAD:apps/docs/app/lib/stale.ts:24 (select createdAt)
--     retention prune  HEAD:packages/db/src/maintenance.ts:167-175 (raw SQL,
--                      names only "id" and "createdAt")
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_type" t JOIN "pg_namespace" n ON n."oid" = t."typnamespace"
     WHERE t."typname" = 'RevalidationScope' AND n."nspname" = current_schema()
  ) THEN
    CREATE TYPE "RevalidationScope" AS ENUM ('SITE', 'TAGS', 'PATHS', 'MIXED');
  END IF;
END $$;

-- "scope" is this cluster's alone. "actorName" is SHARED WITH STEP 14
-- (contact-admin-audit-expand.sql T1 section 2), so on the documented run order
-- only the "scope" half of this statement does anything. See RUN ORDER in the
-- header, and note that the ROLLBACK block's R1 drops the two in one statement —
-- which is why R1 carries a guard.
ALTER TABLE "RevalidationLog"
  ADD COLUMN IF NOT EXISTS "scope" "RevalidationScope",
  ADD COLUMN IF NOT EXISTS "actorName" TEXT;

-- Backfill scope. Lossless because the public route's own branch defines the
-- meaning: HEAD:apps/web/app/api/revalidate/route.ts:37-38 treats
-- paths=[] AND tags=[] as revalidatePath('/', 'layout') = whole site; :40-43
-- honours per-path and per-tag otherwise. COALESCE around cardinality()
-- because both array columns are nullable TEXT[] with no default.
UPDATE "RevalidationLog"
   SET "scope" = CASE
     WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
     WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
     WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
     ELSE                                                                                     'TAGS'
   END::"RevalidationScope"
 WHERE "scope" IS NULL;

-- APPEND-ONLY COLUMN: IS NULL, NOT IS DISTINCT FROM. "RevalidationLog" is a
-- permanent ledger — one row per revalidation, never re-attributed — so a
-- non-NULL "actorName" is the name as of that event and is correct by definition.
-- From Step 30 onward v2 supplies it at insert time
-- (apps/docs/app/lib/revalidation.ts:102), so a repairing sweep would not repair
-- anything; it would rewrite history, restamping every past revalidation with
-- today's "AdminUser"."name". During EXPAND the two predicates select exactly the
-- same rows, because no v1 writer touches the column
-- (0050cc9:apps/docs/app/lib/revalidation.ts:79-92 names ten columns and neither
-- new one), so this costs the forward run nothing.
--
-- The one column in this cluster that DOES want a repair is "updatedByName"
-- above, because a flag is toggled repeatedly and the column means "who last
-- changed it". The rule and its four-file provenance are in RUN ORDER in this
-- file's header; contact-admin-audit-contract.sql STEP 1 is where it is stated
-- canonically.
UPDATE "RevalidationLog" l
   SET "actorName" = a."name"
  FROM "AdminUser" a
 WHERE a."id" = l."actorId"
   AND l."actorName" IS NULL;


-- ============================================================================
-- VERIFICATION  (run before COMMIT)
-- ============================================================================

-- V1. The prefix index exists WITH the opclass. Without text_pattern_ops it is
--     a useless duplicate of MediaAsset_key_key.
--     EXPECTED: 1 row, indexdef containing "text_pattern_ops".
SELECT "indexname", "indexdef" FROM "pg_indexes"
 WHERE "schemaname" = current_schema() AND "indexname" = 'MediaAsset_key_prefix_idx';

-- V2. The CHECK exists and is convalidated = t (rows verified, not trusted).
--     EXPECTED: 1 row, convalidated = t.
SELECT c."conname", pg_get_constraintdef(c."oid") AS "definition", c."convalidated"
  FROM "pg_constraint" c
 WHERE c."conrelid" = '"MediaAsset"'::regclass AND c."contype" = 'c';

-- V3. And it holds on data. EXPECTED: 1 row — 2 | 2
SELECT count(*) AS "rows",
       count(*) FILTER (WHERE "folder" = COALESCE(NULLIF(regexp_replace("key", '/[^/]*$', ''), "key"), 'uploads')) AS "folderMatches"
  FROM "MediaAsset";

-- V4. FeatureFlag shape. EXPECTED: 9 rows (the original 8 plus updatedByName:
--     createdAt, description, enabled, key, label, note, updatedAt, updatedById,
--     updatedByName). label is now is_nullable = YES,
--     description YES, updatedByName text / YES / (null). Nothing dropped.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'FeatureFlag'
 ORDER BY "column_name";

-- V5. Both denormalisations landed. EXPECTED: 0 rows from each.
--
--     INNER JOIN, not LEFT JOIN, and the two halves ask DIFFERENT questions. The
--     old form was a LEFT JOIN with IS DISTINCT FROM on both, which produced two
--     false positives that the design deliberately creates:
--       * a row whose actor has been deleted keeps its name and loses its id, so
--         a LEFT JOIN gave a."name" = NULL and flagged the very row these columns
--         exist to preserve;
--       * "FeatureFlag" rows written by v2 when the admin account is gone hold
--         `session.email` by design (apps/docs/app/lib/actions/flags.ts:57
--         `actor?.name ?? session.email`) with a NULL "updatedById", and were
--         flagged the same way.
--     Both arms now match contact-admin-audit-contract.sql's verification block
--     exactly, which is the canonical form.
--
--     "FeatureFlag" is checked for AGREEMENT (mutable column, this file repairs
--     it). "RevalidationLog" is checked only for a MISSING name (append-only
--     column, this file fills it and must never re-derive it). A stale-looking
--     name on a log row is not a defect and must not be "fixed" — see the note
--     above section 3's sweep.
SELECT 'FeatureFlag' AS "table", f."key" AS "row", f."updatedById" AS "actorId", f."updatedByName" AS "name", a."name" AS "adminName"
  FROM "FeatureFlag" f JOIN "AdminUser" a ON a."id" = f."updatedById"
 WHERE f."updatedByName" IS DISTINCT FROM a."name"
UNION ALL
SELECT 'RevalidationLog', l."id", l."actorId", l."actorName", NULL
  FROM "RevalidationLog" l
 WHERE l."actorId" IS NOT NULL AND l."actorName" IS NULL;

-- V6. Scope is complete and self-consistent. EXPECTED: 0 rows.
SELECT "id", "scope"::text AS "scope",
       COALESCE(cardinality("paths"), 0) AS "pathCount", COALESCE(cardinality("tags"), 0) AS "tagCount"
  FROM "RevalidationLog"
 WHERE "scope" IS NULL
    OR "scope" <> CASE
         WHEN COALESCE(cardinality("paths"), 0) = 0 AND COALESCE(cardinality("tags"), 0) = 0 THEN 'SITE'
         WHEN COALESCE(cardinality("paths"), 0) > 0 AND COALESCE(cardinality("tags"), 0) > 0 THEN 'MIXED'
         WHEN COALESCE(cardinality("paths"), 0) > 0                                          THEN 'PATHS'
         ELSE                                                                                     'TAGS'
       END::"RevalidationScope";

-- V7. Scope histogram. EXPECTED: SITE and TAGS only. A PATHS or MIXED row means
--     the fact base is wrong about the writers (no repo caller passes paths).
SELECT "scope"::text AS "scope", count(*) AS "rows" FROM "RevalidationLog" GROUP BY 1 ORDER BY 1;

-- V8. Nothing was lost and no old object was touched. EXPECTED: MediaAsset 2,
--     FeatureFlag = P5, RevalidationLog >= P5 minus whatever the prune removed;
--     RevalidationTrigger still has 5 labels including SYSTEM; the two indexes
--     the contract file drops are still present; GithubYear_handle_fkey absent.
SELECT (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
       (SELECT count(*) FROM "FeatureFlag")     AS "flags",
       (SELECT count(*) FROM "RevalidationLog") AS "logs",
       (SELECT count(*) FROM "pg_enum" e JOIN "pg_type" t ON t."oid" = e."enumtypid"
         WHERE t."typname" = 'RevalidationTrigger')                       AS "triggerLabels",
       (SELECT count(*) FROM "pg_class"
         WHERE "relname" IN ('MediaAsset_folder_createdAt_idx',
                             'RevalidationLog_entityType_entityId_idx'))  AS "indexesStillThere",
       (SELECT count(*) FROM "pg_constraint"
         WHERE "conname" = 'GithubYear_handle_fkey')                      AS "githubFkYet";


COMMIT;


-- ============================================================================
-- ROLLBACK  (after COMMIT)
--
-- R1. One transaction. Everything except label's NOT NULL, in this order:
--
--     READ THIS BEFORE YOU PASTE. "actorName" and "updatedByName" are NOT this
--     cluster's alone — contact-admin-audit-expand.sql T1 section 2 (Step 14)
--     creates them too and the v2 code requires them
--     (apps/docs/app/(dashboard)/flags/page.tsx:43,
--     apps/docs/app/(dashboard)/revalidation/page.tsx:145 — P2022 without them).
--     Dropping them here while that cluster is still applied silently disarms it.
--     The guard below is the first statement inside the transaction, so a fire
--     rolls the whole undo back rather than half-landing it. If it fires you have
--     two correct answers: undo Step 14's T1 as well, or drop only this cluster's
--     own objects and leave the two shared columns in place — they are nullable,
--     unread by v1, and cost nothing. Deleting the guard is not a third answer.
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM "information_schema"."columns"
--                WHERE "table_schema" = current_schema()
--                  AND "table_name" = 'AdminUser' AND "column_name" = 'otpAttempts') THEN
--       RAISE EXCEPTION 'R1 aborted: contact-admin-audit-expand.sql (Step 14) is still applied — "AdminUser"."otpAttempts" exists. This undo would drop "actorName" and "updatedByName", which that cluster also owns and v2 requires. Undo Step 14 T1 first, or drop only this cluster''s own objects (scope, RevalidationScope, MediaAsset_folder_check, MediaAsset_key_prefix_idx) and keep the two shared columns.';
--     END IF;
--   END $$;
--   ALTER TABLE "RevalidationLog" DROP COLUMN IF EXISTS "scope",
--                                 DROP COLUMN IF EXISTS "actorName";
--   DROP TYPE IF EXISTS "RevalidationScope";   -- must follow the DROP COLUMN
--   ALTER TABLE "FeatureFlag" DROP COLUMN IF EXISTS "updatedByName";
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
--   DROP INDEX IF EXISTS "MediaAsset_key_prefix_idx";
--   COMMIT;
--
--     The shared-column-safe variant, for when the guard fires and you want only
--     this cluster gone:
--
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   ALTER TABLE "RevalidationLog" DROP COLUMN IF EXISTS "scope";
--   DROP TYPE IF EXISTS "RevalidationScope";
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_folder_check";
--   DROP INDEX IF EXISTS "MediaAsset_key_prefix_idx";
--   COMMIT;
--
-- R2. Then, and separately, because restoring NOT NULL can need a process that
--     is not psql:
--
--   SELECT count(*) AS "nullLabels" FROM "FeatureFlag" WHERE "label" IS NULL;
--
--     0  — the normal answer. Go straight to R4.
--   > 0  — the v2 seed ran in the gap. Do R3 first.
--
-- R3. Restore the real text, then mop up whatever is left. Two sources, and the
--     FIRST is better because it covers off-registry keys, which the seed will
--     not touch:
--
--     (a) the Step 7 or Step 38 dump, via the generator RUNBOOK.md Step 8b
--         rehearses. Nothing in this file drops "label", so the column is still
--         there and a plain UPDATE is all it takes:
--
--           cd packages/db
--           jq -r -f v2-production/recover-from-dump.jq \
--              --arg table FeatureFlag --arg key key \
--              --arg cols 'label,description' --arg mode update \
--              backups/PRE-CUTOVER-<stamp>.json \
--              > /tmp/v2/prod/recover-flag-labels.sql
--           # read it, then apply it the way you applied this file
--
--     (b) the v1 seed, for the nine FLAG_DEFINITIONS keys only — see the note
--         below, and note the mandatory DATABASE_URL override.
--
--     Then, whichever you used:
--
--   BEGIN;
--   SELECT "key" FROM "FeatureFlag" WHERE "label" IS NULL;            -- read this
--   UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL;   -- mop-up
--   COMMIT;
--
-- R4. BEGIN; ALTER TABLE "FeatureFlag" ALTER COLUMN "label" SET NOT NULL; COMMIT;
--
-- Do NOT put R4 in the same transaction as R1: if R2 is non-zero, R4 raises
-- 23502 and takes the whole rollback with it, which is exactly the failure this
-- ordering exists to avoid.
--
-- The UPDATE is a guard, not an expectation: no v1 writer can produce a NULL
-- label, so it should affect 0 rows. If it affects any, the v2 seed ran in the
-- gap. Restore the real text FIRST, then let the UPDATE mop up whatever the seed
-- or the dump cannot reach (a flag created after the dump), then restore NOT
-- NULL. On R3 option (b): `flags:seed` resolves its connection
-- through packages/db/src/index.ts:1,5 (dotenv/config + process.env.DATABASE_URL)
-- and local DATABASE_URL points at the throwaway Neon child branch, so the
-- DATABASE_URL override is mandatory — without it you seed the branch and leave
-- production's labels NULL:
--     git stash && git checkout 0050cc9 -- packages/db packages/shared
--     cd packages/db && DATABASE_URL="$PGPROD" bun run db:generate
--     DATABASE_URL="$PGPROD" bun run flags:seed
-- 0050cc9 is the deployed v1 commit; its seed upserts label + description
-- (0050cc9:packages/db/scripts/seed-flags.ts:14-23) where the v2 seed writes
-- neither (HEAD:packages/db/scripts/seed-flags.ts:19-22). The generated client is
-- gitignored (.gitignore, `**/generated/prisma`), which is why db:generate has to
-- run again on the v1 tree. The v1 seed leaves off-registry keys alone by design
-- (0050cc9:.../seed-flags.ts:37-42), so their labels stay NULL and the guard
-- UPDATE is what keeps SET NOT NULL from raising 23502 on them.
--
-- Nothing in this file destroys anything, so its rollback needs no dump for the
-- SHAPE. That is the point of keeping EXPAND additive. The dump appears above
-- only for the one value this file cannot itself have lost — a label the *v2
-- seed* overwrote with NULL after DEPLOY — and it is a plain UPDATE of a column
-- that still exists, not a reconstruction.
-- ============================================================================
