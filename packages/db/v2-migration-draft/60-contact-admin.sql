-- =============================================================================
-- cluster 60-contact-admin
-- target: the Neon child branch (copy-on-write clone of production, no traffic)
-- Postgres 17, role is the database owner and NOT a superuser.
-- =============================================================================
--
-- This is plan step 8 (the admin foreign keys) for the four tables that still
-- lack one, plan step 9 (the auth-fix columns) and the "ContactMessage" half of
-- plan step 12, in one file. They are one cluster because they all hang off
-- "AdminUser": the FKs need it as a target, the two new columns are on it, and
-- the denormalised name columns are copied out of it.
--
-- WHAT THIS CLUSTER DOES
--
--   1. "AdminUser" gains "lockedUntil" TIMESTAMP(3) NULL and "otpAttempts"
--      INTEGER NOT NULL DEFAULT 0. Additive, no backfill: a NULL "lockedUntil"
--      is "not locked", which is the correct reading for every existing row, and
--      0 is the correct OTP-miss count for a code nobody has typed at yet. The
--      DEFAULT stays on "otpAttempts" because the new schema declares
--      @default(0); it is dropped on nothing here.
--
--   2. "MessageReply" gains "sentByName" TEXT NULL, backfilled from
--      "AdminUser"."name" through "sentById", then the SetNull FK
--      "MessageReply_sentById_fkey" and the index "MessageReply_sentById_idx".
--      The backfill is the whole point of the column: the FK is SetNull, so the
--      day an admin account is hard-deleted the id goes to NULL and the only
--      surviving answer to "who sent this reply" is this text copy. Doing the
--      copy now, while the account still exists, is the only time it can be
--      done. "AuditEvent" already works this way (actorName/actorEmail beside a
--      SetNull actorId, 20260728150000_add_audit_log).
--
--   3. The four remaining admin FKs, all ON DELETE SET NULL ON UPDATE CASCADE,
--      each with the index the new schema declares beside it:
--        "MediaAsset"."uploadedById"      -> MediaAsset_uploadedById_fkey      + _idx
--        "TrackedLink"."createdById"      -> TrackedLink_createdById_fkey      + _idx
--        "FeatureFlag"."updatedById"      -> FeatureFlag_updatedById_fkey      + _idx
--        "RevalidationLog"."actorId"      -> RevalidationLog_actorId_fkey      + _idx
--      ON UPDATE CASCADE is not a preference: Prisma emits it for every relation
--      that does not say otherwise, so ON UPDATE NO ACTION here would show up as
--      drift in `prisma migrate diff`. It matches "AuditEvent_actorId_fkey",
--      which is the fifth FK of step 8 and already exists.
--      There are NO orphans on any of the five columns
--      (/tmp/v2/data-facts.txt, "misc": each of MediaAsset.uploadedById,
--      TrackedLink.createdById, FeatureFlag.updatedById, MessageReply.sentById
--      and RevalidationLog.actorId reports "orphans=none"), so the plan's
--      "null the orphans" pass is deliberately NOT written. See DATA LOSS.
--
--   3b. "FeatureFlag"."updatedByName" and "RevalidationLog"."actorName", the two
--      other denormalised name columns from the same plan step, with the same
--      backfill. SHARED OWNERSHIP: whichever later cluster reshapes these two
--      tables (FeatureFlag."label"/."description" drop, RevalidationLog."scope",
--      the RevalidationTrigger narrowing) may also claim them. Both sections are
--      ADD COLUMN IF NOT EXISTS plus an IS NULL-guarded backfill, so whichever
--      runs first wins and the other is a no-op. They are here because they are
--      worthless unless they are filled while "AdminUser" still holds the rows,
--      which is this cluster's job, and because leaving them out risks nobody
--      adding them at all.
--
--   4. "ContactMessage"."read" is dropped. Its information is already in
--      "status": the inbox migration backfilled status from it
--      (20260822110000_add_inbox_workflow) and every write since has set the two
--      together. P3 asserts that lockstep on the real rows before the drop, so
--      the drop is provably not losing a distinction. NO "readAt" BACKFILL IS
--      WRITTEN, and that is deliberate twice over: it is not needed
--      ("readAt null & status<>UNREAD: 0" in /tmp/v2/data-facts.txt, re-asserted
--      as P4), and the plan's COALESCE(readAt, updatedAt) form would invent an
--      "opened" timestamp for SPAM and bulk-ARCHIVED rows that nobody opened.
--
-- DELIBERATELY NOT DONE HERE (all of it belongs to a later cluster; listed so
-- the gap is visible rather than assumed, because `prisma migrate diff` against
-- the new schema will NOT be empty on these six tables until it lands):
--   * "FeatureFlag"."label" (NOT NULL) and ."description" are NOT dropped.
--   * "RevalidationLog" keeps "entityType"/"entityId" and their index
--     "RevalidationLog_entityType_entityId_idx", gains no "scope", and its
--     "RevalidationTrigger" enum keeps the dead 'SYSTEM' label. Dropping an enum
--     label is a type rebuild, which is emphatically not this cluster's work.
--   * "MediaAsset" keeps "MediaAsset_folder_createdAt_idx" and gains neither the
--     text_pattern_ops index "MediaAsset_key_prefix_idx" nor the folder CHECK.
--   * "TrackedLink" keeps "TrackedLink_channel_createdAt_idx" and
--     "TrackedLink_active_createdAt_idx", both of which the new schema drops (it
--     declares @@index([createdById]) and nothing else), and gains no channel
--     CHECK.
--   * No timestamps are added to anything: "AdminUser", "ContactMessage",
--     "MessageReply", "MediaAsset", "TrackedLink", "FeatureFlag" and
--     "RevalidationLog" all already carry the date columns the new schema wants.
--   * No "AdminUser" unique index is renamed. See P9: "username" acquired its
--     unique index outside migration history, so its NAME is not provable from
--     this repo. P9 reads it; the fix, if it is needed, belongs to the
--     migration-history repair (plan step 3).
--
-- TRANSACTIONALITY
--   Every statement in this file is transactional. Run the whole file inside one
--   BEGIN / COMMIT. There is no CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD
--   VALUE, no VACUUM, no superuser-only statement. Nothing here needs
--   session_replication_role or DISABLE TRIGGER: the five FK additions are
--   validated against tables whose orphan count is zero, so there is no trigger
--   to silence.
--   Locks: each ADD CONSTRAINT takes SHARE ROW EXCLUSIVE on the child table and
--   ACCESS SHARE / ROW SHARE on "AdminUser"; each ADD COLUMN and the DROP COLUMN
--   take ACCESS EXCLUSIVE on one table. All of them are metadata-only or
--   validate a handful of rows. No table here is large: "MediaAsset" is 2 rows,
--   "TrackedLink" has zero non-null "createdById", "FeatureFlag" is nine keys.
--   The DROP COLUMN does not rewrite the table (Postgres only marks the
--   attribute dropped), so it is O(1) regardless of "ContactMessage"'s size.
--
--   Statement order inside the transaction is dependency order and also
--   blast-radius order: sections 1-6 are purely additive, and the one
--   information-destroying statement in the cluster (section 7, DROP COLUMN
--   "read") is last, so running the file statement-by-statement OUTSIDE a
--   transaction still cannot destroy anything until every additive step has
--   succeeded.
--
-- IDEMPOTENCY
--   Every ADD COLUMN is IF NOT EXISTS, every CREATE INDEX is IF NOT EXISTS,
--   every backfill is guarded on IS NULL, the DROP COLUMN is IF EXISTS, and each
--   FK is DROP CONSTRAINT IF EXISTS followed by ADD CONSTRAINT (Postgres has no
--   ADD CONSTRAINT IF NOT EXISTS; the drop-then-add form also repairs a
--   same-named constraint left behind with the wrong referential actions, which
--   a bare IF NOT EXISTS guard would silently keep). Re-running the whole DDL
--   section is a no-op.
--   The PREFLIGHT is deliberately not idempotent in the same way: P3, P4, P4b,
--   P5 and the rollback's UPDATE all name "read", so once section 7 has
--   committed they raise 42703 "column does not exist". That is a feature -- it
--   is how a second run tells you it already happened -- and it is why P2, which
--   answers the question without erroring, is the first shape check in the file.
--
-- ROLLBACK
--   ROLLBACK the transaction if it has not committed. After commit:
--
--     ALTER TABLE "ContactMessage" ADD COLUMN IF NOT EXISTS "read" BOOLEAN NOT NULL DEFAULT false;
--     UPDATE "ContactMessage" SET "read" = ("status" <> 'UNREAD');
--     ALTER TABLE "RevalidationLog" DROP CONSTRAINT IF EXISTS "RevalidationLog_actorId_fkey";
--     DROP INDEX IF EXISTS "RevalidationLog_actorId_idx";
--     ALTER TABLE "RevalidationLog" DROP COLUMN IF EXISTS "actorName";
--     ALTER TABLE "FeatureFlag" DROP CONSTRAINT IF EXISTS "FeatureFlag_updatedById_fkey";
--     DROP INDEX IF EXISTS "FeatureFlag_updatedById_idx";
--     ALTER TABLE "FeatureFlag" DROP COLUMN IF EXISTS "updatedByName";
--     ALTER TABLE "TrackedLink" DROP CONSTRAINT IF EXISTS "TrackedLink_createdById_fkey";
--     DROP INDEX IF EXISTS "TrackedLink_createdById_idx";
--     ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_uploadedById_fkey";
--     DROP INDEX IF EXISTS "MediaAsset_uploadedById_idx";
--     ALTER TABLE "MessageReply" DROP CONSTRAINT IF EXISTS "MessageReply_sentById_fkey";
--     DROP INDEX IF EXISTS "MessageReply_sentById_idx";
--     ALTER TABLE "MessageReply" DROP COLUMN IF EXISTS "sentByName";
--     ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "otpAttempts";
--     ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "lockedUntil";
--
--   The "read" restore is EXACT for today's data and only because P3 passed:
--   read = (status <> 'UNREAD') on every row, so the expression reproduces the
--   column value for value. If P3 ever comes back non-zero, do NOT use it --
--   restore the column from the JSON dump instead, because then the boolean
--   carried something "status" does not.
--   Everything else in the rollback is exact. Dropping a FK destroys no row.
--   Dropping "sentByName"/"updatedByName"/"actorName" destroys only a copy that
--   the UPDATEs in this file can recompute, for as long as the "AdminUser" rows
--   they were copied from still exist -- which is precisely the window the
--   columns exist to outlive, so a rollback re-opens a hole rather than losing
--   data today.
--
-- DEPENDENCIES
--   None on the other clusters, and none of them depend on this one.
--   "AdminUser"."id" has been the primary key since 20260308072119 and no
--   cluster touches it, no cluster inserts into or deletes from "AdminUser", and
--   no other cluster names any of the six tables here except 45's comments about
--   "ContactPurpose". This file can run at any point in the ordering.
--   It does have a CODE dependency in both directions; see the coupling note at
--   the end of the DDL.
--
-- =============================================================================


-- =============================================================================
-- PREFLIGHT. Every one of these must return the stated result BEFORE any DDL.
-- Run them all, read them all, then run the DDL. They take no locks worth the
-- name and change nothing.
-- =============================================================================

-- P1. Row counts, for the record, and re-asserted verbatim as V7.
--     EXPECTED: mediaAssets = 2 exactly (/tmp/v2/data-facts.txt, "MediaAsset (2)").
--     The other five counts are REPORTED, not asserted: data-facts.txt carries
--     no row count for "ContactMessage", "MessageReply", "AdminUser",
--     "TrackedLink", "FeatureFlag" or "RevalidationLog". What is known:
--       contactMessages >= 9      ("ContactMessage read=true: 9")
--       messageReplies  >= 1      ("MessageReply.sentById: 1 distinct")
--       adminUsers      >= 1      (id 2a88a037-dcf0-42a1-bac2-6e72b2932487 owns
--                                  both MediaAsset rows)
--       featureFlags    ~ 9       (schema-v2.md: "nine section-level kill switches")
--       revalidationLogs >= 1     ("RevalidationLog.actorId: 1 distinct")
--     No statement in this cluster inserts or deletes a row, so whatever these
--     read now they must still read after COMMIT.
SELECT
  (SELECT count(*) FROM "ContactMessage")  AS "contactMessages",
  (SELECT count(*) FROM "MessageReply")    AS "messageReplies",
  (SELECT count(*) FROM "AdminUser")       AS "adminUsers",
  (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
  (SELECT count(*) FROM "TrackedLink")     AS "trackedLinks",
  (SELECT count(*) FROM "FeatureFlag")     AS "featureFlags",
  (SELECT count(*) FROM "RevalidationLog") AS "revalidationLogs";

-- P2. The table is in the state this cluster expects: the column it drops is
--     present, and the five columns it adds are absent.
--     EXPECTED: exactly 1 row ->
--       ContactMessage | read | boolean | NO | false
--     Any of the other five appearing means a sibling cluster (or an earlier run
--     of this one) already added it. That is survivable -- every ADD COLUMN below
--     is IF NOT EXISTS -- but know which, and check its type matches V1 before
--     continuing, because an IF NOT EXISTS guard will happily keep a column
--     someone else declared NOT NULL or with the wrong precision.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND ("table_name", "column_name") IN (
    ('ContactMessage',  'read'),
    ('AdminUser',       'lockedUntil'),
    ('AdminUser',       'otpAttempts'),
    ('MessageReply',    'sentByName'),
    ('FeatureFlag',     'updatedByName'),
    ('RevalidationLog', 'actorName')
  )
ORDER BY "table_name", "column_name";

-- P3. THE ASSERTION THAT LICENSES THE DROP. "read" and "status" must be in
--     lockstep on every row: read = true exactly when status <> 'UNREAD'. If
--     that holds, "status" already carries everything the boolean says and the
--     DROP COLUMN destroys no distinction; the rollback UPDATE in the header
--     reproduces the column exactly.
--     EXPECTED: readTrue = 9, statusNotUnread = 9, disagreements = 0.
--     9 is from /tmp/v2/data-facts.txt ("ContactMessage read=true: 9"). The
--     statusNotUnread count is NOT in data-facts.txt and is asserted here only
--     because it must equal readTrue if disagreements is 0; the number that
--     matters is the third one.
--     Why it should hold: 20260822110000_add_inbox_workflow set status from read,
--     and all six surviving writers set both in the same `data` object
--     (apps/docs/app/lib/actions/messages.ts:30, :40, :85, :89, :178 and
--     apps/web/app/api/contact/route.ts:182 -- schema-v2.md says seven writers;
--     six is what grep finds today).
--     If disagreements > 0: STOP. Do not run section 7. The boolean is then
--     carrying state no other column has, and dropping it is real data loss that
--     only the JSON dump would hold.
SELECT
  count(*) FILTER (WHERE "read")                                     AS "readTrue",
  count(*) FILTER (WHERE "status" <> 'UNREAD')                       AS "statusNotUnread",
  count(*) FILTER (WHERE "read" IS DISTINCT FROM ("status" <> 'UNREAD')) AS "disagreements"
FROM "ContactMessage";

-- P4. No "readAt" backfill is needed, which is the second half of the step-12
--     argument: every row that is not UNREAD already has an opened stamp, so
--     there is nothing to invent.
--     EXPECTED: 0 rows. (/tmp/v2/data-facts.txt, "readAt null & status<>UNREAD: 0")
SELECT "id", "status", "readAt", "repliedAt", "createdAt"
FROM "ContactMessage"
WHERE "status" <> 'UNREAD' AND "readAt" IS NULL;

-- P4b. The mirror case, REPORTED not asserted: an UNREAD row that still carries
--      a "readAt". markMessageUnread nulls the stamp when it flips the status
--      (messages.ts:40), so this is expected empty, but a non-empty result is
--      information, not an error -- nothing in this cluster reads or writes
--      "readAt", and the new schema keeps the column exactly as it is.
--      EXPECTED: 0 rows.
SELECT "id", "status", "readAt"
FROM "ContactMessage"
WHERE "status" = 'UNREAD' AND "readAt" IS NOT NULL;

-- P5. Nothing but the table itself depends on "ContactMessage"."read". A view, a
--     CHECK, an index or a generated column over the boolean would turn the
--     DROP COLUMN into either an error or, with CASCADE, a silent extra
--     deletion. The DROP below deliberately has no CASCADE, so this is a
--     "should be empty and will fail loudly if it is not" check, run first so
--     the failure is understood before it happens.
--     EXPECTED: 0 rows from both halves.
SELECT 'pg_depend' AS "source", "cl"."relname" AS "dependent", "cl"."relkind" AS "kind"
FROM "pg_depend" "d"
JOIN "pg_class" "cl" ON "cl"."oid" = "d"."objid"
WHERE "d"."refobjid" = '"ContactMessage"'::regclass
  AND "d"."refobjsubid" = (
    SELECT "attnum" FROM "pg_attribute"
    WHERE "attrelid" = '"ContactMessage"'::regclass AND "attname" = 'read'
  )
UNION ALL
SELECT 'pg_constraint', "co"."conname", "co"."contype"
FROM "pg_constraint" "co"
WHERE "co"."conrelid" = '"ContactMessage"'::regclass
  AND (
    SELECT "attnum" FROM "pg_attribute"
    WHERE "attrelid" = '"ContactMessage"'::regclass AND "attname" = 'read'
  ) = ANY ("co"."conkey");

-- P6. "ContactMessage"'s own indexes, for the record and because this table has
--     no CREATE TABLE anywhere in migration history (schema-v2.md, order step
--     3): its primary key was created by a push, so its NAME is not provable
--     from this repo and is worth reading once.
--     EXPECTED: exactly 4 rows ->
--       ContactMessage_createdAt_idx         | btree ("createdAt")
--       ContactMessage_pkey                  | UNIQUE btree ("id")
--       ContactMessage_starred_createdAt_idx | btree ("starred", "createdAt")
--       ContactMessage_status_createdAt_idx  | btree ("status", "createdAt")
--     None of the four names "read", which P5 already implies. The three _idx
--     names come from 20260822110000_add_inbox_workflow and are exactly what the
--     new schema declares, so nothing on this table changes except the drop.
SELECT "i"."relname" AS "index", pg_get_indexdef("i"."oid") AS "definition"
FROM "pg_index" "x"
JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
WHERE "x"."indrelid" = '"ContactMessage"'::regclass
ORDER BY 1;

-- P7. NO ORPHANS on any of the five admin id columns. This is the assertion that
--     replaces the plan's "null the orphans" pass: there is nothing to null.
--     EXPECTED: 5 rows, "orphans" = 0 on every one.
--     (/tmp/v2/data-facts.txt, "misc": every one of these five reports
--     "orphans=none".)
--     If a non-zero appears, STOP and do not "fix" it by nulling. See DATA LOSS
--     in the header: the ADD CONSTRAINT would raise 23503 and roll the whole
--     transaction back, which is the outcome we want, because a surviving orphan
--     uuid is the only record that a now-deleted account did the thing, and
--     nulling it erases that.
SELECT 'MessageReply.sentById' AS "fk", count(*) AS "orphans"
FROM "MessageReply" "t"
WHERE "t"."sentById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "t"."sentById")
UNION ALL
SELECT 'MediaAsset.uploadedById', count(*)
FROM "MediaAsset" "t"
WHERE "t"."uploadedById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "t"."uploadedById")
UNION ALL
SELECT 'TrackedLink.createdById', count(*)
FROM "TrackedLink" "t"
WHERE "t"."createdById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "t"."createdById")
UNION ALL
SELECT 'FeatureFlag.updatedById', count(*)
FROM "FeatureFlag" "t"
WHERE "t"."updatedById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "t"."updatedById")
UNION ALL
SELECT 'RevalidationLog.actorId', count(*)
FROM "RevalidationLog" "t"
WHERE "t"."actorId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "t"."actorId")
ORDER BY 1;

-- P8. How much work the three backfills actually have, and how much the FKs
--     actually constrain.
--     EXPECTED, from /tmp/v2/data-facts.txt "misc" (distinct counts only; the
--     VALUES are not in that file except MediaAsset's uploader, so the names the
--     backfill writes cannot be predicted here and are checked relationally in
--     V4 instead):
--       FeatureFlag.updatedById     | distinctActors 1 | rowsWithActor >= 1
--       MediaAsset.uploadedById     | distinctActors 1 | rowsWithActor = 2   (both rows, id 2a88a037-...)
--       MessageReply.sentById       | distinctActors 1 | rowsWithActor >= 1
--       RevalidationLog.actorId     | distinctActors 1 | rowsWithActor >= 1
--       TrackedLink.createdById     | distinctActors 0 | rowsWithActor = 0
--     TrackedLink's zero is expected and is not a problem: its FK and index are
--     vacuous today and exist for the rows the admin writes next.
SELECT 'MessageReply.sentById' AS "column",
       count("sentById") AS "rowsWithActor", count(DISTINCT "sentById") AS "distinctActors"
FROM "MessageReply"
UNION ALL
SELECT 'MediaAsset.uploadedById', count("uploadedById"), count(DISTINCT "uploadedById")
FROM "MediaAsset"
UNION ALL
SELECT 'TrackedLink.createdById', count("createdById"), count(DISTINCT "createdById")
FROM "TrackedLink"
UNION ALL
SELECT 'FeatureFlag.updatedById', count("updatedById"), count(DISTINCT "updatedById")
FROM "FeatureFlag"
UNION ALL
SELECT 'RevalidationLog.actorId', count("actorId"), count(DISTINCT "actorId")
FROM "RevalidationLog"
ORDER BY 1;

-- P9. "AdminUser" is shaped to be an FK target, and no name is blank.
--     EXPECTED: 3 rows ->
--       AdminUser_email_key    | CREATE UNIQUE INDEX ... ("email")
--       AdminUser_pkey         | CREATE UNIQUE INDEX ... ("id")
--       AdminUser_username_key | CREATE UNIQUE INDEX ... ("username")
--     The first two come from 20260308072119_add_admin_user. The THIRD does not
--     exist in any migration -- "username" is one of the columns schema-v2.md
--     lists as pure drift -- so its name is whatever the push that created it
--     chose. Prisma's own convention is "AdminUser_username_key", and a push
--     uses that convention, so it should already be right. If it comes back as
--     anything else, this cluster does NOT change it (renaming an index is not
--     what this file is for); record it and hand it to the migration-history
--     repair. The remedy there is one transactional statement:
--       ALTER INDEX "<actual>" RENAME TO "AdminUser_username_key";
--     Only "AdminUser_pkey" is load-bearing for THIS cluster: the five FKs
--     reference "AdminUser"("id") and need that unique index to exist.
SELECT "i"."relname" AS "index", pg_get_indexdef("i"."oid") AS "definition"
FROM "pg_index" "x"
JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
WHERE "x"."indrelid" = '"AdminUser"'::regclass
ORDER BY 1;

-- P9b. No blank admin name, so no backfill can write '' into a name column and
--      make "who did this" read as nothing.
--      EXPECTED: 0 rows.
SELECT "id", "email", "name" FROM "AdminUser" WHERE btrim("name") = '';

-- P9c. The "AdminRole" enum, REPORTED. Nothing in this cluster casts to it, but
--      "AdminUser"."role" is the column the new schema wants holding all three
--      labels, and 'SUB_ADMIN' is drift like "username" is.
--      EXPECTED: 3 rows in this order -> OWNER, ADMIN, SUB_ADMIN.
--      20260308072119 created the type as ('OWNER', 'ADMIN') and a later push
--      appended 'SUB_ADMIN', which is why the order should match the new
--      schema's declaration order. Order is informational either way: Prisma
--      compares the label SET, and it cannot reorder an enum.
--      Production holds only 'OWNER' and 'SUB_ADMIN'
--      (/tmp/v2/data-facts.txt, "AdminUser.role"), so the label must already be
--      there; if it is missing, ALTER TYPE ... ADD VALUE cannot run in this
--      transaction and needs its own statement outside it.
SELECT "e"."enumlabel", "e"."enumsortorder"
FROM "pg_enum" "e"
JOIN "pg_type" "t" ON "t"."oid" = "e"."enumtypid"
WHERE "t"."typname" = 'AdminRole'
ORDER BY "e"."enumsortorder";

-- P10. None of the five constraint names and five index names this cluster
--      creates may already be taken.
--      EXPECTED: 0 rows.
--      "AuditEvent_actorId_fkey" and "AuditEvent_actorId_idx" are deliberately
--      NOT in this list: they are the fifth admin FK and they already exist
--      (20260728150000_add_audit_log:73, :82). V2 asserts all six together.
SELECT 'constraint' AS "kind", "conname" AS "name"
FROM "pg_constraint"
WHERE "conname" IN (
  'MessageReply_sentById_fkey', 'MediaAsset_uploadedById_fkey',
  'TrackedLink_createdById_fkey', 'FeatureFlag_updatedById_fkey',
  'RevalidationLog_actorId_fkey'
)
UNION ALL
SELECT 'index', "c"."relname"
FROM "pg_class" "c"
JOIN "pg_namespace" "n" ON "n"."oid" = "c"."relnamespace"
WHERE "c"."relkind" = 'i'
  AND "n"."nspname" = current_schema()
  AND "c"."relname" IN (
    'MessageReply_sentById_idx', 'MediaAsset_uploadedById_idx',
    'TrackedLink_createdById_idx', 'FeatureFlag_updatedById_idx',
    'RevalidationLog_actorId_idx'
  )
ORDER BY 1, 2;


-- =============================================================================
-- DDL + DML. One transaction. Sections 1-6 are additive; section 7 is the only
-- statement in the file that removes anything, and it is last on purpose.
-- =============================================================================

BEGIN;


-- -----------------------------------------------------------------------------
-- 1. "AdminUser" gains the two auth-fix columns (plan step 9).
--
-- No backfill and no NOT NULL on "lockedUntil": NULL is the encoding for "not
-- locked", and every existing row is not locked. The point of the column is to
-- replace the permanent lockout that "failedAttempts" produces today, where
-- three bad passwords lock an account until either a successful OTP login or a
-- password reset -- both of which need working SMTP -- with a window that
-- expires on its own.
--
-- "otpAttempts" keeps its DEFAULT 0 because the new schema declares
-- @default(0), exactly like "failedAttempts" which has carried DEFAULT 0 since
-- it was pushed. It closes the other half: a wrong OTP currently increments
-- nothing, so a 6-digit code can be brute-forced for its whole 5-minute life.
-- Both columns are INTEGER/TIMESTAMP(3) to match Prisma's Int and DateTime
-- mappings; a timestamp of precision 6 would read as drift even though the type
-- name looks right.
-- -----------------------------------------------------------------------------
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
-- 2. "MessageReply": "sentByName", the backfill, the SetNull FK, the index.
--
-- Column first, then the copy, then the constraint. The copy MUST happen while
-- "AdminUser" still holds the row, which is now: the FK is SetNull, so the
-- moment an account is hard-deleted "sentById" becomes NULL and the join that
-- produces this name is gone forever. This is the same shape "AuditEvent" has
-- used since 20260728150000 (actorName/actorEmail/actorRole beside a SetNull
-- actorId), and it is why the FK is safe to be SetNull rather than Restrict.
-- -----------------------------------------------------------------------------
ALTER TABLE "MessageReply"
  ADD COLUMN IF NOT EXISTS "sentByName" TEXT;

-- Guarded on IS NULL so a re-run cannot overwrite a name an operator or a later
-- writer put there, and so a reply whose sender has ALREADY been deleted (id
-- NULL, name kept) is not touched. Rows with a NULL "sentById" stay NULL: there
-- is no honest name for them and none is invented. /tmp/v2/data-facts.txt says
-- there is exactly 1 distinct "sentById" and no orphan, so every non-null row
-- resolves.
UPDATE "MessageReply" "r"
SET "sentByName" = "a"."name"
FROM "AdminUser" "a"
WHERE "a"."id" = "r"."sentById"
  AND "r"."sentByName" IS NULL;

-- Drop-then-add rather than a pg_constraint guard: it also repairs a same-named
-- constraint left behind with different referential actions.
-- ON UPDATE CASCADE is Prisma's default for a relation that does not override
-- it; omitting it would diff as drift. It matches AuditEvent_actorId_fkey.
-- Added VALID, not NOT VALID: P7 proved zero orphans and these tables are tiny,
-- so the validating scan is free and an unvalidated constraint would be one more
-- thing to remember.
ALTER TABLE "MessageReply" DROP CONSTRAINT IF EXISTS "MessageReply_sentById_fkey";
ALTER TABLE "MessageReply" ADD CONSTRAINT "MessageReply_sentById_fkey"
  FOREIGN KEY ("sentById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Declared by the new schema as @@index([sentById]). It exists for the SetNull
-- sweep on account deletion, not for a reader: no query filters replies by
-- sender today.
CREATE INDEX IF NOT EXISTS "MessageReply_sentById_idx"
  ON "MessageReply" ("sentById");


-- -----------------------------------------------------------------------------
-- 3. "MediaAsset"."uploadedById" -> SetNull FK + index.
--
-- The weakest of the five by design: the column has no reader anywhere, so this
-- buys integrity and nothing else. It is also the one with the worst failure
-- mode, which belongs in the code half, not here -- the upload route writes the
-- bytes to R2 before it inserts the row, so a ghost session (sessions are
-- stateless 7-day JWTs with no server-side record, so a deleted admin's cookie
-- keeps working for up to a week) now gets a P2003 on an object that is already
-- in the bucket.
-- 2 rows, both uploaded by 2a88a037-dcf0-42a1-bac2-6e72b2932487, no orphan.
-- No denormalised name column here: the new schema does not declare one for
-- "MediaAsset", and adding one would be drift.
-- -----------------------------------------------------------------------------
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_uploadedById_fkey";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "MediaAsset_uploadedById_idx"
  ON "MediaAsset" ("uploadedById");


-- -----------------------------------------------------------------------------
-- 4. "TrackedLink"."createdById" -> SetNull FK + index.
--
-- Vacuous today and that is fine: zero rows carry a non-null "createdById"
-- (/tmp/v2/data-facts.txt: "TrackedLink.createdById: 0 distinct"), so the
-- constraint validates instantly and the index is empty. Both exist for the rows
-- the admin writes next. No reader, integrity only.
-- -----------------------------------------------------------------------------
ALTER TABLE "TrackedLink" DROP CONSTRAINT IF EXISTS "TrackedLink_createdById_fkey";
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "TrackedLink_createdById_idx"
  ON "TrackedLink" ("createdById");


-- -----------------------------------------------------------------------------
-- 5. "FeatureFlag"."updatedById" -> SetNull FK + index, and "updatedByName".
--
-- SHARED OWNERSHIP on "updatedByName" -- see 3b in the header. Idempotent, so it
-- does not matter whether the flags cluster also writes it.
-- The name column is what lets the flags page drop its second query outright
-- instead of trading it for an include. It is also the only one of the three
-- whose absence is VISIBLE: a ghost session on this page throws where media and
-- revalidation just stop recording.
-- 9 rows, 1 distinct actor, no orphan.
-- -----------------------------------------------------------------------------
ALTER TABLE "FeatureFlag"
  ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;

UPDATE "FeatureFlag" "f"
SET "updatedByName" = "a"."name"
FROM "AdminUser" "a"
WHERE "a"."id" = "f"."updatedById"
  AND "f"."updatedByName" IS NULL;

ALTER TABLE "FeatureFlag" DROP CONSTRAINT IF EXISTS "FeatureFlag_updatedById_fkey";
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "FeatureFlag_updatedById_idx"
  ON "FeatureFlag" ("updatedById");


-- -----------------------------------------------------------------------------
-- 6. "RevalidationLog"."actorId" -> SetNull FK + index, and "actorName".
--
-- SHARED OWNERSHIP on "actorName" -- see 3b in the header.
-- This table is append-only and pruned at 30 days, so the name copy matters less
-- here than on the other two: a deleted admin's rows age out. It is still worth
-- having, because the 7-day health panel reads inside that window.
-- The writer sits inside a catch that swallows everything, which is why
-- "actorName" is nullable and why nothing here is NOT NULL: a required column
-- with no default would silently lose the log row AND the "TagState" upsert loop
-- that follows it.
-- 1 distinct actor, no orphan.
-- -----------------------------------------------------------------------------
ALTER TABLE "RevalidationLog"
  ADD COLUMN IF NOT EXISTS "actorName" TEXT;

UPDATE "RevalidationLog" "l"
SET "actorName" = "a"."name"
FROM "AdminUser" "a"
WHERE "a"."id" = "l"."actorId"
  AND "l"."actorName" IS NULL;

ALTER TABLE "RevalidationLog" DROP CONSTRAINT IF EXISTS "RevalidationLog_actorId_fkey";
ALTER TABLE "RevalidationLog" ADD CONSTRAINT "RevalidationLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "RevalidationLog_actorId_idx"
  ON "RevalidationLog" ("actorId");


-- -----------------------------------------------------------------------------
-- 7. "ContactMessage"."read" is dropped. THE ONLY DESTRUCTIVE STATEMENT HERE.
--
-- Licensed by P3: read = (status <> 'UNREAD') on every row, so "status" already
-- holds the distinction and the rollback UPDATE reproduces the column exactly.
-- Nine rows read true.
--
-- No CASCADE, on purpose. P5 says nothing depends on the column; if that is
-- wrong, this raises 2BP01 and rolls the transaction back, which is the right
-- outcome. CASCADE would drop the dependent object silently.
--
-- No "readAt" backfill accompanies this, and none should be added. It is not
-- needed (P4 is empty) and the plan's COALESCE("readAt", "updatedAt") form would
-- stamp an "opened" time on SPAM rows, which are created READ-less, and on bulk
-- ARCHIVE rows, which never set it -- printing "opened 14:32" in the detail pane
-- for a message nobody ever opened.
--
-- Postgres marks the attribute dropped rather than rewriting the table, so this
-- is O(1) and takes ACCESS EXCLUSIVE only for the catalog update. The bytes stay
-- in the existing tuples until those rows are next updated; that is a physical
-- detail, not a recovery path.
-- -----------------------------------------------------------------------------
ALTER TABLE "ContactMessage" DROP COLUMN IF EXISTS "read";


COMMIT;

-- CODE COUPLING, both directions. Neither half is SQL and neither is done here.
--   Dropping "read" breaks six write sites the moment it commits:
--   apps/docs/app/lib/actions/messages.ts:30, :40, :85, :89, :178 and
--   apps/web/app/api/contact/route.ts:182 all name it in a Prisma `data` object,
--   so every inbox action and the public contact form start returning P2022 on
--   this branch until that code ships. Zero readers, so nothing displays wrong
--   first -- it simply fails.
--   The five FKs turn what is today a tolerated orphan write into a failed one:
--   the reply route sends the email BEFORE inserting the row and does not wrap
--   the pair (messages.ts:157 then :161), so a ghost session now mails the
--   visitor, raises P2003 on the insert, leaves the message un-REPLIED and
--   records nothing -- and the obvious operator response is to press Send again
--   and mail the visitor twice. Re-validate the actor before the insert, or move
--   the insert ahead of the send.
--   Nothing writes "sentByName", "updatedByName" or "actorName" yet. Until the
--   writers land, every row created after this migration has a NULL name and the
--   columns only cover history, not new rows.


-- =============================================================================
-- VERIFICATION. Run after COMMIT.
-- =============================================================================

-- V1. Every column this cluster adds, with its type, nullability and default.
--     EXPECTED: exactly these 5 rows, in this order ->
--       AdminUser       | lockedUntil   | timestamp without time zone | 3    | YES | (null)
--       AdminUser       | otpAttempts   | integer                     | null | NO  | 0
--       FeatureFlag     | updatedByName | text                        | null | YES | (null)
--       MessageReply    | sentByName    | text                        | null | YES | (null)
--       RevalidationLog | actorName     | text                        | null | YES | (null)
--     "ContactMessage"."read" must NOT appear: it is in the IN list below and its
--     absence from the result is the proof it is gone. datetime_precision must be
--     3 on "lockedUntil"; 6 is drift even though the type name matches.
SELECT "table_name", "column_name", "data_type", "datetime_precision",
       "is_nullable", "column_default"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND ("table_name", "column_name") IN (
    ('ContactMessage',  'read'),
    ('AdminUser',       'lockedUntil'),
    ('AdminUser',       'otpAttempts'),
    ('MessageReply',    'sentByName'),
    ('FeatureFlag',     'updatedByName'),
    ('RevalidationLog', 'actorName')
  )
ORDER BY "table_name", "column_name";

-- V2. All SIX admin foreign keys exist, all SetNull, all ON UPDATE CASCADE, all
--     validated. This is the whole of plan step 8's constraint half in one
--     result set.
--     EXPECTED: exactly 6 rows ->
--       AuditEvent      | AuditEvent_actorId_fkey       | actorId      | n | c | t   <-- pre-existing
--       FeatureFlag     | FeatureFlag_updatedById_fkey  | updatedById  | n | c | t
--       MediaAsset      | MediaAsset_uploadedById_fkey  | uploadedById | n | c | t
--       MessageReply    | MessageReply_sentById_fkey    | sentById     | n | c | t
--       RevalidationLog | RevalidationLog_actorId_fkey  | actorId      | n | c | t
--       TrackedLink     | TrackedLink_createdById_fkey  | createdById  | n | c | t
--     confdeltype 'n' = SET NULL, confupdtype 'c' = CASCADE, convalidated 't'.
--     Anything other than n/c/t on any row is drift that `prisma migrate diff`
--     will report. A 7th row means something references "AdminUser" that the new
--     schema does not declare.
SELECT "ch"."relname" AS "table", "co"."conname" AS "constraint",
       "att"."attname" AS "column",
       "co"."confdeltype", "co"."confupdtype", "co"."convalidated",
       pg_get_constraintdef("co"."oid") AS "definition"
FROM "pg_constraint" "co"
JOIN "pg_class" "ch" ON "ch"."oid" = "co"."conrelid"
JOIN "pg_attribute" "att"
  ON "att"."attrelid" = "co"."conrelid" AND "att"."attnum" = "co"."conkey"[1]
WHERE "co"."contype" = 'f'
  AND "co"."confrelid" = '"AdminUser"'::regclass
ORDER BY "ch"."relname", "co"."conname";

-- V3. The five new indexes exist, with the exact names the new schema's
--     @@index([...]) lines will generate.
--     EXPECTED: exactly 5 rows ->
--       FeatureFlag     | FeatureFlag_updatedById_idx     | CREATE INDEX ... USING btree ("updatedById")
--       MediaAsset      | MediaAsset_uploadedById_idx     | CREATE INDEX ... USING btree ("uploadedById")
--       MessageReply    | MessageReply_sentById_idx       | CREATE INDEX ... USING btree ("sentById")
--       RevalidationLog | RevalidationLog_actorId_idx     | CREATE INDEX ... USING btree ("actorId")
--       TrackedLink     | TrackedLink_createdById_idx     | CREATE INDEX ... USING btree ("createdById")
--     None of them UNIQUE. None of them partial. A "WHERE" in any definition, or
--     a name with a trailing digit (Postgres deduplicating a clash), is drift.
SELECT "t"."relname" AS "table", "i"."relname" AS "index",
       pg_get_indexdef("i"."oid") AS "definition"
FROM "pg_index" "x"
JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
JOIN "pg_class" "t" ON "t"."oid" = "x"."indrelid"
WHERE "i"."relname" IN (
  'MessageReply_sentById_idx', 'MediaAsset_uploadedById_idx',
  'TrackedLink_createdById_idx', 'FeatureFlag_updatedById_idx',
  'RevalidationLog_actorId_idx'
)
ORDER BY "t"."relname", "i"."relname";

-- V4. THE BACKFILL IS CORRECT AND COMPLETE, checked relationally rather than
--     against a literal, because /tmp/v2/data-facts.txt gives the distinct
--     COUNT of each id column but not the values, and gives no "AdminUser" names
--     at all. So the assertion is "every name equals the name of the admin the
--     id points at", which is exactly what the column means.
--     EXPECTED: 0 rows.
--     A row here is either a missed backfill (name NULL where the id resolves)
--     or a stale copy (name <> the admin's current name).
SELECT 'MessageReply' AS "table", "r"."id", "r"."sentById" AS "actorId",
       "r"."sentByName" AS "storedName", "a"."name" AS "adminName"
FROM "MessageReply" "r"
JOIN "AdminUser" "a" ON "a"."id" = "r"."sentById"
WHERE "r"."sentByName" IS DISTINCT FROM "a"."name"
UNION ALL
SELECT 'FeatureFlag', "f"."key", "f"."updatedById", "f"."updatedByName", "a"."name"
FROM "FeatureFlag" "f"
JOIN "AdminUser" "a" ON "a"."id" = "f"."updatedById"
WHERE "f"."updatedByName" IS DISTINCT FROM "a"."name"
UNION ALL
SELECT 'RevalidationLog', "l"."id", "l"."actorId", "l"."actorName", "a"."name"
FROM "RevalidationLog" "l"
JOIN "AdminUser" "a" ON "a"."id" = "l"."actorId"
WHERE "l"."actorName" IS DISTINCT FROM "a"."name"
ORDER BY 1, 2;

-- V4b. The other half of the backfill contract: a NULL id must leave a NULL
--      name. No name is invented for a row that never had an actor.
--      EXPECTED: 0 rows.
SELECT 'MessageReply' AS "table", "id", "sentByName" AS "storedName"
FROM "MessageReply" WHERE "sentById" IS NULL AND "sentByName" IS NOT NULL
UNION ALL
SELECT 'FeatureFlag', "key", "updatedByName"
FROM "FeatureFlag" WHERE "updatedById" IS NULL AND "updatedByName" IS NOT NULL
UNION ALL
SELECT 'RevalidationLog', "id", "actorName"
FROM "RevalidationLog" WHERE "actorId" IS NULL AND "actorName" IS NOT NULL
ORDER BY 1, 2;

-- V4c. What the three columns actually hold, for the record. This is the row
--      that proves the migration captured a real human name and not an empty
--      string.
--      EXPECTED: 3 rows, one per table, each with rowsNamed = the rowsWithActor
--      figure P8 reported for that table, distinctNames = 1 and blankNames = 0.
--      (P8 expects 1 distinct actor on each of the three, so 1 distinct name.)
SELECT 'MessageReply.sentByName' AS "column",
       count("sentByName") AS "rowsNamed",
       count(DISTINCT "sentByName") AS "distinctNames",
       count(*) FILTER (WHERE "sentByName" = '') AS "blankNames",
       min("sentByName") AS "sample"
FROM "MessageReply"
UNION ALL
SELECT 'FeatureFlag.updatedByName', count("updatedByName"),
       count(DISTINCT "updatedByName"), count(*) FILTER (WHERE "updatedByName" = ''),
       min("updatedByName")
FROM "FeatureFlag"
UNION ALL
SELECT 'RevalidationLog.actorName', count("actorName"),
       count(DISTINCT "actorName"), count(*) FILTER (WHERE "actorName" = ''),
       min("actorName")
FROM "RevalidationLog"
ORDER BY 1;

-- V5. "read" is gone and nothing else on "ContactMessage" moved.
--     EXPECTED: readColumns = 0, and the four index names from P6 unchanged
--     (second query, exactly 4 rows: ContactMessage_createdAt_idx,
--     ContactMessage_pkey, ContactMessage_starred_createdAt_idx,
--     ContactMessage_status_createdAt_idx).
SELECT count(*) AS "readColumns"
FROM "information_schema"."columns"
WHERE "table_schema" = current_schema()
  AND "table_name" = 'ContactMessage'
  AND "column_name" = 'read';

SELECT "i"."relname" AS "index", pg_get_indexdef("i"."oid") AS "definition"
FROM "pg_index" "x"
JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
WHERE "x"."indrelid" = '"ContactMessage"'::regclass
ORDER BY 1;

-- V5b. The information the dropped boolean carried is still readable, which is
--      the claim the drop rests on.
--      EXPECTED: 1 row -> notUnread = 9, unread = (total - 9), matching P3's
--      readTrue = 9. If this does not match P3, something between the preflight
--      and here wrote to the table, which on a branch with no traffic means
--      someone ran the app against it.
SELECT count(*) FILTER (WHERE "status" <> 'UNREAD') AS "notUnread",
       count(*) FILTER (WHERE "status" =  'UNREAD') AS "unread",
       count(*)                                     AS "total"
FROM "ContactMessage";

-- V6. The two "AdminUser" columns are usable as the auth fix needs them:
--     "otpAttempts" is 0 everywhere (no row was left NULL or defaulted oddly)
--     and "lockedUntil" is NULL everywhere (nobody was accidentally locked).
--     EXPECTED: 1 row -> admins = P1's adminUsers, attemptsNotZero = 0,
--     lockedRows = 0.
SELECT count(*) AS "admins",
       count(*) FILTER (WHERE "otpAttempts" <> 0)      AS "attemptsNotZero",
       count(*) FILTER (WHERE "lockedUntil" IS NOT NULL) AS "lockedRows"
FROM "AdminUser";

-- V7. Row counts unchanged. No statement in this cluster inserts or deletes.
--     EXPECTED: identical to P1, column for column.
SELECT
  (SELECT count(*) FROM "ContactMessage")  AS "contactMessages",
  (SELECT count(*) FROM "MessageReply")    AS "messageReplies",
  (SELECT count(*) FROM "AdminUser")       AS "adminUsers",
  (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
  (SELECT count(*) FROM "TrackedLink")     AS "trackedLinks",
  (SELECT count(*) FROM "FeatureFlag")     AS "featureFlags",
  (SELECT count(*) FROM "RevalidationLog") AS "revalidationLogs";

-- V8. Nothing grew a constraint this cluster did not intend. Every constraint on
--     the five tables that gained one, in one list.
--     EXPECTED: exactly these 11 rows (assuming clusters 10-55 have run and the
--     media / links / flags clusters have NOT) ->
--       FeatureFlag     | FeatureFlag_pkey              | p | PRIMARY KEY ("key")
--       FeatureFlag     | FeatureFlag_updatedById_fkey  | f | FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON UPDATE CASCADE ON DELETE SET NULL
--       MediaAsset      | MediaAsset_pkey               | p | PRIMARY KEY ("id")
--       MediaAsset      | MediaAsset_uploadedById_fkey  | f | FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id") ON UPDATE CASCADE ON DELETE SET NULL
--       MessageReply    | MessageReply_messageId_fkey   | f | FOREIGN KEY ("messageId") REFERENCES "ContactMessage"("id") ON UPDATE CASCADE ON DELETE CASCADE
--       MessageReply    | MessageReply_pkey             | p | PRIMARY KEY ("id")
--       MessageReply    | MessageReply_sentById_fkey    | f | FOREIGN KEY ("sentById") REFERENCES "AdminUser"("id") ON UPDATE CASCADE ON DELETE SET NULL
--       RevalidationLog | RevalidationLog_actorId_fkey  | f | FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON UPDATE CASCADE ON DELETE SET NULL
--       RevalidationLog | RevalidationLog_pkey          | p | PRIMARY KEY ("id")
--       TrackedLink     | TrackedLink_createdById_fkey  | f | FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON UPDATE CASCADE ON DELETE SET NULL
--       TrackedLink     | TrackedLink_pkey              | p | PRIMARY KEY ("id")
--     No 'u' row and no 'c' row anywhere. "TrackedLink_slug_key" and
--     "MediaAsset_key_key" are UNIQUE INDEXES, not constraints -- both were
--     written as CREATE UNIQUE INDEX (20260822130000:22, :110), which is what
--     Prisma emits for @unique -- so they belong to V8b, not here. A 'c' row on
--     any of these five tables means a CHECK from another cluster landed on a
--     table that has none in the schema-v2.md inventory.
SELECT "ch"."relname" AS "table", "co"."conname" AS "constraint", "co"."contype",
       pg_get_constraintdef("co"."oid") AS "definition"
FROM "pg_constraint" "co"
JOIN "pg_class" "ch" ON "ch"."oid" = "co"."conrelid"
WHERE "ch"."relname" IN ('MessageReply', 'MediaAsset', 'TrackedLink',
                         'FeatureFlag', 'RevalidationLog')
  AND "co"."contype" IN ('p', 'u', 'c', 'f')
ORDER BY "ch"."relname", "co"."conname";

-- V8b. And nothing grew an index this cluster did not intend. The five indexes
--      from V3 plus everything that was already there.
--      EXPECTED: exactly 20 rows ->
--        FeatureFlag     | FeatureFlag_pkey                        (from 20260821140000)
--        FeatureFlag     | FeatureFlag_updatedById_idx             <-- new here
--        MediaAsset      | MediaAsset_createdAt_idx                (20260822130000)
--        MediaAsset      | MediaAsset_folder_createdAt_idx         (20260822130000; the media cluster drops this)
--        MediaAsset      | MediaAsset_key_key                      (20260822130000, UNIQUE)
--        MediaAsset      | MediaAsset_pkey
--        MediaAsset      | MediaAsset_uploadedById_idx             <-- new here
--        MessageReply    | MessageReply_messageId_sentAt_idx       (20260822110000)
--        MessageReply    | MessageReply_pkey
--        MessageReply    | MessageReply_sentById_idx               <-- new here
--        RevalidationLog | RevalidationLog_actorId_idx             <-- new here
--        RevalidationLog | RevalidationLog_createdAt_idx           (20260821130000)
--        RevalidationLog | RevalidationLog_entityType_entityId_idx (20260821130000; a later cluster drops this)
--        RevalidationLog | RevalidationLog_pkey
--        RevalidationLog | RevalidationLog_status_createdAt_idx    (20260821130000)
--        TrackedLink     | TrackedLink_active_createdAt_idx        (20260822130000; the links cluster drops this)
--        TrackedLink     | TrackedLink_channel_createdAt_idx       (20260822130000; the links cluster drops this)
--        TrackedLink     | TrackedLink_createdById_idx             <-- new here
--        TrackedLink     | TrackedLink_pkey
--        TrackedLink     | TrackedLink_slug_key                    (20260822130000, UNIQUE)
SELECT "t"."relname" AS "table", "i"."relname" AS "index",
       "x"."indisunique", pg_get_indexdef("i"."oid") AS "definition"
FROM "pg_index" "x"
JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
JOIN "pg_class" "t" ON "t"."oid" = "x"."indrelid"
JOIN "pg_namespace" "n" ON "n"."oid" = "i"."relnamespace"
WHERE "n"."nspname" = current_schema()
  AND "t"."relname" IN ('MessageReply', 'MediaAsset', 'TrackedLink',
                        'FeatureFlag', 'RevalidationLog')
ORDER BY "t"."relname", "i"."relname";

-- V9. The FK is NOT smoke-tested by inserting a bad id, on purpose. The only
--     honest test writes a row, and writing a row to prove a constraint works
--     then having to delete it again is two writes this file has no business
--     doing. "convalidated" = 't' in V2 is Postgres's own statement that it
--     checked every existing row, and P7 is the statement that there was nothing
--     to find. If a live test is wanted, do it in its own transaction and
--     ROLLBACK:
--       BEGIN;
--       UPDATE "MediaAsset" SET "uploadedById" = '00000000-0000-0000-0000-000000000000';
--       -- expect: ERROR 23503 violates foreign key constraint "MediaAsset_uploadedById_fkey"
--       ROLLBACK;

-- V10. WHAT `prisma migrate diff` WILL STILL REPORT on these six tables after
--      this cluster, all of it owned elsewhere (see DELIBERATELY NOT DONE):
--        - FeatureFlag."label", ."description" still present.
--        - RevalidationLog."scope" missing; "entityType"/"entityId" and
--          "RevalidationLog_entityType_entityId_idx" still present;
--          "RevalidationTrigger" still has 'SYSTEM'.
--        - MediaAsset."MediaAsset_folder_createdAt_idx" still present;
--          "MediaAsset_key_prefix_idx" missing.
--        - TrackedLink."TrackedLink_channel_createdAt_idx" and
--          ."TrackedLink_active_createdAt_idx" still present.
--      The diff should report NOTHING on "ContactMessage", "MessageReply" or
--      "AdminUser" -- those three are finished by this cluster. If it reports a
--      CHECK on any of the six, that is expected too: Prisma does not model
--      CHECKs and never emits them, which is why schema-v2.md keeps its own
--      inventory.
-- =============================================================================
