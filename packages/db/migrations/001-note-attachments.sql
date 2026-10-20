-- ============================================================================
-- NOTE ATTACHMENTS. Additive, idempotent, re-runnable.
--
-- Adds NoteAttachment: the join between a notes QUESTION and a MediaAsset, so
-- one question can carry several PDFs and several images alongside its markdown
-- body.
--
-- Additive only. Nothing here drops or rewrites an existing object, so the
-- currently deployed code keeps working against it and this file is safe to
-- leave in place whether or not it is followed by a deploy.
--
-- ON DELETE: nodeId CASCADEs, because an attachment is meaningless without its
-- question. assetId RESTRICTs, because deleting a MediaAsset that a note still
-- points at is the bug this constraint exists to prevent -- the admin media
-- page blocks it earlier via media-references, and this is the backstop.
--
--   psql "$PGPROD" -v ON_ERROR_STOP=1 -f migrations/001-note-attachments.sql
-- ============================================================================

SET lock_timeout = '3s';
SET statement_timeout = '30s';

BEGIN;

CREATE TABLE IF NOT EXISTS "NoteAttachment" (
    "id"        TEXT NOT NULL,
    "nodeId"    TEXT NOT NULL,
    "assetId"   TEXT NOT NULL,
    "caption"   TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NoteAttachment_nodeId_sortOrder_idx"
    ON "NoteAttachment" ("nodeId", "sortOrder");

CREATE INDEX IF NOT EXISTS "NoteAttachment_assetId_idx"
    ON "NoteAttachment" ("assetId");

CREATE UNIQUE INDEX IF NOT EXISTS "NoteAttachment_nodeId_assetId_key"
    ON "NoteAttachment" ("nodeId", "assetId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
         WHERE "conname" = 'NoteAttachment_nodeId_fkey'
           AND "conrelid" = '"NoteAttachment"'::regclass
    ) THEN
        ALTER TABLE "NoteAttachment"
            ADD CONSTRAINT "NoteAttachment_nodeId_fkey"
            FOREIGN KEY ("nodeId") REFERENCES "NoteNode"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
         WHERE "conname" = 'NoteAttachment_assetId_fkey'
           AND "conrelid" = '"NoteAttachment"'::regclass
    ) THEN
        ALTER TABLE "NoteAttachment"
            ADD CONSTRAINT "NoteAttachment_assetId_fkey"
            FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
DECLARE
    "cols" INTEGER;
    "idx"  INTEGER;
    "fks"  INTEGER;
BEGIN
    SELECT count(*) INTO "cols" FROM "information_schema"."columns"
     WHERE "table_schema" = 'public' AND "table_name" = 'NoteAttachment';

    SELECT count(*) INTO "idx" FROM "pg_indexes"
     WHERE "schemaname" = 'public' AND "tablename" = 'NoteAttachment';

    SELECT count(*) INTO "fks" FROM "pg_constraint"
     WHERE "conrelid" = '"NoteAttachment"'::regclass AND "contype" = 'f';

    IF "cols" <> 6 THEN
        RAISE EXCEPTION 'NoteAttachment has % columns, expected 6', "cols";
    END IF;
    IF "idx" < 4 THEN
        RAISE EXCEPTION 'NoteAttachment has % indexes, expected at least 4', "idx";
    END IF;
    IF "fks" <> 2 THEN
        RAISE EXCEPTION 'NoteAttachment has % foreign keys, expected 2', "fks";
    END IF;

    RAISE NOTICE 'note-attachments verified: % columns, % indexes, % foreign keys', "cols", "idx", "fks";
END
$$;

COMMIT;

-- ============================================================================
-- ROLLBACK. Lossless only while no attachment rows exist; past that the rows
-- are the data, so take a dump first.
--
--   BEGIN;
--   DROP TABLE IF EXISTS "NoteAttachment";
--   COMMIT;
-- ============================================================================
