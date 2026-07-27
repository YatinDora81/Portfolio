/**
 * Additive, idempotent content insert for the Grill launch.
 *
 * seed.ts cannot be used for this: it opens with deleteMany() on every table,
 * and DATABASE_URL points at the live database. This script only ever CREATES
 * or UPDATES, never deletes, and skips anything that already exists — so it is
 * safe to re-run.
 *
 *   cd packages/db && bun scripts/add-grill.ts
 */
import { prisma } from "../src/index";

const NEW_SKILLS = [
  { name: "Python", iconKey: "Python", show: true, sortOrder: 8 },
  { name: "FastAPI", iconKey: "FastAPI", show: true, sortOrder: 9 },
  { name: "Gemini", iconKey: "Gemini", show: true, sortOrder: 10 },
  { name: "Cloudflare R2", iconKey: "Cloudflare R2", show: true, sortOrder: 29 },
  { name: "Bun", iconKey: "Bun", show: true, sortOrder: 39 },
];

const GRILL_BULLETS = [
  "**Architected an end-to-end AI interview platform** — dynamically generates interviews from job descriptions, résumés, custom topics, or behavioral (cultural-fit) tracks with adaptive AI follow-ups, supporting text, voice, and video-recorded responses.",
  "**Engineered a quantitative voice-analytics pipeline** — built a dedicated FastAPI + Parselmouth microservice that measures pace, pauses, filler words, pitch, and energy directly from raw audio, delivering reports with per-question scoring, model ideal answers, and personalized improvement guidance.",
  "**Designed fault-tolerant, secure infrastructure** — implemented Gemini with automatic Groq failover via rotating API key pools (exponential backoff on 429/5xx), Groq Whisper speech-to-text, an idempotent self-healing report pipeline, and Argon2 + JWT (jose) authentication with strict per-user data isolation.",
];

const GRILL_TECH = [
  "Next.js", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Prisma", "Docker", "Turborepo",
];

async function main() {
  console.log("→ skills");
  for (const s of NEW_SKILLS) {
    const existing = await prisma.skill.findFirst({ where: { name: s.name } });
    if (existing) {
      console.log(`   = ${s.name} already exists`);
      continue;
    }
    await prisma.skill.create({ data: s });
    console.log(`   + ${s.name}`);
  }

  // Promoted out of the hidden block — in use at Wiingy, in Grill and in this repo.
  const gha = await prisma.skill.findFirst({ where: { name: "GitHub Actions" } });
  if (gha && !gha.show) {
    await prisma.skill.update({ where: { id: gha.id }, data: { show: true } });
    console.log("   ~ GitHub Actions is now shown in the grid");
  }

  console.log("→ project");
  const already = await prisma.project.findFirst({ where: { title: "Grill" } });
  if (already) {
    console.log("   = Grill already exists — leaving it alone");
  } else {
    // Everything shifts down one so Grill takes the top slot.
    const others = await prisma.project.findMany({ orderBy: { sortOrder: "asc" } });
    await prisma.$transaction(
      others.map((p, i) =>
        prisma.project.update({ where: { id: p.id }, data: { sortOrder: i + 1 } })
      )
    );

    const skills = await prisma.skill.findMany({ where: { name: { in: GRILL_TECH } } });
    const missing = GRILL_TECH.filter((t) => !skills.some((s) => s.name === t));
    if (missing.length) console.log(`   ! no Skill row for: ${missing.join(", ")} — those chips will not appear`);

    await prisma.project.create({
      data: {
        title: "Grill",
        summary:
          "AI mock interview platform — adaptive follow-ups, voice & video answers, and measured delivery scoring.",
        github: "https://github.com/YatinDora81/Grill",
        live: "https://grill.yatindora.in",
        logoUrl: "/logos/grill.png",
        images: ["/projects/grill.jpg"],
        sortOrder: 0,
        skills: { connect: skills.map((s) => ({ id: s.id })) },
        bullets: { create: GRILL_BULLETS.map((content, sortOrder) => ({ content, sortOrder })) },
      },
    });
    console.log(`   + Grill at sortOrder 0 (${others.length} projects shifted down)`);
  }

  console.log("→ hero");
  const badge = await prisma.heroSkillBadge.findFirst({ where: { name: "Python" } });
  if (badge) console.log("   = Python badge already exists");
  else {
    const count = await prisma.heroSkillBadge.count();
    await prisma.heroSkillBadge.create({ data: { name: "Python", iconKey: "Python", sortOrder: count } });
    console.log("   + Python hero badge");
  }

  const title = await prisma.heroTitle.findFirst({ where: { title: "AI Engineer" } });
  if (title) console.log("   = 'AI Engineer' title already exists");
  else {
    const count = await prisma.heroTitle.count();
    await prisma.heroTitle.create({ data: { title: "AI Engineer", sortOrder: count } });
    console.log("   + 'AI Engineer' hero title");
  }

  console.log("\ndone — nothing was deleted.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
