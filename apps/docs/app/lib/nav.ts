import type { ComponentType } from "react";
import {
  IconLayoutGrid, IconInbox, IconSparkles, IconUser, IconCpu, IconBriefcase,
  IconFolderCode, IconPencil, IconQuote, IconTag, IconSettings2, IconShieldCheck,
  IconSend, IconChartBar, IconPalette, IconTerminal2, IconHistory, IconPaw,
  IconNotebook, IconRefreshDot, IconToggleLeft, IconPhoto, IconLink, IconChartAreaLine,
  IconStackBack,
} from "@tabler/icons-react";

export type NavIcon = ComponentType<{ size?: number; className?: string; stroke?: number }>;

export interface NavLink {
  href: string;
  label: string;
  n?: string;
  mark?: string;
  icon: NavIcon;
  eyebrow: string;
  keywords?: string;
  badge?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavLink[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: IconLayoutGrid, eyebrow: "control room · overview" },
      { href: "/messages", label: "Inbox", icon: IconInbox, eyebrow: "contact form → you", badge: true },
      { href: "/notes", label: "Notes", icon: IconNotebook, eyebrow: "private · q&a vault",
        keywords: "questions answers revision interview prep folders dsa tags vault search" },
      { href: "/refer-emails", label: "Refer emails", icon: IconSend, eyebrow: "outreach · campaign sheet" },
      { href: "/tracker", label: "Tracker", icon: IconChartBar, eyebrow: "outreach · attribution" },
      { href: "/tracked-links", label: "Tracked links", icon: IconLink, eyebrow: "outreach · short links",
        keywords: "short link shortener qr code slug redirect clicks campaign channel resume utm" },
      { href: "/analytics", label: "Analytics", icon: IconChartAreaLine, eyebrow: "traffic · sessions & sections",
        keywords: "visits sessions uniques channels funnel reach dwell median attention rollup daily stats devices mobile desktop summarize" },
    ],
  },
  {
    label: "The page · top to bottom",
    items: [
      { href: "/background", mark: "~~~", label: "Background", icon: IconStackBack,
        eyebrow: "the background · a layer under the page",
        keywords: "background terrain contour lines beams canvas layer v1 v2 noise veil strength cell levels opacity" },
      { href: "/hero", n: "01", label: "Hero", icon: IconSparkles, eyebrow: "section 01 · top of the page",
        keywords: "social links resume cv titles badges intro tagline photos version" },
      { href: "/cat", mark: "^..^", label: "Cat", icon: IconPaw, eyebrow: "the cat · a layer over the page" },
      { href: "/about", n: "02", label: "About", icon: IconUser, eyebrow: "section 02",
        keywords: "paragraphs bio education degree university timeline" },
      { href: "/terminal", mark: ">_", label: "Terminal (whoami)", icon: IconTerminal2, eyebrow: "section 02 · reference · about terminal" },
      { href: "/skills", n: "03", label: "Skills", icon: IconCpu, eyebrow: "section 03" },
      { href: "/experiences", n: "04", label: "Experience", icon: IconBriefcase, eyebrow: "section 04" },
      { href: "/projects", n: "05", label: "Projects", icon: IconFolderCode, eyebrow: "section 05" },
      { href: "/blogs", n: "06", label: "Blogs", icon: IconPencil, eyebrow: "section 06" },
      { href: "/quotes", n: "07", label: "Thought of the day", icon: IconQuote, eyebrow: "section 07" },
      { href: "/contact-purposes", n: "08", label: "Contact", icon: IconTag, eyebrow: "section 08 · contact form",
        keywords: "purposes github refresh contributions availability email" },
    ],
  },
  {
    label: "Site & access",
    items: [
      { href: "/site-config", label: "Site chrome", icon: IconSettings2, eyebrow: "site-wide · navbar + footer" },
      { href: "/admin-users", label: "Admins & roles", icon: IconShieldCheck, eyebrow: "access control" },
      { href: "/history", label: "Change history", icon: IconHistory, eyebrow: "access control · audit" },
      { href: "/revalidation", label: "Revalidation", icon: IconRefreshDot, eyebrow: "operations · cache health" },
      { href: "/flags", label: "Feature flags", icon: IconToggleLeft, eyebrow: "operations · kill switches" },
      { href: "/media", label: "Media", icon: IconPhoto, eyebrow: "library · images",
        keywords: "images uploads assets r2 bucket cdn alt text orphans unused photos blur" },
      { href: "/icons", label: "Icon library", icon: IconPalette, eyebrow: "reference · icon keys" },
    ],
  },
];

export const ALL_NAV: NavLink[] = NAV_GROUPS.flatMap((g) => g.items);

// longest-prefix match so nested routes keep their parent active
export function matchNav(pathname: string): NavLink | undefined {
  return ALL_NAV.filter((x) => pathname === x.href || pathname.startsWith(x.href + "/")).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
}

export function navMark(x: NavLink): string | undefined {
  return x.n ?? x.mark;
}

export function navGroupOf(x: NavLink): string | null {
  return NAV_GROUPS.find((g) => g.items.includes(x))?.label ?? null;
}
