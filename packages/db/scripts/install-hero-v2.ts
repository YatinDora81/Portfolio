import { prisma } from "../src/index";

// run from packages/db: bun run hero:v2

const INTRO_V2 =
  "Hand me an idea, I'll hand you back a product. Fast backends, clean frontends, and pipelines that do their job so quietly you forget they exist.";
const TAGLINE_V2 = "Ship it, scale it, make it smarter — that's the loop I live in.";

const BADGES_V2 = [
  { skill: "Next.js", label: null, sortOrder: 100 },
  { skill: "Go", label: "Golang", sortOrder: 101 },
  { skill: "TypeScript", label: null, sortOrder: 102 },
  { skill: "Node.js", label: null, sortOrder: 103 },
  { skill: "React", label: null, sortOrder: 104 },
  { skill: "Prisma", label: null, sortOrder: 105 },
  { skill: "Python", label: null, sortOrder: 106 },
] as const;

async function main() {
  await prisma.socialLink.updateMany({ where: { name: "LeetCode 2" }, data: { version: "v1" } });

  // leaves live alone on both paths, installing must not flip the site
  await prisma.heroContent.upsert({
    where: { version: "v2" },
    update: { intro: INTRO_V2, tagline: TAGLINE_V2 },
    create: { version: "v2", intro: INTRO_V2, tagline: TAGLINE_V2 },
  });

  await prisma.heroTitle.deleteMany({ where: { version: "v2" } });
  await prisma.heroTitle.create({
    data: { title: "Software Developer", sortOrder: 100, version: "v2" },
  });

  const skills = await prisma.skill.findMany({
    where: { name: { in: BADGES_V2.map((b) => b.skill) } },
    select: { id: true, name: true },
  });
  const skillIds = new Map(skills.map((s) => [s.name, s.id]));

  const missing = BADGES_V2.filter((b) => !skillIds.has(b.skill)).map((b) => b.skill);
  if (missing.length > 0) {
    throw new Error(`skills missing for hero v2 badges: ${missing.join(", ")}`);
  }

  await prisma.heroSkillBadge.deleteMany({ where: { version: "v2" } });
  await prisma.heroSkillBadge.createMany({
    data: BADGES_V2.map((b) => ({
      skillId: skillIds.get(b.skill)!,
      label: b.label,
      sortOrder: b.sortOrder,
      version: "v2" as const,
    })),
  });

  console.log("v2 hero content installed — open /hero in the admin and serve v2 to publish it");
}

main()
  .catch((e) => {
    console.error("install-hero-v2 failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
