"use client";

import type { ReactNode } from "react";
import { findSkillIcon, skillIconMap } from "@repo/ui/icons/registry";
import { DIM, FAINT, MONO, SectionLabel } from "./frame";

const BORDER = "rgba(255,255,255,0.1)";

const MAX_CARDS = 40;

export type CategoryId = "frontend" | "backend" | "database" | "devops" | "core";

export const CATEGORIES: { id: CategoryId; label: string; color: string }[] = [
  { id: "frontend", label: "Frontend", color: "#38BDF8" },
  { id: "backend", label: "Backend", color: "#34D399" },
  { id: "database", label: "Databases", color: "#FBBF24" },
  { id: "devops", label: "DevOps & Cloud", color: "#A78BFA" },
  { id: "core", label: "CS & Tooling", color: "#F472B6" },
];

// duplicated: apps/web's @/ alias doesn't resolve from this app
const META: Record<CategoryId, Record<string, string>> = {
  frontend: {
    "Next.js": "#E5E5E5", "React": "#61DAFB", "React.js": "#61DAFB", "TypeScript": "#3178C6",
    "JavaScript": "#F7DF1E", "Redux": "#764ABC", "Zustand": "#A855F7",
    "Tailwind CSS": "#38BDF8", "HTML/CSS": "#E34F26",
  },
  backend: {
    "Node.js": "#8CC84B", "Express.js": "#9CA3AF", "Go": "#00ADD8", "Golang": "#00ADD8",
    "REST APIs": "#34D399", "WebSockets": "#EC4899", "WebSocket": "#EC4899", "Kafka": "#D1D5DB",
    "Java": "#E76F00", "Python": "#3776AB", "FastAPI": "#009688", "Flask": "#9CA3AF",
  },
  database: {
    "PostgreSQL": "#4F9DDE", "MongoDB": "#47A248", "MySQL": "#4479A1", "Redis": "#DC382D",
    "Prisma": "#2DD4BF", "Drizzle": "#C5F74F", "Drizzle ORM": "#C5F74F", "SQL": "#38BDF8",
  },
  devops: {
    "Docker": "#2496ED", "AWS": "#FF9900", "AWS S3": "#E25444", "AWS EC2": "#FF9900",
    "CI/CD": "#A78BFA", "GitHub Actions": "#2088FF", "Jenkins": "#D24939", "Nginx": "#009639",
    "Cloudflare": "#F38020", "Cloudflare R2": "#F38020", "Vercel": "#E5E5E5", "Linux": "#FCC624",
    "Monitoring": "#F59E0B", "Logging": "#A3A3A3",
  },
  core: {
    "DSA": "#F472B6", "OOPs": "#C084FC", "Git": "#F05032", "GitHub": "#E5E5E5",
    "Turborepo": "#EF4444", "Jest": "#C21325", "Selenium": "#43B02A", "Jira": "#2684FF",
    "Postman": "#FF6C37", "Notion": "#E5E5E5", "npm/yarn": "#CB3837", "Bash": "#4EAA25",
    "Agile": "#22C55E", "Gemini": "#4796E3", "Bun": "#FBF0DF",
  },
};

const LOOKUP: Record<string, { category: CategoryId; color: string }> = Object.fromEntries(
  CATEGORIES.flatMap((c) =>
    Object.entries(META[c.id]).map(([name, color]) => [name, { category: c.id, color }] as const),
  ),
);

export function metaFor(name: string): { category: CategoryId; color: string } {
  return LOOKUP[name] ?? { category: "core", color: "#F472B6" };
}

export function deriveSymbol(name: string): string {
  const letters = name.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length === 0) return "??";
  return letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function iconFor(name: string, iconKey?: string): ReactNode {
  const byKey = iconKey ? skillIconMap[iconKey] : undefined;
  if (byKey) return byKey;
  const byName = skillIconMap[name];
  if (byName) return byName;
  const entry = findSkillIcon(iconKey || name);
  return entry ? <entry.Icon /> : null;
}

export function SkillsPreview({ skills }: {
  skills: { name: string; iconKey?: string }[];
}) {
  const shown = skills.slice(0, MAX_CARDS);
  const hidden = skills.length - shown.length;

  const counts = new Map<CategoryId, number>();
  for (const s of skills) {
    const { category } = metaFor(s.name);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const chips = [
    { key: "All", label: "All", color: "#909092", on: true },
    ...CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({
      key: c.id, label: c.label, color: c.color, on: false,
    })),
  ];

  return (
    <div>
      <SectionLabel sub="Technical" main="Skills" />

      <p className="max-w-[340px] text-[10px] leading-relaxed" style={{ color: DIM }}>
        my periodic table of code — everything i build with, in one place. tap a
        category to filter, hover any element to bring it to life.
      </p>

      {skills.length === 0 ? (
        <p className="mt-5 text-[10px] italic" style={{ color: FAINT }}>No visible skills</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px]"
                style={chip.on
                  ? {
                      borderColor: rgba(chip.color, 0.6),
                      background: rgba(chip.color, 0.12),
                      color: chip.color,
                      fontWeight: 500,
                    }
                  : { borderColor: BORDER, color: DIM }}
              >
                <span
                  className="size-1 rounded-full"
                  style={{ background: chip.color, transform: chip.on ? "scale(1.4)" : undefined }}
                />
                {chip.label}
              </span>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {shown.map((s, i) => {
              const { color } = metaFor(s.name);
              const icon = iconFor(s.name, s.iconKey);
              return (
                <div
                  key={`${i}-${s.name}`}
                  className="relative flex aspect-square w-[58px] flex-col justify-between overflow-hidden rounded-lg p-1.5"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-b-full"
                    style={{ background: rgba(color, 0.4) }}
                  />

                  <span aria-hidden="true" className="block h-1" />

                  <span className="flex size-6 items-center justify-center self-center">
                    {icon ?? (
                      <span
                        className="text-[11px] font-extrabold leading-none tracking-tight"
                        style={{ color }}
                      >
                        {deriveSymbol(s.name)}
                      </span>
                    )}
                  </span>

                  <span
                    className="w-full truncate text-center text-[8px] leading-tight"
                    style={{ color: DIM }}
                  >
                    {s.name}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="mt-4 flex h-4 items-center justify-center text-[9px]"
            style={{ fontFamily: MONO, color: DIM }}
          >
            {hidden > 0 && <span>+{hidden} more</span>}
          </div>
        </>
      )}
    </div>
  );
}
