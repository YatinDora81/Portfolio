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
