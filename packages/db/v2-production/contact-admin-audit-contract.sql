-- =============================================================================
-- cluster: contact-admin-audit          STAGE 2 of 2: CONTRACT
-- target: PRODUCTION (Neon, Postgres 17, role = database owner, not superuser)
--
-- DO NOT RUN THIS UNTIL v2 IS DEPLOYED AND CONFIRMED SERVING.
-- "Confirmed" means all four of these, in this order:
--   1. The Vercel deployment for the commit that carries the v2 schema is READY
--      (not "Building", not the previous deployment still aliased). Check the
--      deployment id, not just that the site loads — ISR means the OLD HTML keeps
--      serving from cache for a long time after a deploy, so a working homepage
--      proves nothing about which code is running.
--   2. https://yatindora.in/api/contact accepts a submission. That is the ONE
--      public write path in this cluster and the only reason "read" cannot be
--      dropped earlier.
--   3. The admin's /messages page loads, a message detail pane opens, and
--      mark-read / mark-unread / bulk archive all work. Those are the v1 readers
--      and writers of "read"; if any of them still throws, the deployed code is
--      not v2.
--   4. The admin's /flags and /revalidation pages load and show a NAME, not a
--      uuid, in the "changed by" / "actor" columns. That proves the deployed code
--      is reading updatedByName / actorName, which EXPAND added.
-- Until all four hold, this file's step 3 will take the public contact form down.
--
-- =============================================================================
-- WHAT IS IN HERE, AND WHY EACH PIECE COULD NOT GO IN EXPAND
-- =============================================================================
--
--  STEP 1  Re-sweep the three denormalised name columns.
--          Not a removal — a cleanup of the EXPAND->DEPLOY window. v1 writes none
--          of the three name columns, so every MessageReply and RevalidationLog
--          row v1 inserted during the window has a NULL name, and every
--          FeatureFlag row v1 toggled during the window moved "updatedById"
--          without moving "updatedByName" (apps/docs/app/lib/actions/flags.ts:48-55
--          at HEAD sets only the id). The visible symptom is a uuid where a name
--          should be, at apps/docs/app/(dashboard)/revalidation/page.tsx:145
--          (`actor: l.actorName ?? l.actorId`).
--          The FeatureFlag sweep is guarded on IS DISTINCT FROM, not IS NULL, so
--          it repairs a STALE name as well as a missing one. Both other sweeps
--          stay IS NULL-guarded because their rows are append-only, so a
--          non-NULL value there is already correct and a re-sync would only risk
--          overwriting it.
--          All three joins require the AdminUser row to exist, so a row whose
--          actor has since been deleted (id NULL, name preserved) is never
--          touched. That is the whole point of the columns.
--
--  STEP 2  DROP INDEX "AuditChange_entity_rowId_idx".
--          Safe under BOTH versions, so it could have gone in EXPAND; it is here
--          because it buys v2 nothing and removals belong together. It is not in
--          the v2 schema (packages/db/prisma/schema.prisma:518-519 declares only
--          @@index([eventId, seq])), so leaving it behind is drift.
--          Nothing queries [entity, rowId]: the only child read is
--          apps/docs/app/lib/actions/history.ts:18, which filters on eventId.
--          Cost, stated plainly: this is the only index that could ever answer
--          "show me everything that ever happened to this row", which is the
--          obvious next feature for a change log. One CREATE INDEX brings it back.
--
--  STEP 3  ALTER TABLE "ContactMessage" DROP COLUMN "read".
--          THE ONLY CHANGE IN THIS CLUSTER THAT CANNOT BE ADDITIVE, and the only
--          information-destroying statement in either file. Everything below is
--          about this one line.
--
-- =============================================================================
-- WHY "read" CANNOT BE DROPPED WHILE v1 IS DEPLOYED
-- =============================================================================
--
-- Prisma names every column explicitly in both directions, generated from the
-- CLIENT's schema. A column the client's schema still declares but the database
-- no longer has appears in the SQL and the statement fails (P2022 / 42703
-- undefined_column). So a drop breaks a v1 SELECT as surely as a v1 INSERT.
--
-- SEVEN v1 WRITE SITES. Each of these names "read" inside a Prisma `data` object
-- at git HEAD, so each starts failing the instant the column goes:
--   apps/docs/app/lib/actions/messages.ts:30   markMessageRead
--        data: { status: "READ", read: true, readAt: new Date() }
--   apps/docs/app/lib/actions/messages.ts:40   markMessageUnread
--        data: { status: "UNREAD", read: false, readAt: null }
--   apps/docs/app/lib/actions/messages.ts:85   bulk "inbox", the replied half
--   apps/docs/app/lib/actions/messages.ts:89   bulk "inbox", the read half
--   apps/docs/app/lib/actions/messages.ts:106  bulk archive / spam / read
--        read: readFor(next)          <-- the draft's write-site list misses this one
--   apps/docs/app/lib/actions/messages.ts:178  sendMessageReply, on a successful send
--   apps/web/app/api/contact/route.ts:182      the PUBLIC contact form
--        read: verdict.isSpam
--
-- THREE v1 READ SITES, none of which passes a `select`, so Prisma emits the whole
-- v1 column list including "read":
--   apps/web/app/api/contact/route.ts:220   contactMessage.update({ data: {
--        notificationMessageId } }) with no select -> RETURNING every column.
--        It is inside after() + try/catch, so the visitor is unaffected; the cost
--        is that the Gmail threading id is silently lost.
--   apps/docs/app/(dashboard)/dashboard/page.tsx:32   findMany, no select ->
--        the admin dashboard throws.
--   apps/docs/app/(dashboard)/messages/page.tsx:79    findUnique with
--        include: { replies } and no select -> the message detail pane throws.
--
-- THE PUBLIC CONSEQUENCE, which is what makes this CONTRACT-only rather than
-- "acceptable admin downtime": route.ts:174's create names "read" in `data`, so
-- POST /api/contact raises, the bare `catch` at route.ts:234 swallows it, and
-- every visitor who submits the contact form gets
-- `{ error: "Failed to send message" }` with HTTP 500. No log, no retry, no
-- record. That is public breakage with silent data loss for as long as the
-- window lasts.
--
-- ISR DOES NOT HELP HERE AND SLIGHTLY HURTS. Cached HTML protects READ paths: a
-- statically served page keeps rendering from cache after a schema change. But
-- /api/contact is a route handler, not a cached page, so it is hit live on every
-- submission and gets no protection at all. And on the read side ISR makes the
-- failure LATER AND STRANGER rather than smaller: the page that would break
-- serves stale HTML until something revalidates it, and then regenerates against
-- a schema its code no longer matches. A drop whose breakage is hidden by cache
-- is worse than one that fails immediately, because you find out at a
-- revalidation you did not schedule.
--
-- WHY "read" IS SAFE TO DROP ONCE v2 IS LIVE:
--   * ZERO READERS, at HEAD and in the working tree. Every badge and count
--     already uses "status": apps/docs/app/(dashboard)/layout.tsx:31 and
--     dashboard/page.tsx:30 both count `{ where: { status: "UNREAD" } }`. The
--     comment at apps/web/app/api/contact/route.ts:181 calling it the "legacy
--     column, drives the unread badge" is simply wrong, and v2 deletes both the
--     comment and the write.
--   * ITS INFORMATION IS ALREADY IN "status". 20260822110000_add_inbox_workflow
--     backfilled status from it and every writer since has set the pair together
--     in one `data` object. P1 below asserts that lockstep on the live rows
--     before the drop, so the drop provably loses no distinction.
--   * v2 writes none of the seven sites above: messages.ts:28/38/85/89/104/176
--     and contact/route.ts:175-187 in the working tree set only status/readAt/
--     repliedAt.
--
-- NO "readAt" BACKFILL ACCOMPANIES THIS, and none should be added. It is not
-- needed (data-facts.txt: "readAt null & status<>UNREAD: 0", re-asserted as P2),
-- and the obvious COALESCE("readAt","updatedAt") form would invent an opened-time
-- for rows nobody opened: SPAM messages are created with status=SPAM and readAt
-- NULL (contact/route.ts:180-182), and bulk archive never sets readAt
-- (messages.ts:107 sets it only for action === "read"). The detail pane would
-- print "opened 14:32" for a message that was never opened.
--
-- =============================================================================
-- DELIBERATELY NOT DROPPED HERE. Naming them so the gap is visible rather than
-- assumed, because `prisma migrate diff` against schema.prisma will NOT be empty
-- on these tables until the media-flags-reval cluster's CONTRACT also runs:
--   * "FeatureFlag"."label" (NOT NULL) and "FeatureFlag"."description".
--   * "RevalidationLog"."entityType"/"entityId" and
--     "RevalidationLog_entityType_entityId_idx"; the dead 'SYSTEM' label on
--     "RevalidationTrigger" (a type rebuild, emphatically not this cluster's job).
--   * "MediaAsset_folder_createdAt_idx", "TrackedLink_channel_createdAt_idx",
--     "TrackedLink_active_createdAt_idx".
-- And nothing here renames the "AdminUser"."username" unique index: that index
-- was created outside migration history, so its NAME is not provable from this
-- repo. It belongs to the migration-history repair, not to a contract stage.
--
-- TRANSACTIONALITY. One transaction. Every statement is transactional. DROP
-- COLUMN does not rewrite the table — Postgres only marks the attribute dropped —
-- so step 3 is O(1) regardless of how large "ContactMessage" gets, and takes
-- ACCESS EXCLUSIVE only for the catalog update. DROP INDEX takes ACCESS EXCLUSIVE
-- on "AuditChange" for the same instant. Not CONCURRENTLY, precisely because that
-- cannot run inside a transaction and the table is tiny.
--
-- IDEMPOTENCY, and a deliberate exception. Step 1's UPDATEs and step 2's DROP
-- INDEX IF EXISTS re-run as no-ops. Step 3 is DROP COLUMN IF EXISTS, so it also
-- re-runs — but P1, P2 and V3 all name "read" and will raise 42703
-- undefined_column on a second pass. That is a feature: it is how a re-run tells
-- you the drop already happened. P0 answers the same question without erroring,
-- which is why it is first.
--
-- =============================================================================
-- PREFLIGHT
-- =============================================================================

-- P0. Does "read" still exist, and what exactly is its definition? Run this
--     FIRST; it is the only shape check that cannot error. It also captures the
--     definition the rollback has to reproduce byte for byte.
--     EXPECTED: 1 row, boolean / NO / false.
--     Zero rows means step 3 already ran; skip to V1/V2 and stop.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'ContactMessage' AND "column_name" = 'read';

-- P1. THE LICENCE FOR THE DROP. "read" and "status" must agree on every row, or
--     the boolean is carrying something "status" does not and the drop is lossy.
--     EXPECTED: disagreements = 0. readTrue = 9 plus whatever the inbox has done
--     since the dump (data-facts.txt: "ContactMessage read=true: 9").
--     If disagreements > 0: STOP. Do not drop the column. Work out which of the
--     seven writers produced the divergence, and restore the boolean's meaning
--     into "status" first.
SELECT count(*)                                                    AS "rows",
       count(*) FILTER (WHERE "read")                              AS "readTrue",
       count(*) FILTER (WHERE "status" <> 'UNREAD')                 AS "notUnread",
       count(*) FILTER (WHERE "read" <> ("status" <> 'UNREAD'))     AS "disagreements"
  FROM "ContactMessage";

-- P2. No "readAt" hole that anyone might be tempted to paper over with a
--     backfill. EXPECTED: 0 rows.
SELECT "id", "status", "readAt", "repliedAt", "createdAt"
  FROM "ContactMessage"
 WHERE "status" <> 'UNREAD' AND "readAt" IS NULL
 ORDER BY "createdAt";

-- P3. Nothing in the database depends on the column, so the plain DROP (no
--     CASCADE) cannot silently take a second object with it.
--     EXPECTED: 0 rows. If this returns anything, the DROP raises 2BP01 and rolls
--     the transaction back, which is the right outcome — read the row, decide,
--     and do NOT reach for CASCADE.
SELECT 'relation' AS "source", "cl"."relname" AS "dependent", "cl"."relkind"::text AS "kind"
  FROM "pg_depend" "d"
  JOIN "pg_class" "cl" ON "cl"."oid" = "d"."objid"
 WHERE "d"."refobjid" = 'ContactMessage'::regclass
   AND "d"."refobjsubid" = (SELECT "attnum" FROM "pg_attribute"
                             WHERE "attrelid" = 'ContactMessage'::regclass AND "attname" = 'read')
UNION ALL
SELECT 'constraint', "co"."conname", "co"."contype"::text
  FROM "pg_constraint" "co"
 WHERE "co"."conrelid" = 'ContactMessage'::regclass
   AND (SELECT "attnum" FROM "pg_attribute"
         WHERE "attrelid" = 'ContactMessage'::regclass AND "attname" = 'read') = ANY("co"."conkey")
UNION ALL
SELECT 'index', "i"."relname", 'i'
  FROM "pg_index" "x"
  JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
 WHERE "x"."indrelid" = 'ContactMessage'::regclass
   AND (SELECT "attnum" FROM "pg_attribute"
         WHERE "attrelid" = 'ContactMessage'::regclass AND "attname" = 'read') = ANY("x"."indkey"::smallint[]);

-- P4. The name columns EXPAND added are all still here, so step 1 can run.
--     EXPECTED: 3 rows, all text / YES.
SELECT "table_name", "column_name", "data_type", "is_nullable"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND ("table_name", "column_name") IN (
     ('MessageReply','sentByName'), ('FeatureFlag','updatedByName'),
     ('RevalidationLog','actorName'))
 ORDER BY 1;

-- P5. How much window drift step 1 is about to repair. Report only; any number is
--     fine. A non-zero "staleFlagNames" is the two-admin hazard actually having
--     happened; a non-zero "missing*" is just window rows.
SELECT
  (SELECT count(*) FROM "MessageReply"
    WHERE "sentById" IS NOT NULL AND "sentByName" IS NULL)          AS "missingReplyNames",
  (SELECT count(*) FROM "RevalidationLog"
    WHERE "actorId" IS NOT NULL AND "actorName" IS NULL)            AS "missingLogNames",
  (SELECT count(*) FROM "FeatureFlag" "f" JOIN "AdminUser" "a" ON "a"."id" = "f"."updatedById"
    WHERE "f"."updatedByName" IS DISTINCT FROM "a"."name")          AS "staleFlagNames";

-- P6. For the record and for V4: the count that must not move.
SELECT count(*) AS "contactMessages" FROM "ContactMessage";


-- =============================================================================
-- DDL + DML. One transaction. Step 3 is last on purpose: run this file statement
-- by statement outside a transaction and you still cannot destroy anything until
-- both harmless steps have succeeded.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Sweep the three name columns for the EXPAND->DEPLOY window.
--    See the header. FeatureFlag is IS DISTINCT FROM; the other two are IS NULL.
-- -----------------------------------------------------------------------------
UPDATE "MessageReply" "r"
   SET "sentByName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "r"."sentById" AND "r"."sentByName" IS NULL;

UPDATE "RevalidationLog" "l"
   SET "actorName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "l"."actorId" AND "l"."actorName" IS NULL;

UPDATE "FeatureFlag" "f"
   SET "updatedByName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "f"."updatedById"
   AND "f"."updatedByName" IS DISTINCT FROM "a"."name";

-- -----------------------------------------------------------------------------
-- 2. Drop the dead audit index. Not in the v2 schema; keeping it is drift.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS "AuditChange_entity_rowId_idx";

-- -----------------------------------------------------------------------------
-- 3. "ContactMessage"."read". THE ONLY DESTRUCTIVE STATEMENT IN THIS CLUSTER.
--    Licensed by P1: read = (status <> 'UNREAD') on every row.
--    No CASCADE, on purpose — P3 says nothing depends on it, and if P3 is wrong
--    this raises 2BP01 and rolls the transaction back, which is what you want.
--    Postgres marks the attribute dropped rather than rewriting the table, so
--    this is O(1). The bytes stay in the existing tuples until those rows are
--    next updated; that is a physical detail, not a recovery path.
-- -----------------------------------------------------------------------------
ALTER TABLE "ContactMessage" DROP COLUMN IF EXISTS "read";

COMMIT;


-- =============================================================================
-- VERIFICATION
-- =============================================================================

-- V1. "read" is gone. EXPECTED: readColumns = 0.
SELECT count(*) AS "readColumns"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND "table_name" = 'ContactMessage' AND "column_name" = 'read';

-- V2. "ContactMessage" now matches the v2 column list exactly, and the three
--     indexes from 20260822110000 survived the drop.
--     EXPECTED 18 columns: id, name, email, purpose, message, status, starred,
--     spamScore, spamReasons, country, deviceType, browser, referrer,
--     notificationMessageId, createdAt, readAt, repliedAt, updatedAt.
--     EXPECTED 4 indexes: ContactMessage_pkey,
--     ContactMessage_status_createdAt_idx, ContactMessage_starred_createdAt_idx,
--     ContactMessage_createdAt_idx.
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'ContactMessage'
 ORDER BY "ordinal_position";

SELECT "i"."relname" AS "index", pg_get_indexdef("i"."oid") AS "definition"
  FROM "pg_index" "x"
  JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
 WHERE "x"."indrelid" = 'ContactMessage'::regclass
 ORDER BY 1;

-- V3. No name column is left behind. EXPECTED: 0 rows from every branch.
SELECT 'MessageReply id without name' AS "problem", "id"::text AS "row"
  FROM "MessageReply" WHERE "sentById" IS NOT NULL AND "sentByName" IS NULL
UNION ALL
SELECT 'RevalidationLog id without name', "id"::text
  FROM "RevalidationLog" WHERE "actorId" IS NOT NULL AND "actorName" IS NULL
UNION ALL
SELECT 'FeatureFlag stale name', "f"."key"
  FROM "FeatureFlag" "f" JOIN "AdminUser" "a" ON "a"."id" = "f"."updatedById"
 WHERE "f"."updatedByName" IS DISTINCT FROM "a"."name"
 ORDER BY 1;

-- V4. Not one row was lost. Must equal P6.
SELECT count(*) AS "contactMessages" FROM "ContactMessage";

-- V5. The dead index is gone and "AuditChange" keeps exactly what v2 declares.
--     EXPECTED 2 rows: AuditChange_pkey, AuditChange_eventId_seq_idx.
SELECT "i"."relname" AS "index", pg_get_indexdef("i"."oid") AS "definition"
  FROM "pg_index" "x"
  JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
 WHERE "x"."indrelid" = 'AuditChange'::regclass
 ORDER BY 1;

-- V6. The end-to-end proof, and the only one that matters: submit the live
--     contact form at https://yatindora.in once, then run this and confirm the
--     row landed with status UNREAD (or SPAM) and readAt NULL. Nothing about
--     "read" is involved any more.
SELECT "id", "name", "email", "status", "spamScore", "readAt", "createdAt"
  FROM "ContactMessage" ORDER BY "createdAt" DESC LIMIT 3;


-- =============================================================================
-- ROLLBACK OF CONTRACT
-- =============================================================================
--
-- BEGIN;
-- CREATE INDEX "AuditChange_entity_rowId_idx" ON "AuditChange" ("entity", "rowId");
-- ALTER TABLE "ContactMessage" ADD COLUMN IF NOT EXISTS "read" BOOLEAN NOT NULL DEFAULT false;
-- UPDATE "ContactMessage" SET "read" = ("status" <> 'UNREAD');
-- COMMIT;
--
-- The "read" restore is EXACT for today's data, and only because P1 passed:
-- read = (status <> 'UNREAD') held on every row, so the expression reproduces the
-- column value for value. IF P1 EVER CAME BACK NON-ZERO, do not use it — restore
-- the column from the JSON dump instead, because then the boolean was carrying
-- something "status" does not.
-- Step 1's sweep is not rolled back and must not be: it only made the stored
-- names agree with "AdminUser", which is true under v1 and v2 alike, and v1 reads
-- none of the three columns.
--
-- IF YOU NEED TO ROLL THE CODE BACK TO v1 AFTER THIS FILE HAS RUN, run the block
-- above FIRST, before re-aliasing the old deployment. Without it the v1 contact
-- form is broken the instant traffic reaches it. This is the one ordering in the
-- whole cutover where the code rollback has a hard database prerequisite, and it
-- is the reason to leave as long a gap as you can stand between DEPLOY and
-- CONTRACT: for as long as "read" still exists, a v1 rollback is a pure
-- re-alias with no SQL at all.
-- =============================================================================
