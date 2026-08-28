import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { isOutermostTrashRoot } from "./paths";
import type { VaultAnswer, VaultPayload, VaultRow } from "./vault-view";

export const VAULT_TAG = "notes-vault";

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
    prisma.noteAnswer.findMany({
      where: { node: { deletedAt: null } },
      select: { nodeId: true, body: true, tags: true, confidence: true, lastRevisedAt: true },
    }),
    prisma.noteNode.findMany({
      where: { trashRoot: true, NOT: { deletedAt: null } },
      select: { id: true, path: true },
    }),
  ]);

  // iso string, not Date: a Date would not survive the cache
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
    vaultEmpty: nodes.length === 0 && roots.length === 0,
  };

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
