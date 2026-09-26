-- =============================================================================
-- cluster: contact-admin-audit          STAGE 1 of 2: EXPAND
-- target: PRODUCTION (Neon, Postgres 17, role = database owner, not superuser)
-- run this WHILE v1 IS STILL DEPLOYED. The public site stays up throughout.
-- =============================================================================
--
-- SCOPE. Six tables and two enums' worth of work:
--   AdminUser        + lockedUntil, + otpAttempts
--   MessageReply     + sentByName (backfilled), + SetNull FK on sentById, + index
--   MediaAsset       + SetNull FK on uploadedById, + index
--   TrackedLink      + SetNull FK on createdById, + index
--   FeatureFlag      + updatedByName (backfilled), + SetNull FK on updatedById, + index
--   RevalidationLog  + actorName (backfilled),   + SetNull FK on actorId,     + index
--   AuditEvent       action/surface/publishState/actorRole TEXT -> enum
--   AuditChange      kind TEXT -> enum
--
-- NOT HERE, and deliberately so. Both are in contact-admin-audit-contract.sql:
--   * ALTER TABLE "ContactMessage" DROP COLUMN "read"
--   * DROP INDEX "AuditChange_entity_rowId_idx"
-- "read" cannot be additive; see the contract file's header for the seven v1
-- writers and the three v1 readers that a drop would take down, two of which are
-- reached from the PUBLIC contact form.
--
-- NOT MINE AT ALL. This cluster does not add "RevalidationLog"."scope", does not
-- drop "FeatureFlag"."label"/."description", and does not touch the
-- "RevalidationTrigger" enum or the "MediaAsset"/"TrackedLink" index sets. Those
-- belong to the media-flags-reval cluster. THE v2 DEPLOY NEEDS THAT CLUSTER'S
-- EXPAND TOO: apps/docs/app/lib/revalidation.ts writes `scope:` in the
-- revalidationLog.create, and apps/docs/app/lib/revalidation.ts:171
-- (readRecentLogs) selects every column of the table. Do not deploy v2 until
-- both EXPANDs have run.
--
-- =============================================================================
-- WHY EVERY STATEMENT BELOW IS SAFE UNDER THE DEPLOYED v1 CLIENT
-- =============================================================================
--
-- The stack is Prisma 7.8 with the @prisma/adapter-pg driver adapter over
-- pg 8.20 (packages/db/src/index.ts at HEAD: `new PrismaClient({ adapter: new
-- PrismaPg({ connectionString }) })`). That combination decides the two
-- questions this stage turns on, and the answers are checkable in node_modules:
--
--  1. ADDING A COLUMN NEVER BREAKS A v1 READ OR WRITE. Prisma names every column
--     explicitly in both the SELECT list and the INSERT column list, generated
--     from the CLIENT's schema, never `SELECT *`. A column the v1 client does not
--     know about is simply never mentioned. This is what makes lockedUntil,
--     otpAttempts, sentByName, updatedByName and actorName free.
--
--  2. THE ENUM CASTS ARE SAFE BECAUSE NO PARAMETER TYPE OIDS GO OVER THE WIRE.
--     @prisma/adapter-pg/dist/index.js performIO() calls
--         this.client.query({ text, values, rowMode: 'array', types: { getTypeParser } })
--     pg's Query constructor stores that object as `this.types` (pg/lib/query.js:17)
--     and hands it to `connection.parse({ text, name, types: this.types })`
--     (pg/lib/query.js:215). pg-protocol/dist/serializer.js:51-59 then does
--         const types = query.types || emptyArray;  const len = types.length;
--         writer.addInt16(len); for (i < len) addInt32(types[i]);
--     `{ getTypeParser }` has no `.length`, so len is undefined, and
--     buffer-writer.js:31 computes `undefined >>> 8` = 0 — it writes a parameter
--     count of ZERO. Every placeholder therefore arrives UNTYPED and Postgres
--     infers it from its use site: from the target column in
--     `INSERT INTO "AuditEvent"(...,"surface",...) VALUES (...,$n,...)`, and from
--     the column in `WHERE "publishState" = $n`. An untyped literal coerces to an
--     enum; a parameter explicitly declared `text` would NOT (text -> enum is an
--     I/O conversion cast, legal only at COERCION_EXPLICIT, so it errors 42804
--     "column is of type X but expression is of type text"). We are on the safe
--     side of that line, not by luck but because the adapter never declares types.
--     The only casts the query compiler emits at all are JSON/array ones
--     (`::jsonb`, `::numeric`, `::text[]` in the JSONB_BUILD_OBJECT cluster of
--     the compiler's string table); it does not cast plain scalar placeholders.
--
--  3. READS SURVIVE THE CAST TOO, and this one is already proved in production.
--     adapter-pg's fieldToColumnType() maps any OID >= FIRST_NORMAL_OBJECT_ID
--     (16384), which is every user-defined enum, to ColumnTypeEnum.Text
--     (dist/index.js:291-295). "ContactMessage"."status" is a REAL Postgres enum
--     today and is already delivered to the client as Text. An enum column and a
--     text column are indistinguishable to Prisma on the read path, in both
--     directions. So a v1 `String` field reading an enum column gets a string,
--     which is exactly what it wants.
--
--  4. NOTHING IS NARROWED. A cast only breaks a v1 write if the v1 code can
--     produce a string that is not a label. Per column, every v1 producer:
--       action       apps/docs/app/lib/audit.ts:3 `type AuditAction =
--                    "SAVE"|"SAVE_AND_PUBLISH"|"PUBLISH"` — and CHECK
--                    "AuditEvent_action_check" already enforces exactly that set.
--       surface      exactly three literals in the whole tree:
--                      apps/docs/app/lib/actions/staging.ts:55       'staging'
--                      apps/docs/app/lib/audit-writer.ts:66          'publish'
--                      apps/docs/scripts/update-about-copy.ts:31     'script'
--                    which is why AuditSurface has THREE @map'd members. A
--                    two-member enum would abort the cast on live rows and would
--                    break `bun run about:copy`.
--       publishState 'NONE' (default), 'OK'/'FAILED' from audit-writer.ts:53.
--                    CHECK "AuditEvent_publishState_check" already enforces it.
--       actorRole    audit-writer.ts:32 writes `d.actor.role` = `session.role` =
--                    the JWT claim signed at apps/docs/app/lib/actions/auth.ts:70
--                    and :135 from `user.role`, which IS AdminRole. Closed set.
--                    NO CHECK ever guarded this column — P6 below is not
--                    optional.
--       kind         audit.ts:4 `type ChangeKind =
--                    "CREATE"|"UPDATE"|"DELETE"|"REORDER"`, and CHECK
--                    "AuditChange_kind_check" already enforces it.
--
--  5. THE FIVE FKs CANNOT REJECT A v1 WRITE THAT WOULD HAVE SUCCEEDED, because
--     all five columns are written from one expression, `session.userId`:
--       apps/docs/app/lib/actions/messages.ts:168        sentById
--       apps/docs/app/lib/actions/media.ts:242           uploadedById
--       apps/docs/app/lib/actions/media-browser.ts:506   uploadedById
--       apps/docs/app/lib/actions/tracked-links.ts:89    createdById
--       apps/docs/app/lib/actions/flags.ts:52            updatedById
--       apps/docs/app/lib/revalidation.ts:86             actorId, whose every
--         caller passes session.userId (flags.ts:70, publish.ts:23,
--         publishing.ts:136/322/+finishBlog, revalidation.ts actions 34/52/73/105)
--     There is no sentinel actor anywhere — no 'system', no 'cron', no 'script'.
--     The public app never writes any of the six tables' actor columns; the
--     beacon-driven scheduled publisher (packages/db/src/publish-due.ts) writes
--     only Blog/Project. Orphan count is zero on all five columns today
--     (data-facts.txt "misc"), re-asserted as P7.
--     ON DELETE SET NULL is also invisible to the v1 client: relationMode is the
--     default `foreignKeys`, so Postgres performs the nulling and the v1 client
--     does not need to know the relation exists. The one v1 delete path,
--     apps/docs/app/lib/actions/staging.ts:757 `tx.adminUser.delete`, gets
--     STRICTLY BETTER — today it leaves five dangling ids.
--
-- WHAT STILL CHANGES BEHAVIOUR IN THE WINDOW. Two things, both admin-only, both
-- swept up by the contract file:
--   * v1 writes NO name column. Rows v1 creates between now and the deploy get
--     sentByName / actorName NULL. The v2 revalidation page falls back to the raw
--     uuid (apps/docs/app/(dashboard)/revalidation/page.tsx:145
--     `actor: l.actorName ?? l.actorId`), so you will see a uuid in the actor
--     column for those rows until CONTRACT step 1 re-runs the backfill.
--   * v1 flag toggles move "FeatureFlag"."updatedById" WITHOUT moving
--     "updatedByName" (apps/docs/app/lib/actions/flags.ts:48-55 sets only the
--     id). With one admin the backfilled name stays correct; with two it would go
--     stale. CONTRACT step 1 re-syncs it with an IS DISTINCT FROM guard, not an
--     IS NULL guard, for exactly this reason.
--
-- TRANSACTIONALITY. Three transactions, deliberately separate so that a failure
-- in the riskiest one does not unwind the free ones:
--   T0  ALTER TYPE "AdminRole" ADD VALUE, only if P6 says a label is missing.
--       Must be its own transaction: a label added by ALTER TYPE cannot be used
--       by a USING cast in the same transaction.
--   T1  the additive work: two AdminUser columns, three name columns and their
--       backfills, five FKs and five indexes. All metadata-only or a handful of
--       rows. Longest lock is ACCESS EXCLUSIVE on one tiny table at a time.
--   T2  the enum pass: CREATE TYPE x4, drop three CHECKs, five ALTER COLUMN TYPE.
--       Each retype rewrites "AuditEvent" / "AuditChange" and rebuilds their
--       indexes in place, keeping every index name. Single-digit row counts.
--       Nothing here is non-transactional: no CREATE INDEX CONCURRENTLY, no
--       VACUUM, no superuser statement, no session_replication_role.
--
-- IDEMPOTENCY. Every ADD COLUMN is IF NOT EXISTS, every CREATE INDEX is IF NOT
-- EXISTS, every backfill is IS NULL-guarded, every CREATE TYPE is guarded in a DO
-- block, every FK is DROP IF EXISTS then ADD (Postgres has no ADD CONSTRAINT IF
-- NOT EXISTS, and drop-then-add also repairs a same-named constraint carrying the
-- wrong referential actions), and every cast is written ::text::"Type" so it
-- re-runs cleanly once the column is already the enum. The whole file is
-- re-runnable.
--
-- =============================================================================
-- PREFLIGHT. Run all of these, read all of them, and only then run T0/T1/T2.
-- They take no meaningful locks and change nothing.
-- =============================================================================

-- P1. Shape check: the five actor columns are still plain TEXT with no FK, the
--     two AdminUser columns do not exist yet, the three name columns do not
--     exist yet, and "ContactMessage"."read" is still present.
--     EXPECTED: 6 rows, not 11. "ContactMessage"."read" = boolean / NO / false,
--     and the five actor id columns = text / YES / NULL. The five columns this
--     stage adds -- lockedUntil, otpAttempts, sentByName, updatedByName,
--     actorName -- must be ABSENT from the result. If any of them comes back,
--     EXPAND has already run in part; read V1-V9 before doing anything else.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND ("table_name", "column_name") IN (
     ('ContactMessage',  'read'),
     ('AdminUser',       'lockedUntil'),
     ('AdminUser',       'otpAttempts'),
     ('MessageReply',    'sentById'),
     ('MessageReply',    'sentByName'),
     ('MediaAsset',      'uploadedById'),
     ('TrackedLink',     'createdById'),
     ('FeatureFlag',     'updatedById'),
     ('FeatureFlag',     'updatedByName'),
     ('RevalidationLog', 'actorId'),
     ('RevalidationLog', 'actorName')
   )
 ORDER BY 1, 2;

-- P2. The five audit columns are still TEXT NOT NULL, and publishState still
--     carries the text default.
--     EXPECTED: 5 rows, all data_type = text, all is_nullable = NO,
--     publishState column_default = 'NONE'::text.
SELECT "table_name", "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND ("table_name", "column_name") IN (
     ('AuditEvent',  'action'),
     ('AuditEvent',  'surface'),
     ('AuditEvent',  'publishState'),
     ('AuditEvent',  'actorRole'),
     ('AuditChange', 'kind')
   )
 ORDER BY 1, 2;

-- P3. The real stored values, because a cast fails on the first stray one.
--     EXPECTED, from data-facts.txt:
--       action       SAVE, SAVE_AND_PUBLISH, PUBLISH
--       surface      staging, publish, script
--       publishState NONE, OK
--       actorRole    OWNER
--       kind         UPDATE
--     ANY other value is a STOP. Do not "fix" it by widening the enum; find out
--     which writer produced it first.
SELECT 'AuditEvent.action' AS "column", "action" AS "value", count(*) AS "rows"
  FROM "AuditEvent" GROUP BY 2
UNION ALL SELECT 'AuditEvent.surface',      "surface",      count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditEvent.publishState', "publishState", count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditEvent.actorRole',    "actorRole",    count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditChange.kind',        "kind",         count(*) FROM "AuditChange" GROUP BY 2
 ORDER BY 1, 2;

-- P4. Exactly three CHECK constraints exist on these two tables, and they are
--     the three from 20260728150000_add_audit_log. "surface" and "actorRole"
--     never had one.
--     EXPECTED: 3 rows — AuditEvent_action_check, AuditEvent_publishState_check,
--     AuditChange_kind_check.
SELECT "cl"."relname" AS "table", "co"."conname", pg_get_constraintdef("co"."oid") AS "definition"
  FROM "pg_constraint" "co"
  JOIN "pg_class" "cl" ON "cl"."oid" = "co"."conrelid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "cl"."relnamespace"
 WHERE "n"."nspname" = current_schema()
   AND "cl"."relname" IN ('AuditEvent', 'AuditChange')
   AND "co"."contype" = 'c'
 ORDER BY 1, 2;

-- P5. None of the four new type names is taken, and "AdminRole" exists.
--     EXPECTED: 1 row, AdminRole. If AuditAction/AuditSurface/PublishState/
--     AuditChangeKind already exist, T2's DO block will leave them alone AS THEY
--     ARE — check their labels against V1 before trusting that.
SELECT "t"."typname", "t"."typtype"
  FROM "pg_type" "t" JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
 WHERE "n"."nspname" = current_schema()
   AND "t"."typname" IN ('AdminRole','AuditAction','AuditSurface','PublishState','AuditChangeKind')
 ORDER BY 1;

-- P6. THE ONE PREFLIGHT THAT CAN CHANGE THE PLAN. "AdminRole"'s labels.
--     20260308072119_add_admin_user created it as ('OWNER','ADMIN') only;
--     SUB_ADMIN was added outside migration history and exists in production
--     because a row carries it. The v2 target is ('OWNER','ADMIN','SUB_ADMIN')
--     in that order.
--     EXPECTED: 3 rows, OWNER 1, ADMIN 2, SUB_ADMIN 3.
--     If SUB_ADMIN is ABSENT: the cast in T2 step 6 still succeeds (only 'OWNER'
--     is stored), but the column would then reject a legitimate SUB_ADMIN audit
--     write forever after. Run T0 first.
--     If a label is present that is NOT one of the three: STOP. AdminUser.role
--     already uses this type, so you cannot narrow it, and the v2 schema is
--     wrong about it.
SELECT "e"."enumlabel", "e"."enumsortorder"
  FROM "pg_enum" "e"
  JOIN "pg_type" "t" ON "t"."oid" = "e"."enumtypid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
 WHERE "n"."nspname" = current_schema() AND "t"."typname" = 'AdminRole'
 ORDER BY 2;

-- P7. Zero orphans on all five columns to be constrained. Every count MUST be 0.
--     If any is non-zero, do NOT add that FK yet and do NOT null the rows
--     blindly — a non-zero here means an actor id came from somewhere this
--     analysis did not find, and that source will keep producing them.
SELECT 'MessageReply.sentById' AS "fk", count(*) AS "orphans"
  FROM "MessageReply" "r" WHERE "r"."sentById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "r"."sentById")
UNION ALL SELECT 'MediaAsset.uploadedById', count(*)
  FROM "MediaAsset" "m" WHERE "m"."uploadedById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "m"."uploadedById")
UNION ALL SELECT 'TrackedLink.createdById', count(*)
  FROM "TrackedLink" "l" WHERE "l"."createdById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "l"."createdById")
UNION ALL SELECT 'FeatureFlag.updatedById', count(*)
  FROM "FeatureFlag" "f" WHERE "f"."updatedById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "f"."updatedById")
UNION ALL SELECT 'RevalidationLog.actorId', count(*)
  FROM "RevalidationLog" "g" WHERE "g"."actorId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "AdminUser" "a" WHERE "a"."id" = "g"."actorId")
 ORDER BY 1;

-- P8. Nobody in "AdminUser" has a blank name, or the backfills would copy ''
--     and the name columns would be worse than NULL.
--     EXPECTED: 0 rows.
SELECT "id", "email", "name" FROM "AdminUser" WHERE btrim("name") = '';

-- P9. Counts for the record and for V7. mediaAssets MUST be 2
--     (data-facts.txt "MediaAsset (2)"); featureFlags should be 9. The rest are
--     reported, not asserted — data-facts.txt carries no count for them.
--     Nothing in this file inserts or deletes a row, so every number here must
--     be identical after T2 commits.
SELECT
  (SELECT count(*) FROM "AdminUser")       AS "adminUsers",
  (SELECT count(*) FROM "ContactMessage")  AS "contactMessages",
  (SELECT count(*) FROM "MessageReply")    AS "messageReplies",
  (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
  (SELECT count(*) FROM "TrackedLink")     AS "trackedLinks",
  (SELECT count(*) FROM "FeatureFlag")     AS "featureFlags",
  (SELECT count(*) FROM "RevalidationLog") AS "revalidationLogs",
  (SELECT count(*) FROM "AuditEvent")      AS "auditEvents",
  (SELECT count(*) FROM "AuditChange")     AS "auditChanges";


-- =============================================================================
-- T0. ONLY IF P6 SHOWED A MISSING LABEL. Its own transaction, because a label
--     added here cannot be referenced by the USING cast in T2 until this commits.
--     Skip this block entirely when P6 already returned all three.
--     Safe for v1: widening an enum cannot break an existing write. AdminUser.role
--     already accepts these labels; this only makes the type's label set match
--     packages/db/prisma/schema.prisma:467-471.
-- =============================================================================

-- BEGIN;
-- ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'ADMIN';
-- ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'SUB_ADMIN' AFTER 'ADMIN';
-- COMMIT;


-- =============================================================================
-- T1. THE ADDITIVE WORK. Nothing in this transaction removes anything.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. "AdminUser" gains the two auth-fix columns.
--
-- v1 SAFETY: "lockedUntil" is NULLABLE, so the v1 insert at
-- apps/docs/app/lib/actions/staging.ts:579 (`tx.adminUser.create`) still
-- satisfies it without naming it. "otpAttempts" is NOT NULL and therefore MUST
-- carry the DEFAULT 0 — without the default that same v1 insert would fail
-- 23502 not_null_violation, and creating a second admin from the staged Save bar
-- would break. The default is not cosmetic; it is the whole reason this column
-- can go in EXPAND.
-- The six v1 `adminUser.findUnique`/`findMany` calls that pass no `select`
-- (actions/auth.ts:28,29,79,112,181,201 and (dashboard)/admin-users/page.tsx:11)
-- keep working: Prisma lists the v1 schema's columns explicitly, so it never
-- mentions either new column.
-- Postgres 11+ adds a NOT NULL DEFAULT column without rewriting the table, so
-- this is metadata-only.
-- TIMESTAMP(3)/INTEGER exactly, to match Prisma's DateTime/Int mapping; a
-- precision-6 timestamp reads as drift even though the type name looks right.
-- -----------------------------------------------------------------------------
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
-- 2. The three denormalised name columns, and their backfills.
--
-- WHY NOW AND NOT IN CONTRACT: each FK below is ON DELETE SET NULL, so the day
-- an admin account is hard-deleted the id goes to NULL and the join that
-- produces the name is gone forever. The copy has to happen while "AdminUser"
-- still holds the row. This is the shape "AuditEvent" has used since
-- 20260728150000 (actorName/actorEmail beside a SetNull actorId).
--
-- v1 SAFETY: all three are NULLABLE with no default. v1 never writes any of
-- them and never selects any of them, so they are invisible to it. Making any
-- of them NOT NULL would break the v1 inserts at
-- apps/docs/app/lib/actions/messages.ts:162 and
-- apps/docs/app/lib/revalidation.ts:79 — the latter sits inside a catch that
-- only logs (revalidation.ts:109), so it would silently lose the log row AND the
-- "TagState" upsert loop that follows it. Nullable is load-bearing.
--
-- v2 NEEDS THESE BEFORE THE DEPLOY: the flags page reads
-- `row?.updatedByName` ((dashboard)/flags/page.tsx:47) and the revalidation page
-- reads `l.actorName ?? l.actorId` ((dashboard)/revalidation/page.tsx:145), and
-- readRecentLogs selects the whole row. A missing column is P2022 on those pages.
--
-- The backfills are IS NULL-guarded so a re-run cannot overwrite a name a later
-- writer put there, and so a row whose sender has ALREADY been deleted (id NULL,
-- name kept) is untouched. Rows with a NULL id stay NULL: no name is invented.
-- -----------------------------------------------------------------------------
ALTER TABLE "MessageReply"    ADD COLUMN IF NOT EXISTS "sentByName"    TEXT;
ALTER TABLE "FeatureFlag"     ADD COLUMN IF NOT EXISTS "updatedByName" TEXT;
ALTER TABLE "RevalidationLog" ADD COLUMN IF NOT EXISTS "actorName"     TEXT;

UPDATE "MessageReply" "r"
   SET "sentByName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "r"."sentById" AND "r"."sentByName" IS NULL;

UPDATE "FeatureFlag" "f"
   SET "updatedByName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "f"."updatedById" AND "f"."updatedByName" IS NULL;

UPDATE "RevalidationLog" "l"
   SET "actorName" = "a"."name"
  FROM "AdminUser" "a"
 WHERE "a"."id" = "l"."actorId" AND "l"."actorName" IS NULL;


-- -----------------------------------------------------------------------------
-- 3. The five SetNull foreign keys, each with the index the v2 schema declares
--    beside it.
--
-- Order: after section 2, so the names are already copied out before the
-- constraint that will one day null the ids is in place. (Nothing here deletes an
-- AdminUser row, so the order is hygiene rather than necessity — but if you run
-- this file statement by statement, do not skip ahead.)
--
-- Added VALID, not NOT VALID: P7 proved zero orphans and the tables are tiny
-- (MediaAsset 2 rows, TrackedLink 0 non-null createdById, FeatureFlag 9 rows), so
-- the validating scan is free and an unvalidated constraint would be one more
-- thing to remember. Lock taken is SHARE ROW EXCLUSIVE on the child and
-- ROW SHARE on "AdminUser"; no public read path touches any of these tables.
--
-- ON UPDATE CASCADE is not a preference: Prisma emits it for every relation that
-- does not override it, so ON UPDATE NO ACTION would show up as drift in
-- `prisma migrate diff`. It matches the existing "AuditEvent_actorId_fkey",
-- which is the sixth FK of this set and ALREADY EXISTS — this file does not
-- touch it.
--
-- v1 SAFETY, per FK, against the actual deployed writer:
--   MessageReply.sentById       messages.ts:168     session.userId
--   MediaAsset.uploadedById     media.ts:242 and media-browser.ts:506  session.userId
--   TrackedLink.createdById     tracked-links.ts:89 session.userId
--   FeatureFlag.updatedById     flags.ts:52         session.userId
--   RevalidationLog.actorId     revalidation.ts:86  opts.actorId, always session.userId
-- so the only insert these can reject is one from a GHOST SESSION: sessions are
-- stateless 7-day JWTs with no server-side record (apps/docs/app/lib/session.ts,
-- apps/docs/app/lib/auth.ts), so a deleted admin's cookie keeps working for up to
-- a week. With one admin who is not being deleted, this is unreachable. Two
-- places where it would cost something REAL if it were reached, both because an
-- external side effect precedes the insert and a rollback does not undo it:
--   * apps/docs/app/lib/actions/messages.ts:158 sends the reply email, then :162
--     inserts the row, unwrapped. A ghost session would mail the visitor, raise
--     P2003 on the insert, leave the message un-REPLIED, record nothing — and the
--     obvious operator response is to press Send again and mail them twice.
--     v2 fixes this: it resolves `sender` first and writes
--     `sentById: sender?.id ?? null` (messages.ts:137-144, :168).
--   * media.ts signs an R2 upload URL, the browser PUTs the bytes, and only then
--     saveUpload inserts. A ghost session would leave an orphan object in the
--     bucket. Nothing reads MediaAsset.uploadedById, so this FK buys integrity
--     and nothing else.
-- If you want that window at zero: do not delete an admin account between now
-- and the deploy. That is the entire mitigation.
-- -----------------------------------------------------------------------------
ALTER TABLE "MessageReply" DROP CONSTRAINT IF EXISTS "MessageReply_sentById_fkey";
ALTER TABLE "MessageReply" ADD CONSTRAINT "MessageReply_sentById_fkey"
  FOREIGN KEY ("sentById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MessageReply_sentById_idx" ON "MessageReply" ("sentById");

ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_uploadedById_fkey";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MediaAsset_uploadedById_idx" ON "MediaAsset" ("uploadedById");

ALTER TABLE "TrackedLink" DROP CONSTRAINT IF EXISTS "TrackedLink_createdById_fkey";
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "TrackedLink_createdById_idx" ON "TrackedLink" ("createdById");

ALTER TABLE "FeatureFlag" DROP CONSTRAINT IF EXISTS "FeatureFlag_updatedById_fkey";
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "FeatureFlag_updatedById_idx" ON "FeatureFlag" ("updatedById");

ALTER TABLE "RevalidationLog" DROP CONSTRAINT IF EXISTS "RevalidationLog_actorId_fkey";
ALTER TABLE "RevalidationLog" ADD CONSTRAINT "RevalidationLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "RevalidationLog_actorId_idx" ON "RevalidationLog" ("actorId");

COMMIT;


-- =============================================================================
-- T2. THE ENUM PASS. Separate transaction: it is the only part of EXPAND whose
--     safety rests on an argument about the client rather than on "Prisma never
--     mentions a column it does not know". If you do not want to accept that
--     argument, SKIP T2 ENTIRELY AND MOVE IT TO CONTRACT — the v2 client works
--     unchanged against these five columns while they are still TEXT (see item 3
--     in the header: adapter-pg reports every enum OID as ColumnTypeEnum.Text
--     anyway, so Prisma cannot tell an enum column from a text one on read, and
--     on write it sends the @map'd db label as an untyped parameter that a text
--     column accepts). The only cost of deferring is that `prisma migrate diff`
--     stays non-empty between deploy and contract.
--
--     SMOKE TEST after T2 commits, before you walk away: in the live admin,
--     change one hero title and press Save, then open /history. A new row must
--     appear. That single gesture exercises a v1 INSERT into all four retyped
--     "AuditEvent" columns plus "AuditChange"."kind" through the real deployed
--     client. If it fails, run the T2 rollback at the bottom of this file; the
--     public site was never involved.
-- =============================================================================

BEGIN;

-- 1. The four new types. Postgres has no CREATE TYPE ... IF NOT EXISTS.
--    Label order is the v2 schema's declaration order (schema.prisma:521-544),
--    which is deliberately NOT alphabetical: it puts members in lifecycle order.
--    That changes what ORDER BY on these columns means — 'PUBLISH' used to sort
--    first among the actions and now sorts last. Verified harmless: the only
--    orderBy near these tables are "AuditChange"."seq"
--    (apps/docs/app/lib/actions/history.ts:20) and "AuditEvent"."createdAt".
--    "AuditSurface" is the @map'd one: its labels are the lowercase strings
--    already stored, so the cast moves no data and raw SQL keeps showing
--    'staging'/'publish'/'script'. Only the generated client sees
--    STAGING/PUBLISH/SCRIPT.
--    Creating a type is invisible to v1 in every way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_type" "t" JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
                  WHERE "t"."typname" = 'AuditAction' AND "n"."nspname" = current_schema()) THEN
    CREATE TYPE "AuditAction" AS ENUM ('SAVE', 'SAVE_AND_PUBLISH', 'PUBLISH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_type" "t" JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
                  WHERE "t"."typname" = 'AuditSurface' AND "n"."nspname" = current_schema()) THEN
    CREATE TYPE "AuditSurface" AS ENUM ('staging', 'publish', 'script');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_type" "t" JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
                  WHERE "t"."typname" = 'PublishState' AND "n"."nspname" = current_schema()) THEN
    CREATE TYPE "PublishState" AS ENUM ('NONE', 'OK', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_type" "t" JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
                  WHERE "t"."typname" = 'AuditChangeKind' AND "n"."nspname" = current_schema()) THEN
    CREATE TYPE "AuditChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'REORDER');
  END IF;
END $$;

-- 2. Retire the three CHECKs from 20260728150000_add_audit_log. These MUST
--    precede the retypes: Postgres will not re-derive a constraint expression
--    that compares the column to text literals once the column is an enum, it
--    errors out. The enum is the stronger guard anyway — a CHECK can be added
--    NOT VALID, an enum cannot be bypassed.
--    v1 SAFETY: dropping a CHECK only LOOSENS what the database accepts. No v1
--    write can start failing because a constraint went away. (v1 was already
--    writing only values inside these sets — see P3.)
ALTER TABLE "AuditEvent"  DROP CONSTRAINT IF EXISTS "AuditEvent_action_check";
ALTER TABLE "AuditEvent"  DROP CONSTRAINT IF EXISTS "AuditEvent_publishState_check";
ALTER TABLE "AuditChange" DROP CONSTRAINT IF EXISTS "AuditChange_kind_check";

-- 3. "AuditEvent"."action". No default, so one statement. Writing
--    ::text::"AuditAction" rather than ::"AuditAction" is what makes the
--    statement re-runnable after the column is already the enum.
--    v1 SAFETY: audit-writer.ts:27 writes d.action, one of three literals, as an
--    untyped parameter in an INSERT whose target column now infers the type.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "action" TYPE "AuditAction" USING "action"::text::"AuditAction";

-- 4. "AuditEvent"."surface". No default. The three stored lowercase values pass
--    straight through to the three @map'd labels.
--    v1 SAFETY: three literals, three labels, listed in header item 4. This is
--    the cast that needs SCRIPT to be a real member: 'script' is in the live
--    rows (data-facts.txt) and `bun run about:copy` still writes it
--    (apps/docs/scripts/update-about-copy.ts:31). A two-member AuditSurface
--    would abort this ALTER on existing data.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "surface" TYPE "AuditSurface" USING "surface"::text::"AuditSurface";

-- 5. "AuditEvent"."publishState". DROP DEFAULT, retype, SET DEFAULT. Without the
--    drop the ALTER fails "default for column publishState cannot be cast
--    automatically to type PublishState" — there is no ASSIGNMENT cast from text
--    to an enum and the stored default is a text literal.
--    v1 SAFETY: the default must come back, and as an enum literal. v1's
--    commitAudit (audit-writer.ts:25) never names publishState, so the INSERT
--    relies on it; @default("NONE") in the v1 schema and @default(NONE) in v2
--    compile to the same stored value. recordPublish then writes 'OK'/'FAILED'
--    (audit-writer.ts:53) and, importantly, COMPARES with
--    `publishState: "NONE"` in a WHERE (audit-writer.ts:56) — that comparison is
--    `"publishState" = $n` with an untyped $n, which Postgres resolves to
--    PublishState from the column. It does not become `enum = text`, which would
--    have failed 42883.
--    "AuditEvent_publishState_publishedAt_idx" is rebuilt in place and keeps its
--    name; V4 asserts that.
ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" DROP DEFAULT;
ALTER TABLE "AuditEvent"
  ALTER COLUMN "publishState" TYPE "PublishState" USING "publishState"::text::"PublishState";
ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" SET DEFAULT 'NONE'::"PublishState";

-- 6. "AuditEvent"."actorRole" -> the PRE-EXISTING "AdminRole". No CREATE TYPE, no
--    default, no CHECK to drop first.
--    v1 SAFETY: this is the one of the five with NO prior CHECK, so P3 and P6 are
--    the only evidence. The value is a JWT claim written unvalidated
--    (audit-writer.ts:32 `role: session.role`, from auth.ts:9's bare
--    `payload as {...}`), but the claim was SIGNED from AdminUser.role at
--    auth.ts:70 / :135, so the set is closed to AdminRole's labels. Typing the
--    column turns an unexpected claim from a tolerated oddity into a 22P02 that
--    rolls back the whole staged batch (commitAudit runs inside the
--    staging.ts:51 $transaction), which is why v2 adds the asRole() guard at
--    audit-writer.ts:9-12. v1 has no such guard, so if P6 showed a label set you
--    did not expect, defer this one statement to CONTRACT.
ALTER TABLE "AuditEvent"
  ALTER COLUMN "actorRole" TYPE "AdminRole" USING "actorRole"::text::"AdminRole";

-- 7. "AuditChange"."kind". No default; the CHECK dropped in step 2 already
--    guaranteed the cast. Only 'UPDATE' is stored; CREATE, DELETE and REORDER all
--    have writers. Written by createMany (audit-writer.ts:40), which emits a
--    multi-row INSERT of untyped placeholders — same inference, same safety.
--    "AuditChange_eventId_seq_idx" and "AuditChange_pkey" are rebuilt in place.
ALTER TABLE "AuditChange"
  ALTER COLUMN "kind" TYPE "AuditChangeKind" USING "kind"::text::"AuditChangeKind";

COMMIT;

-- NOTE: "AuditChange_entity_rowId_idx" is NOT dropped here. It is in the contract
-- file. It is harmless under either version and dropping it buys v2 nothing, so
-- it waits with the other removals.


-- =============================================================================
-- VERIFICATION. Run every one of these after T2 commits.
-- =============================================================================

-- V1. The four new types exist with exactly the right labels in the right order.
--     EXPECTED: 13 rows.
--       AuditAction     SAVE 1, SAVE_AND_PUBLISH 2, PUBLISH 3
--       AuditSurface    staging 1, publish 2, script 3   (lowercase: @map)
--       PublishState    NONE 1, OK 2, FAILED 3
--       AuditChangeKind CREATE 1, UPDATE 2, DELETE 3, REORDER 4
SELECT "t"."typname", "e"."enumlabel", "e"."enumsortorder"
  FROM "pg_type" "t"
  JOIN "pg_enum" "e" ON "e"."enumtypid" = "t"."oid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "t"."typnamespace"
 WHERE "n"."nspname" = current_schema()
   AND "t"."typname" IN ('AuditAction','AuditSurface','PublishState','AuditChangeKind')
 ORDER BY 1, 3;

-- V2. The five audit columns now have their enum types, are still NOT NULL, and
--     publishState's default is the enum literal.
--     EXPECTED: 5 rows. udt_name = AuditAction / AuditSurface / PublishState /
--     AdminRole / AuditChangeKind, data_type = USER-DEFINED, is_nullable = NO,
--     publishState column_default = 'NONE'::"PublishState".
SELECT "table_name", "column_name", "data_type", "udt_name", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema()
   AND ("table_name", "column_name") IN (
     ('AuditEvent','action'), ('AuditEvent','surface'), ('AuditEvent','publishState'),
     ('AuditEvent','actorRole'), ('AuditChange','kind'))
 ORDER BY 1, 2;

-- V3. No value moved. Compare this against P3 line for line: the counts must be
--     identical and the labels must read the same.
SELECT 'AuditEvent.action' AS "column", "action"::text AS "value", count(*) AS "rows"
  FROM "AuditEvent" GROUP BY 2
UNION ALL SELECT 'AuditEvent.surface',      "surface"::text,      count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditEvent.publishState', "publishState"::text, count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditEvent.actorRole',    "actorRole"::text,    count(*) FROM "AuditEvent"  GROUP BY 2
UNION ALL SELECT 'AuditChange.kind',        "kind"::text,         count(*) FROM "AuditChange" GROUP BY 2
 ORDER BY 1, 2;

-- V4. The two table rewrites kept every index and both foreign keys. "surface"
--     and "actorRole" gained no CHECK and the three old ones are gone.
--     EXPECTED indexes: AuditEvent_pkey, AuditEvent_createdAt_idx,
--     AuditEvent_actorId_idx, AuditEvent_publishState_publishedAt_idx,
--     AuditChange_pkey, AuditChange_eventId_seq_idx, and (still, until CONTRACT)
--     AuditChange_entity_rowId_idx.
--     EXPECTED constraints: AuditEvent_actorId_fkey (f), AuditChange_eventId_fkey
--     (f), the two pkeys (p), and ZERO rows with contype 'c'.
SELECT 'index' AS "kind", "t"."relname" AS "table", "i"."relname" AS "name",
       pg_get_indexdef("i"."oid") AS "definition"
  FROM "pg_class" "t"
  JOIN "pg_index" "x" ON "x"."indrelid" = "t"."oid"
  JOIN "pg_class" "i" ON "i"."oid" = "x"."indexrelid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "t"."relnamespace"
 WHERE "n"."nspname" = current_schema() AND "t"."relname" IN ('AuditEvent','AuditChange')
UNION ALL
SELECT 'constraint ' || "co"."contype", "cl"."relname", "co"."conname",
       pg_get_constraintdef("co"."oid")
  FROM "pg_constraint" "co"
  JOIN "pg_class" "cl" ON "cl"."oid" = "co"."conrelid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "cl"."relnamespace"
 WHERE "n"."nspname" = current_schema() AND "cl"."relname" IN ('AuditEvent','AuditChange')
 ORDER BY 2, 1, 3;

-- V5. The five new FKs exist with the right referential actions, and the sixth
--     (pre-existing) one is untouched.
--     EXPECTED: 6 rows, every one "ON UPDATE CASCADE ON DELETE SET NULL",
--     every one convalidated = true.
SELECT "cl"."relname" AS "table", "co"."conname", "co"."convalidated",
       pg_get_constraintdef("co"."oid") AS "definition"
  FROM "pg_constraint" "co"
  JOIN "pg_class" "cl" ON "cl"."oid" = "co"."conrelid"
  JOIN "pg_namespace" "n" ON "n"."oid" = "cl"."relnamespace"
 WHERE "n"."nspname" = current_schema() AND "co"."contype" = 'f'
   AND "co"."conname" IN ('MessageReply_sentById_fkey','MediaAsset_uploadedById_fkey',
                          'TrackedLink_createdById_fkey','FeatureFlag_updatedById_fkey',
                          'RevalidationLog_actorId_fkey','AuditEvent_actorId_fkey')
 ORDER BY 1;

-- V6. Every backfilled name matches its AdminUser row, and no row has an id
--     without a name.
--     EXPECTED: 0 rows from both halves.
SELECT 'mismatch' AS "problem", 'MessageReply' AS "table", "r"."id"::text AS "row",
       "r"."sentByName" AS "stored", "a"."name" AS "expected"
  FROM "MessageReply" "r" JOIN "AdminUser" "a" ON "a"."id" = "r"."sentById"
 WHERE "r"."sentByName" IS DISTINCT FROM "a"."name"
UNION ALL
SELECT 'mismatch', 'FeatureFlag', "f"."key", "f"."updatedByName", "a"."name"
  FROM "FeatureFlag" "f" JOIN "AdminUser" "a" ON "a"."id" = "f"."updatedById"
 WHERE "f"."updatedByName" IS DISTINCT FROM "a"."name"
UNION ALL
SELECT 'mismatch', 'RevalidationLog', "l"."id"::text, "l"."actorName", "a"."name"
  FROM "RevalidationLog" "l" JOIN "AdminUser" "a" ON "a"."id" = "l"."actorId"
 WHERE "l"."actorName" IS DISTINCT FROM "a"."name"
UNION ALL
SELECT 'id without name', 'MessageReply', "id"::text, "sentByName", NULL
  FROM "MessageReply" WHERE "sentById" IS NOT NULL AND "sentByName" IS NULL
UNION ALL
SELECT 'id without name', 'FeatureFlag', "key", "updatedByName", NULL
  FROM "FeatureFlag" WHERE "updatedById" IS NOT NULL AND "updatedByName" IS NULL
UNION ALL
SELECT 'id without name', 'RevalidationLog', "id"::text, "actorName", NULL
  FROM "RevalidationLog" WHERE "actorId" IS NOT NULL AND "actorName" IS NULL
 ORDER BY 1, 2;

-- V7. The two AdminUser columns landed with the right types and the right
--     nullability/default, and every existing row reads "not locked, no misses".
--     EXPECTED: one row per admin, lockedUntil NULL and otpAttempts 0 on all of
--     them; and the information_schema half shows
--     lockedUntil / timestamp without time zone / 3 / YES / NULL and
--     otpAttempts / integer / NO / 0.
SELECT "column_name", "data_type", "datetime_precision", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'AdminUser'
   AND "column_name" IN ('lockedUntil','otpAttempts')
 ORDER BY 1;

SELECT "id", "email", "role", "failedAttempts", "lockedUntil", "otpAttempts"
  FROM "AdminUser" ORDER BY "createdAt";

-- V8. Row counts are unchanged from P9. Nothing in EXPAND inserts or deletes.
SELECT
  (SELECT count(*) FROM "AdminUser")       AS "adminUsers",
  (SELECT count(*) FROM "ContactMessage")  AS "contactMessages",
  (SELECT count(*) FROM "MessageReply")    AS "messageReplies",
  (SELECT count(*) FROM "MediaAsset")      AS "mediaAssets",
  (SELECT count(*) FROM "TrackedLink")     AS "trackedLinks",
  (SELECT count(*) FROM "FeatureFlag")     AS "featureFlags",
  (SELECT count(*) FROM "RevalidationLog") AS "revalidationLogs",
  (SELECT count(*) FROM "AuditEvent")      AS "auditEvents",
  (SELECT count(*) FROM "AuditChange")     AS "auditChanges";

-- V9. "ContactMessage"."read" is STILL THERE, still boolean NOT NULL DEFAULT
--     false, and still in lockstep with "status". This is the single most
--     important verification in the file: it is what proves the deployed v1
--     contact form and inbox are untouched, and it captures the exact definition
--     the contract file's rollback has to reproduce.
--     EXPECTED: read = boolean / NO / false, and disagreements = 0,
--     readTrue = 9 (data-facts.txt "ContactMessage read=true: 9", plus anything
--     the inbox has done since).
SELECT "column_name", "data_type", "is_nullable", "column_default"
  FROM "information_schema"."columns"
 WHERE "table_schema" = current_schema() AND "table_name" = 'ContactMessage'
   AND "column_name" = 'read';

SELECT count(*) FILTER (WHERE "read")                                   AS "readTrue",
       count(*) FILTER (WHERE "status" <> 'UNREAD')                      AS "notUnread",
       count(*) FILTER (WHERE "read" <> ("status" <> 'UNREAD'))          AS "disagreements"
  FROM "ContactMessage";


-- =============================================================================
-- ROLLBACK OF EXPAND. Undo T2 first, then T1, then T0. Each block is its own
-- transaction. None of this loses a row.
-- =============================================================================
--
-- -- Undo T2 (the enum pass). Exact: every value round-trips through text.
-- BEGIN;
-- ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" DROP DEFAULT;
-- ALTER TABLE "AuditEvent"  ALTER COLUMN "action"       TYPE TEXT USING "action"::text;
-- ALTER TABLE "AuditEvent"  ALTER COLUMN "surface"      TYPE TEXT USING "surface"::text;
-- ALTER TABLE "AuditEvent"  ALTER COLUMN "publishState" TYPE TEXT USING "publishState"::text;
-- ALTER TABLE "AuditEvent"  ALTER COLUMN "actorRole"    TYPE TEXT USING "actorRole"::text;
-- ALTER TABLE "AuditChange" ALTER COLUMN "kind"         TYPE TEXT USING "kind"::text;
-- ALTER TABLE "AuditEvent" ALTER COLUMN "publishState" SET DEFAULT 'NONE';
-- ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_action_check"
--   CHECK ("action" IN ('SAVE','SAVE_AND_PUBLISH','PUBLISH'));
-- ALTER TABLE "AuditEvent"  ADD CONSTRAINT "AuditEvent_publishState_check"
--   CHECK ("publishState" IN ('NONE','OK','FAILED'));
-- ALTER TABLE "AuditChange" ADD CONSTRAINT "AuditChange_kind_check"
--   CHECK ("kind" IN ('CREATE','UPDATE','DELETE','REORDER'));
-- DROP TYPE "AuditAction";
-- DROP TYPE "AuditSurface";
-- DROP TYPE "PublishState";
-- DROP TYPE "AuditChangeKind";
-- COMMIT;
--
-- DO NOT DROP "AdminRole": it predates this cluster and still types
-- "AdminUser"."role". The four DROP TYPEs must come last and will fail while any
-- column still references them, which is the safety net.
--
-- -- Undo T1 (the additive work).
-- BEGIN;
-- ALTER TABLE "RevalidationLog" DROP CONSTRAINT IF EXISTS "RevalidationLog_actorId_fkey";
-- DROP INDEX IF EXISTS "RevalidationLog_actorId_idx";
-- ALTER TABLE "FeatureFlag"  DROP CONSTRAINT IF EXISTS "FeatureFlag_updatedById_fkey";
-- DROP INDEX IF EXISTS "FeatureFlag_updatedById_idx";
-- ALTER TABLE "TrackedLink"  DROP CONSTRAINT IF EXISTS "TrackedLink_createdById_fkey";
-- DROP INDEX IF EXISTS "TrackedLink_createdById_idx";
-- ALTER TABLE "MediaAsset"   DROP CONSTRAINT IF EXISTS "MediaAsset_uploadedById_fkey";
-- DROP INDEX IF EXISTS "MediaAsset_uploadedById_idx";
-- ALTER TABLE "MessageReply" DROP CONSTRAINT IF EXISTS "MessageReply_sentById_fkey";
-- DROP INDEX IF EXISTS "MessageReply_sentById_idx";
-- ALTER TABLE "RevalidationLog" DROP COLUMN IF EXISTS "actorName";
-- ALTER TABLE "FeatureFlag"     DROP COLUMN IF EXISTS "updatedByName";
-- ALTER TABLE "MessageReply"    DROP COLUMN IF EXISTS "sentByName";
-- ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "otpAttempts";
-- ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "lockedUntil";
-- COMMIT;
--
-- Dropping the three name columns destroys only a copy that the UPDATEs in T1
-- section 2 recompute, for as long as the "AdminUser" rows they came from still
-- exist — which is precisely the window those columns exist to outlive. A
-- rollback re-opens a hole rather than losing data today.
--
-- T0 is NOT reversible: Postgres has no ALTER TYPE ... DROP VALUE. If you ran it
-- and need it gone, that is a type rebuild, and AdminUser.role depends on the
-- type. Do not run T0 unless P6 told you to.
-- =============================================================================
