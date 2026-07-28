import type { ComponentType } from "react";
import {
  IconLayoutGrid, IconInbox, IconSparkles, IconUser, IconCpu, IconBriefcase,
  IconFolderCode, IconPencil, IconQuote, IconTag, IconSettings2, IconShieldCheck,
  IconLink, IconSend, IconChartBar, IconSchool, IconPalette, IconTerminal2,
} from "@tabler/icons-react";

export type NavIcon = ComponentType<{ size?: number; className?: string; stroke?: number }>;

export interface NavLink {
  href: string;
  label: string;
  /** Section number shown in the sidebar for page-order items. */
  n?: string;
  icon: NavIcon;
  /** Topbar eyebrow — the small mono line above the title. */
  eyebrow: string;
  /** Unread count badge (inbox only). */
  badge?: boolean;
}

/**
 * The mockup collapses the CMS into 13 nav entries. We keep every existing
 * route and URL — the grouping below is purely how they're presented.
 */
export const NAV_TOP: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: IconLayoutGrid, eyebrow: "control room · overview" },
  { href: "/messages", label: "Inbox", icon: IconInbox, eyebrow: "contact form → you", badge: true },
  { href: "/refer-emails", label: "Refer emails", icon: IconSend, eyebrow: "outreach" },
  { href: "/tracker", label: "Tracker", icon: IconChartBar, eyebrow: "outreach" },
];

export const NAV_CONTENT: NavLink[] = [
  { href: "/hero", n: "01", label: "Hero", icon: IconSparkles, eyebrow: "section 01 · top of the page" },
  { href: "/about/paragraphs", n: "02", label: "About", icon: IconUser, eyebrow: "section 02" },
  { href: "/about/education", n: "02", label: "Education", icon: IconSchool, eyebrow: "section 02" },
  { href: "/skills", n: "03", label: "Skills", icon: IconCpu, eyebrow: "section 03" },
  { href: "/experiences", n: "04", label: "Experience", icon: IconBriefcase, eyebrow: "section 04" },
  { href: "/projects", n: "05", label: "Projects", icon: IconFolderCode, eyebrow: "section 05" },
  { href: "/blogs", n: "06", label: "Blogs", icon: IconPencil, eyebrow: "section 06" },
  { href: "/quotes", n: "07", label: "Quotes", icon: IconQuote, eyebrow: "section 07 · thought of the day" },
  { href: "/contact-purposes", n: "08", label: "Contact form", icon: IconTag, eyebrow: "section 08 · contact form" },
];

export const NAV_SITE: NavLink[] = [
  { href: "/links", label: "Social & resume", icon: IconLink, eyebrow: "site-wide · hero + footer" },
  { href: "/site-config", label: "Site config", icon: IconSettings2, eyebrow: "site-wide" },
  { href: "/admin-users", label: "Admins & roles", icon: IconShieldCheck, eyebrow: "access control" },
  { href: "/icons", label: "Icon library", icon: IconPalette, eyebrow: "reference · icon keys" },
  { href: "/terminal", label: "Terminal (whoami)", icon: IconTerminal2, eyebrow: "reference · about terminal" },
];

export const ALL_NAV: NavLink[] = [...NAV_TOP, ...NAV_CONTENT, ...NAV_SITE];

/** Longest-prefix match so nested routes (/projects/new) keep their parent active. */
export function matchNav(pathname: string): NavLink | undefined {
  return ALL_NAV.filter((x) => pathname === x.href || pathname.startsWith(x.href + "/")).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
}
