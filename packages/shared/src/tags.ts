// Build every tag here — an inline typo silently never matches and nothing errors.
export const tags = {
  blog: (slug: string) => `blog:${slug}`,
  blogIndex: () => "blogs",
  /** Keyed by id — Project has no slug column. */
  project: (id: string) => `project:${id}`,
  projectIndex: () => "projects",
  siteConfig: () => "site-config",
  flags: () => "flags",
} as const;

export function blogTags(slug: string): string[] {
  return [tags.blog(slug), tags.blogIndex()];
}

export function projectTags(id: string): string[] {
  return [tags.project(id), tags.projectIndex()];
}

// Per-row tags are deliberately absent — they are unbounded.
export const ALL_KNOWN_TAGS: string[] = [
  tags.blogIndex(),
  tags.projectIndex(),
  tags.siteConfig(),
  tags.flags(),
];
