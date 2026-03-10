import type { ComponentType } from "react";
import {
  IconDashboard, IconSettings, IconSparkles,
  IconInfoCircle, IconCode, IconBriefcase, IconFolder,
  IconArticle, IconQuote, IconMail, IconUsers, IconMessage, IconLink
} from "@tabler/icons-react";

export interface NavItem {
  label: string;
  href?: string;
  icon?: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  children?: { label: string; href: string }[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: IconDashboard },
      { label: "Messages", href: "/messages", icon: IconMessage },
    ],
  },
  {
    title: "Portfolio",
    items: [
      {
        label: "Hero",
        icon: IconSparkles,
        children: [
          { label: "Titles", href: "/hero/titles" },
          { label: "Skill Badges", href: "/hero/skill-badges" },
        ],
      },
      {
        label: "About",
        icon: IconInfoCircle,
        children: [
          { label: "Paragraphs", href: "/about/paragraphs" },
          { label: "Education", href: "/about/education" },
        ],
      },
      { label: "Links", href: "/links", icon: IconLink },
      { label: "Skills", href: "/skills", icon: IconCode },
      { label: "Experience", href: "/experiences", icon: IconBriefcase },
      { label: "Projects", href: "/projects", icon: IconFolder },
      { label: "Blogs", href: "/blogs", icon: IconArticle },
      { label: "Quotes", href: "/quotes", icon: IconQuote },
      { label: "Contact Purposes", href: "/contact-purposes", icon: IconMail },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Site Config", href: "/site-config", icon: IconSettings },
      { label: "Admin Users", href: "/admin-users", icon: IconUsers },
    ],
  },
];

// Keep flat NAV_ITEMS for backward compatibility
export const NAV_ITEMS = NAV_SECTIONS.flatMap(s => s.items);
