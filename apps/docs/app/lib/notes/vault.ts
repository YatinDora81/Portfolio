import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { isOutermostTrashRoot } from "./paths";
import type { VaultAnswer, VaultAttachment, VaultPayload, VaultRow } from "./vault-view";

export const VAULT_TAG = "notes-vault";

const CEILING_SECONDS = 300;

const NO_ATTACHMENTS: VaultAttachment[] = [];

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
  const [nodes, answers, attachments, roots] = await Promise.all([
    prisma.noteNode.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: NODE_SELECT,
    }),
    prisma.noteAnswer.findMany({
      where: { node: { deletedAt: null } },
      select: { nodeId: true, body: true, tags: true, confidence: true, lastRevisedAt: true },
    }),
    prisma.noteAttachment.findMany({
      where: { node: { deletedAt: null } },
      orderBy: [{ nodeId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        nodeId: true,
        caption: true,
        sortOrder: true,
        asset: {
          select: {
            id: true,
            url: true,
            filename: true,
            mimeType: true,
            bytes: true,
            width: true,
            height: true,
            altText: true,
          },
        },
      },
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

  const attachedTo = new Map<string, VaultAttachment[]>();
  for (const a of attachments) {
    const list = attachedTo.get(a.nodeId);
    const entry: VaultAttachment = {
      id: a.id,
      assetId: a.asset.id,
      url: a.asset.url,
      filename: a.asset.filename,
      mimeType: a.asset.mimeType,
      bytes: a.asset.bytes,
      width: a.asset.width,
      height: a.asset.height,
      altText: a.asset.altText,
      caption: a.caption,
      sortOrder: a.sortOrder,
    };
    if (list) list.push(entry);
    else attachedTo.set(a.nodeId, [entry]);
  }

  const payload: VaultPayload = {
    rows: nodes.map((n): VaultRow => ({
      ...n,
      answer: byNode.get(n.id) ?? null,
      attachments: attachedTo.get(n.id) ?? NO_ATTACHMENTS,
    })),
    trashCount: roots.filter(isOutermostTrashRoot).length,
    vaultEmpty: nodes.length === 0 && roots.length === 0,
  };

  if (process.env.NODE_ENV !== "production") {
    const kb = Math.round(JSON.stringify(payload).length / 1024);
    if (kb > 1400) {
      console.warn(
        `[notes] vault payload is ${kb} KB — the data cache stops at 2 MB (${attachments.length} attachments)`,
      );
    }
  }

  return payload;
}

export const loadVault = unstable_cache(readVault, ["notes-vault"], {
  tags: [VAULT_TAG],
  revalidate: CEILING_SECONDS,
});
