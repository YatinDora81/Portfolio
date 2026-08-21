/**
 * Every cache tag in the project, built in exactly one place.
 *
 * A tag is a string that nothing validates. Write `blog:${slug}` inline and get
 * one character wrong and there is no error, no warning and no failing test —
 * the invalidation simply never matches, and that page stays stale until its
 * 24-hour ISR window expires. The bug looks like "caching is flaky". Importing
 * from here makes the typo a compile error instead.
 *
 * Client-safe on purpose: the tag for a thing and the act of invalidating it are
 * different concerns, and only the second one is server work.
 */
export const tags = {
  blog: (slug: string) => `blog:${slug}`,
  blogIndex: () => "blogs",
  /**
   * Keyed by id, not slug — Project has no slug and no unique string column at
   * all. Changing that is Phase 04's problem; until then the id is the only
   * stable handle a project has.
   */
  project: (id: string) => `project:${id}`,
  projectIndex: () => "projects",
  siteConfig: () => "site-config",
  flags: () => "flags",
} as const;

/** Everything to invalidate when one blog changes: the post and the list it appears in. */
export function blogTags(slug: string): string[] {
  return [tags.blog(slug), tags.blogIndex()];
}

export function projectTags(id: string): string[] {
  return [tags.project(id), tags.projectIndex()];
}

/**
 * The tags the stale-detector watches and the admin offers as manual buttons.
 * Per-row tags are deliberately absent — they are unbounded, and the detector
 * finds those by comparing each row's `updatedAt` instead.
 */
export const ALL_KNOWN_TAGS: string[] = [
  tags.blogIndex(),
  tags.projectIndex(),
  tags.siteConfig(),
  tags.flags(),
];
