import "server-only";

import type { ContentStatus } from "./generated/prisma/enums";

/**
 * The one definition of "a visitor may see this".
 *
 * Every public query for a Blog or a Project goes through here. Not because
 * centralising is tidy, but because the failure mode is silent and permanent:
 * a hand-written `where` that forgets one clause does not error, does not fail
 * a type check and does not fail a test — it just serves an unfinished post to
 * the internet, and nothing says so until someone notices. A missed call site
 * is the only way a draft leaks, so there is exactly one place to get right.
 *
 * **Never hand-write these clauses anywhere else.** If a new surface needs
 * public content, it imports from here.
 */

/**
 * Live to the public: published AND its date has arrived.
 *
 * Both halves are load-bearing. `status: PUBLISHED` alone would expose a post
 * dated next Tuesday the moment someone marked it published, and `publishedAt`
 * alone would expose an archived one.
 *
 * The `now` parameter exists so a caller inside a cached read can pass the
 * timestamp the cache entry was computed at, rather than letting each call
 * invent its own and make two queries in one render disagree about the minute.
 */
export function publicContentWhere(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    publishedAt: { lte: now },
  };
}

/**
 * Preview: everything except ARCHIVED.
 *
 * Archived is excluded deliberately. Preview exists to look at work on its way
 * somewhere — a draft, or something scheduled — and an archived post has been
 * retired on purpose. Resurrecting it behind a preview link would make "I
 * archived that" mean less than it should.
 */
export function previewContentWhere() {
  // Annotated, not `as const`. Prisma's filter declares `in?: ContentStatus[]`
  // — a *mutable* array — and a readonly tuple is not assignable to one, so the
  // `as const` this used to carry made the whole filter fail to typecheck at
  // every call site that actually passed it to a query. Annotating with the
  // generated enum keeps the members narrow (a bare literal would widen to
  // `string[]` and stop matching) and turns a future rename of a status into a
  // compile error here instead of a filter that silently matches nothing.
  //
  // Built per call so the array Prisma receives is never shared between queries.
  const statuses: ContentStatus[] = ["DRAFT", "SCHEDULED", "PUBLISHED"];
  return { status: { in: statuses } };
}

/**
 * Pick the filter for the current request. `isPreview` comes from
 * `(await draftMode()).isEnabled` — a signed cookie, never a query parameter.
 */
export function contentWhere(isPreview: boolean, now = new Date()) {
  return isPreview ? previewContentWhere() : publicContentWhere(now);
}
