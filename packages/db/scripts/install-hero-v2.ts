import { prisma } from "../src/index";

/**
 * Installs the v2 hero content alongside v1. Additive and idempotent: it never
 * deletes a v1 row, and re-running it replaces only what it wrote last time.
 *
 * It deliberately does NOT make v2 live — flipping the site over is a separate,
 * deliberate act on the admin's Hero page.
 *
 * Run from `packages/db`, after the migration is applied and the code deployed:
 *   bun run hero:v2
 */

const INTRO_V2 =
  "Hand me an idea, I'll hand you back a product. Fast backends, clean frontends, and pipelines that do their job so quietly you forget they exist.";
const TAGLINE_V2 = "Ship it, scale it, make it smarter — that's the loop I live in.";

async function main() {
  // Idempotent re-assertion of the migration's backfill.
  await prisma.socialLink.updateMany({ where: { name: "LeetCode 2" }, data: { version: "v1" } });

  // Upserted by version, and `live` is left alone on both paths — installing the
  // copy must never move the site onto it.
  await prisma.heroContent.upsert({
    where: { version: "v2" },
    update: { intro: INTRO_V2, tagline: TAGLINE_V2 },
    create: { version: "v2", intro: INTRO_V2, tagline: TAGLINE_V2 },
  });

  // Scoped to v2, so a re-run can't duplicate rows and can't touch v1.
  await prisma.heroTitle.deleteMany({ where: { version: "v2" } });
  await prisma.heroTitle.create({
    data: { title: "Software Developer", sortOrder: 100, version: "v2" },
  });

  await prisma.heroSkillBadge.deleteMany({ where: { version: "v2" } });
  await prisma.heroSkillBadge.createMany({
    data: [
      // Same seven as v1 — the pill row is a different layout, not a different stack.
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
