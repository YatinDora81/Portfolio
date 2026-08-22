/** `education` is a div inside `#about`, not a section of its own. */
export const SECTIONS = [
  'hero',
  'about',
  'skills',
  'experience',
  'projects',
  'blogs',
  'contact',
] as const;

export type SectionId = (typeof SECTIONS)[number];
