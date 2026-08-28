export const tags = {
  blog: (slug: string) => `blog:${slug}`,
  blogIndex: () => "blogs",
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

export const ALL_KNOWN_TAGS: string[] = [
  tags.blogIndex(),
  tags.projectIndex(),
  tags.siteConfig(),
  tags.flags(),
];
