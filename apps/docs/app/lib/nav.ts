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
  /** Page-order ordinal — this section's number as the visitor scrolls the site. */
  n?: string;
  /**
   * The ordinal for entries that are *layers over* the page rather than sections
   * of it: the cat rides between Hero and About, the terminal is a reference for
   * About. A glyph instead of a digit says so without a legend, and keeps the
   * 01–08 run unbroken. Rendered in place of `n`, never alongside it.
   */
  mark?: string;
  icon: NavIcon;
  /** Topbar eyebrow — the small mono line above the title. */
  eyebrow: string;
  /**
   * Extra words the command palette matches on, for editors that live inside a
   * page rather than being one. Folding four routes into two cost the palette
   * the labels it used to search — "Social & resume" and "Education" were rows
   * of their own — so searching what you want to edit found nothing at all.
   * Nothing renders these; they only widen the haystack.
   */
  keywords?: string;
  /** Unread count badge (inbox only). */
  badge?: boolean;
}

export interface NavGroup {
  /** `null` is the unlabelled run at the top of the sidebar. */
  label: string | null;
  items: NavLink[];
}

/**
 * The admin's single source of truth for navigation: the sidebar, the topbar
 * eyebrow and the command palette all read this file, so a label, an eyebrow or
 * a route can only ever be wrong in one place.
 *
 * The grouping is by *site section*, not by table. Everything that drives one
 * band of the public page lives on one row here even when it is stored across
 * several models — the hero's copy, its social row and its SiteConfig keys are
 * one entry, About's paragraphs and education are one entry.
 *
 * Deliberately absent: /links, /social-links, /about/paragraphs and
 * /about/education. All four are `redirect()` stubs kept alive so bookmarks
 * survive; listing them here would show every one of them twice in the palette
 * and offer the reader a choice between a page and its own redirect.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: IconLayoutGrid, eyebrow: "control room · overview" },
      { href: "/messages", label: "Inbox", icon: IconInbox, eyebrow: "contact form → you", badge: true },
      // In the unlabelled run rather than the 01–08 one: the vault is a tool the
      // owner uses, not a band of the public page, and nothing in it is ever
      // published. Putting it under "The page · top to bottom" would give it an
      // ordinal that promises a section visitors can scroll to.
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
      // First, and a glyph rather than an ordinal: it is behind all eight
      // sections at once, so there is no one place in the scroll that is its
      // own. A number here would promise a band you could scroll to, when what
      // it actually is is the paper the other eight are printed on.
      { href: "/background", mark: "~~~", label: "Background", icon: IconStackBack,
        eyebrow: "the background · a layer under the page",
        keywords: "background terrain contour lines beams canvas layer v1 v2 noise veil strength cell levels opacity" },
      { href: "/hero", n: "01", label: "Hero", icon: IconSparkles, eyebrow: "section 01 · top of the page",
        keywords: "social links resume cv titles badges intro tagline photos version" },
      // Between Hero and About because that is literally where the cat sits on
      // the public page — on the wire that divides them.
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
      // Not role-filtered: hiding a link is not access control, and the page and
      // its detail action each check the session themselves.
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

/** Longest-prefix match so nested routes (/projects/new) keep their parent active. */
export function matchNav(pathname: string): NavLink | undefined {
  return ALL_NAV.filter((x) => pathname === x.href || pathname.startsWith(x.href + "/")).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
}

/**
 * What the rail shows for a row: the section number, or the glyph for the two
 * entries that are layers rather than sections. One accessor so the sidebar,
 * the palette and each page's `.sec-mark` can never disagree about which is
 * which — `matchNav(pathname)` then `navMark(...)` gets a page its own ordinal.
 */
export function navMark(x: NavLink): string | undefined {
  return x.n ?? x.mark;
}

/** The group heading a route sits under — the palette's second line. */
export function navGroupOf(x: NavLink): string | null {
  return NAV_GROUPS.find((g) => g.items.includes(x))?.label ?? null;
}
