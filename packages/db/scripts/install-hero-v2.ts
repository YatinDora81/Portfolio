import { prisma } from "../src/index";

// run from packages/db: bun run hero:v2

const INTRO_V2 =
  "Hand me an idea, I'll hand you back a product. Fast backends, clean frontends, and pipelines that do their job so quietly you forget they exist.";
const TAGLINE_V2 = "Ship it, scale it, make it smarter — that's the loop I live in.";

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

  await prisma.heroSkillBadge.deleteMany({ where: { version: "v2" } });
  await prisma.heroSkillBadge.createMany({
    data: [
      { name: "Next.js", iconKey: "Next.js", sortOrder: 100, version: "v2" },
      { name: "Golang", iconKey: "Go", sortOrder: 101, version: "v2" },
      { name: "TypeScript", iconKey: "TypeScript", sortOrder: 102, version: "v2" },
      { name: "Node.js", iconKey: "Node.js", sortOrder: 103, version: "v2" },
      { name: "React", iconKey: "React", sortOrder: 104, version: "v2" },
      { name: "Prisma", iconKey: "Prisma", sortOrder: 105, version: "v2" },
      { name: "Python", iconKey: "Python", sortOrder: 106, version: "v2" },
    ],
  });

  console.log("v2 hero content installed — open /hero in the admin and serve v2 to publish it");
}

main()
  .catch((e) => {
    console.error("install-hero-v2 failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
