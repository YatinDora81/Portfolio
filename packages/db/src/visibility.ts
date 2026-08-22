import "server-only";

import type { ContentStatus } from "./generated/prisma/enums";

// Never hand-write a visibility `where` elsewhere: a missing clause leaks a draft
// silently. Both clauses matter — status alone exposes a future-dated post.
export function publicContentWhere(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    publishedAt: { lte: now },
  };
}

export function previewContentWhere() {
  // Annotated, not `as const` — Prisma's `in` takes a mutable `ContentStatus[]`.
  const statuses: ContentStatus[] = ["DRAFT", "SCHEDULED", "PUBLISHED"];
  return { status: { in: statuses } };
}

// `isPreview` comes from `(await draftMode()).isEnabled` — never a query parameter.
export function contentWhere(isPreview: boolean, now = new Date()) {
  return isPreview ? previewContentWhere() : publicContentWhere(now);
}
