export const FLAG_KEYS = {
  SECTION_ABOUT: "section.about",
  SECTION_SKILLS: "section.skills",
  SECTION_EXPERIENCE: "section.experience",
  SECTION_PROJECTS: "section.projects",
  SECTION_BLOGS: "section.blogs",
  SECTION_CONTACT: "section.contact",
  CONTACT_FORM: "contact.form",
  ANALYTICS: "analytics.enabled",
  EASTER_EGGS: "easter-eggs.enabled",
} as const;

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS];

export type FlagDefinition = {
  key: FlagKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  group: "Sections" | "System";
};

export const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: FLAG_KEYS.SECTION_ABOUT,
    label: "About section",
    description: "The terminal-style About block, and the education list inside it.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.SECTION_SKILLS,
    label: "Skills section",
    description: "The periodic table of skills.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.SECTION_EXPERIENCE,
    label: "Experience section",
    description: "Work history.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.SECTION_PROJECTS,
    label: "Projects section",
    description: "The build log.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.SECTION_BLOGS,
    label: "Blogs section",
    description:
      "The blog list on the homepage. Turning this off also hides the nav link and the back-links on a post.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.SECTION_CONTACT,
    label: "Contact section",
    description: "The whole contact block, including the hero's two call-to-action buttons.",
    defaultEnabled: true,
    group: "Sections",
  },
  {
    key: FLAG_KEYS.CONTACT_FORM,
    label: "Contact form submissions",
    description:
      "Kill switch for a spam flood. The section stays visible; the form itself stops accepting. Reads are cached, so one more submission can land after you flip it.",
    defaultEnabled: true,
    group: "System",
  },
  {
    key: FLAG_KEYS.ANALYTICS,
    label: "Analytics collection",
    description: "Kill switch for the collection endpoint.",
    defaultEnabled: true,
    group: "System",
  },
  {
    key: FLAG_KEYS.EASTER_EGGS,
    label: "Easter eggs",
    description:
      "The oneko cat that follows the cursor on desktop. The About terminal is not covered — it renders the About bio itself, so it lives and dies with the About section.",
    defaultEnabled: true,
    group: "System",
  },
];

const DEFAULT_BY_KEY = new Map<string, boolean>(
  FLAG_DEFINITIONS.map((d) => [d.key, d.defaultEnabled]),
);

export type FlagMap = Record<string, boolean>;

// fails open: a missing row must not blank out a section
export function flagValue(map: FlagMap, key: FlagKey): boolean {
  const stored = map[key];
  if (typeof stored === "boolean") return stored;
  return DEFAULT_BY_KEY.get(key) ?? true;
}

export function defaultFlagMap(): FlagMap {
  return Object.fromEntries(FLAG_DEFINITIONS.map((d) => [d.key, d.defaultEnabled]));
}
