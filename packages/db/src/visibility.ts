import "server-only";

import type { ContentStatus } from "./generated/prisma/enums";

export function publicContentWhere(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    publishedAt: { lte: now },
  };
}

export function previewContentWhere() {
  // not `as const`: prisma's `in` takes a mutable array
  const statuses: ContentStatus[] = ["DRAFT", "SCHEDULED", "PUBLISHED"];
  return { status: { in: statuses } };
}

export function contentWhere(isPreview: boolean, now = new Date()) {
  return isPreview ? previewContentWhere() : publicContentWhere(now);
}
