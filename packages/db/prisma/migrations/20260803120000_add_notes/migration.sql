-- The private notes / Q&A vault. Purely additive — two new tables and one new
-- enum, nothing existing is touched — so this can be applied ahead of the code
-- deploy and rolled back by dropping them again.
--
-- Shape: NoteNode is one self-referencing tree holding both folders and
-- questions; NoteAnswer carries the body a question answers with. They are two
-- tables rather than one because the sidebar loads EVERY node on every page and
-- must never drag an answer body along with it.

CREATE TYPE "NoteKind" AS ENUM ('FOLDER', 'QUESTION');

CREATE TABLE "NoteNode" (
  "id"       TEXT NOT NULL,
  "parentId" TEXT,

  "kind"  "NoteKind" NOT NULL,
  "title" TEXT NOT NULL,
  "slug"  TEXT NOT NULL,

  -- Materialised ancestry: '/dsa/graphs/dijkstra'. `parentId` above is the
  -- source of truth for structure; this is a denormalised index over it,
  -- rewritten for the whole subtree by every rename and every move. Keeping it
  -- turns two recursive queries into string comparisons: "is this folder inside
  -- itself" is a prefix test, and `in:/dsa` is a prefix scan.
  "path"  TEXT NOT NULL,
  "depth" INTEGER NOT NULL DEFAULT 0,

  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  -- Soft delete. A trashed folder takes its subtree with it, and `trashRoot`
  -- marks the node somebody actually trashed, so Trash lists the gesture rather
  -- than each of the rows it swept up, and restore knows where to start.
  "deletedAt" TIMESTAMP(3),
  "trashRoot" BOOLEAN NOT NULL DEFAULT false,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NoteNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoteAnswer" (
  "nodeId" TEXT NOT NULL,

  "body" TEXT NOT NULL DEFAULT '',
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- 0 unrated · 1 again · 2 shaky · 3 good · 4 solid. Drives the revise queue,
  -- which sorts by this then by lastRevisedAt with nulls first.
  "confidence"    INTEGER NOT NULL DEFAULT 0,
  "lastRevisedAt" TIMESTAMP(3),

  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NoteAnswer_pkey" PRIMARY KEY ("nodeId")
);

-- This unique is load-bearing twice over. It is the guard against two live
-- nodes sharing a path, and it is the ONLY thing stopping two root folders
-- sharing a name: a UNIQUE("parentId","slug") could not, because Postgres
-- treats NULLs as distinct and every root row has a NULL parentId.
--
-- Its cost is that trashing a folder has to move it out of the live namespace
-- rather than merely flagging it — see the '~trash/<id>' tombstone the app
-- writes, without which trashing /dsa/dp and creating a new /dsa/dp collides.
CREATE UNIQUE INDEX "NoteNode_path_key" ON "NoteNode"("path");

CREATE INDEX "NoteNode_parentId_sortOrder_idx" ON "NoteNode"("parentId", "sortOrder");
CREATE INDEX "NoteNode_deletedAt_idx" ON "NoteNode"("deletedAt");
CREATE INDEX "NoteAnswer_confidence_idx" ON "NoteAnswer"("confidence");

-- Prisma will not generate either of the two below.
--
-- The unique above is a btree in the database's own collation, and on any
-- collation but C that index cannot serve `path LIKE '/dsa%'`. Without this
-- second opclass copy, every `in:` scope in the search language quietly
-- degrades to a sequential scan.
CREATE INDEX "NoteNode_path_prefix_idx" ON "NoteNode" ("path" text_pattern_ops);

-- Tag containment: tags @> ARRAY['redis'], which is what `tag:redis` compiles to.
CREATE INDEX "NoteAnswer_tags_idx" ON "NoteAnswer" USING GIN ("tags");

-- CASCADE on both: purging a folder is meant to take its descendants and their
-- answers with it, and that is the database's job rather than a recursive
-- delete in application code.
ALTER TABLE "NoteNode"
  ADD CONSTRAINT "NoteNode_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "NoteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NoteAnswer"
  ADD CONSTRAINT "NoteAnswer_nodeId_fkey"
  FOREIGN KEY ("nodeId") REFERENCES "NoteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
