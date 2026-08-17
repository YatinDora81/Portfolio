import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { isOutermostTrashRoot } from "./paths";
import type { VaultAnswer, VaultPayload, VaultRow } from "./vault-view";

/**
 * The vault's one read.
 *
 * Three queries in one wave, once, for everything the whole section renders —
 * the live rows, their answers, and the count for the trash badge. Every view
 * under /notes is arithmetic over this payload from here on (see
 * vault-view.ts), so moving between two notes touches Postgres zero times where
 * it used to take three or four sequential round trips.
 *
 * **The answers are their own query on purpose.** Asking for them as a relation
 * — `answer: { select: … }` on the node query — reads like one round trip and is
 * two: without `relationJoins` enabled, Prisma resolves the relation with a
 * second statement keyed on the ids the first returned, so it cannot start until
 * the first has finished. Measured on this vault, five rounds each: 574ms as a
 * relation against 469ms with all three in flight together. That difference is
 * paid on every write, because every write invalidates this.
 *
 * Cached, and invalidated by `touched()` in lib/actions/notes.ts, which every
 * write in the feature already funnels through. Between two writes the vault
 * genuinely cannot change, so between two writes there is nothing to ask. The
 * `revalidate` ceiling is not the mechanism — the tag is — it is the bound on
 * what happens if the mechanism is lost: the default file-system cache keeps its
 * tag manifest in a per-process Map while the entry itself is on disk, so a
 * restart that inherits `.next/cache` inherits the data and forgets every
 * invalidation. Five minutes is what that costs instead of a year.
 *
 * The payload is ~420 KB of JSON at 436 live rows. Worth knowing: past ~2 MB the
 * data cache stops writing an entry at all, and a vault that big would want the
 * bodies split back out of it — see the tripwire below.
 */
export const VAULT_TAG = "notes-vault";

/** A ceiling, not the mechanism. See the note above. */
const CEILING_SECONDS = 300;

const NODE_SELECT = {
  id: true,
  parentId: true,
  kind: true,
  title: true,
  slug: true,
  path: true,
  depth: true,
  sortOrder: true,
} as const;

async function readVault(): Promise<VaultPayload> {
  const [nodes, answers, roots] = await Promise.all([
    prisma.noteNode.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: NODE_SELECT,
    }),
    // Every live answer, by nodeId, joined in memory below. Trashed rows are
    // excluded through the relation rather than by a second pass, so the two
    // queries describe the same vault.
    prisma.noteAnswer.findMany({
      where: { node: { deletedAt: null } },
      select: { nodeId: true, body: true, tags: true, confidence: true, lastRevisedAt: true },
    }),
    // Listed rather than `count()`ed, because the badge means "things you threw
    // away", and a row absorbed into an ancestor's tombstone is not one of them
    // — the same rule the Trash page filters on.
    prisma.noteNode.findMany({
      where: { trashRoot: true, NOT: { deletedAt: null } },
      select: { id: true, path: true },
    }),
  ]);

  // `lastRevisedAt` becomes a string here and nowhere else: this payload is both
  // cached and handed to client components, and a Date survives neither crossing
  // intact — it would be a Date on a miss and a string on a hit, a bug that only
  // appears once the cache warms.
  const byNode = new Map<string, VaultAnswer>(
    answers.map((a) => [
      a.nodeId,
      {
        body: a.body,
        tags: a.tags,
        confidence: a.confidence,
        lastRevisedAt: a.lastRevisedAt?.toISOString() ?? null,
      },
    ]),
  );

  const payload: VaultPayload = {
    rows: nodes.map((n): VaultRow => ({ ...n, answer: byNode.get(n.id) ?? null })),
    trashCount: roots.filter(isOutermostTrashRoot).length,
    // Read off the queries already in flight rather than counted again, and
    // exact rather than approximate: trashing always marks the row it was called
    // on, so a vault with no live rows and no trashRoot rows has no rows at all.
    // It gates `restore`, the one mode that refuses a vault holding anything —
    // trashed rows included.
    vaultEmpty: nodes.length === 0 && roots.length === 0,
  };

  // The one failure mode that is invisible in production: past ~2 MB the data
  // cache stops writing an entry, silently, and every navigation goes back to
  // Neon with nothing on screen to say why. 420 KB today, at 436 rows.
  if (process.env.NODE_ENV !== "production") {
    const kb = Math.round(JSON.stringify(payload).length / 1024);
    if (kb > 1400) console.warn(`[notes] vault payload is ${kb} KB — the data cache stops at 2 MB`);
  }

  return payload;
}

export const loadVault = unstable_cache(readVault, ["notes-vault"], {
  tags: [VAULT_TAG],
  revalidate: CEILING_SECONDS,
});
