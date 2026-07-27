import { prisma } from "db";
import { findSkillIcon, findSocialIcon, skillIconMap } from "@repo/ui/icons/registry";
import { PageHeader } from "@/components/shared/page-header";
import { IconLibrary } from "./gallery";

/**
 * The icon reference. Every glyph the portfolio can render, with the exact key
 * to type into an `iconKey` field — plus a read of what the DB actually holds,
 * so keys that resolve to nothing are visible here instead of silently
 * rendering an empty box on the live site.
 */
export default async function IconsPage() {
  const [skills, badges, links] = await Promise.all([
    prisma.skill.findMany({ select: { name: true, iconKey: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ select: { name: true, iconKey: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ select: { name: true, iconKey: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);

  /** Usage is counted against the CANONICAL key, so aliases roll up together. */
  const skillUse = new Map<string, number>();
  const socialUse = new Map<string, number>();
  const broken: { where: string; row: string; key: string }[] = [];

  for (const [rows, where, find, use] of [
    [skills, "Skills", findSkillIcon, skillUse],
    [badges, "Hero badges", findSkillIcon, skillUse],
    [links, "Social links", findSocialIcon, socialUse],
  ] as const) {
    for (const row of rows) {
      const hit = find(row.iconKey);
      if (hit) use.set(hit.key, (use.get(hit.key) ?? 0) + 1);
      else broken.push({ where, row: row.name, key: row.iconKey });
    }
  }

  /**
   * The experience timeline looks skills up by NAME, not `iconKey`
   * (apps/web/.../Experience.tsx) — so a skill whose name isn't itself a valid
   * key renders iconless there even when its `iconKey` is perfectly good.
   */
  const nameOnlyGaps = skills
    .filter((s) => s.name !== s.iconKey && !skillIconMap[s.name])
    .map((s) => `${s.name} → ${s.iconKey}`);

  return (
    <div className="view">
      <PageHeader
        eyebrow="reference · icon keys"
        title="Icon library"
        description="Every icon the site can draw, and the exact key that summons it. Click a tile to copy its key — or just use the picker built into the Skills, Hero badge and Social link dialogs."
      />
      <IconLibrary
        skillUse={Object.fromEntries(skillUse)}
        socialUse={Object.fromEntries(socialUse)}
        broken={broken}
        nameOnlyGaps={nameOnlyGaps}
      />
    </div>
  );
}
