import { prisma } from "./src/index";
import bcrypt from "bcryptjs";
import { confirmTarget } from "./scripts/confirm-target";

async function seed() {
  const endpoint = confirmTarget("seed wipes and rewrites 20 tables, including Project, Blog, Skill, SiteSettings and AdminUser,");
  console.log(`Seeding database... (${endpoint})`);

  // Clean up in reverse dependency order
  await prisma.experienceBullet.deleteMany();
  await prisma.projectBullet.deleteMany();
  await prisma.experienceSkill.deleteMany();
  await prisma.projectSkill.deleteMany();
  await prisma.projectImage.deleteMany();
  await prisma.projectMilestone.deleteMany();
  await prisma.experience.deleteMany();
  await prisma.project.deleteMany();
  await prisma.heroSkillBadge.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.heroTitle.deleteMany();
  await prisma.heroContent.deleteMany();
  await prisma.socialLink.deleteMany();
  await prisma.aboutParagraph.deleteMany();
  await prisma.education.deleteMany();
  await prisma.blog.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.contactPurpose.deleteMany();
  await prisma.siteSettings.deleteMany();
  await prisma.adminUser.deleteMany();

  // v2 starts at sortOrder 100 so the two versions' ranges don't overlap.
  await prisma.heroTitle.createMany({
    data: [
      { title: "Full-Stack Developer", sortOrder: 0, version: "v1" },
      { title: "Frontend Engineer", sortOrder: 1, version: "v1" },
      { title: "Backend Engineer", sortOrder: 2, version: "v1" },
      { title: "DevOps Enthusiast", sortOrder: 3, version: "v1" },
      { title: "Problem Solver", sortOrder: 4, version: "v1" },
      { title: "Software Developer", sortOrder: 100, version: "v2" },
    ],
  });
  console.log("Hero titles seeded");

  await prisma.socialLink.createMany({
    data: [
      { name: "LinkedIn", href: "https://www.linkedin.com/in/yatin-dora/", iconKey: "linkedin", detail: "/in/yatin-dora", sortOrder: 0 },
      { name: "GitHub", href: "https://github.com/YatinDora81", iconKey: "github", detail: "@YatinDora81", sortOrder: 1 },
      { name: "LeetCode", href: "https://leetcode.com/yatindora/", iconKey: "leetcode", detail: "@yatindora", sortOrder: 2 },
      { name: "LeetCode 2", href: "https://leetcode.com/u/Yatin_dora_sde/", iconKey: "leetcode", detail: "@Yatin_dora_sde", sortOrder: 3, version: "v1" },
      { name: "X", href: "https://x.com/YatinDora", iconKey: "x", detail: "@YatinDora", sortOrder: 4 },
      { name: "Email", href: "mailto:yatin.dora81@gmail.com", iconKey: "email", detail: "yatin.dora81@gmail.com", sortOrder: 5 },
    ],
  });
  console.log("Social links seeded");

  await prisma.aboutParagraph.createMany({
    data: [
      {
        content:
          "I'm a **Software Engineer** who builds production-grade web applications end to end. These days at **Wiingy** — architecting scheduling platforms, modernizing databases, and building the pipelines that ship it all.",
        sortOrder: 0,
      },
      {
        content:
          "I got my start at **Nykaa** on the My Orders team, building features and payment flows used by millions of users.",
        sortOrder: 1,
      },
    ],
  });
  console.log("About paragraphs seeded");

  await prisma.education.createMany({
    data: [
      {
        institution: "Chitkara University, Rajpura",
        location: "Rajpura, Punjab",
        degree: "B.E - Computer Science and Engineering",
        scoreType: "CGPA",
        score: "9.5",
        scoreTotal: "10",
        startYear: 2021,
        endYear: 2025,
        sortOrder: 0,
      },
    ],
  });
  console.log("Education seeded");

  const skillsData = [
    { name: "Next.js", iconKey: "Next.js", showInGrid: true, sortOrder: 0 },
    { name: "React", iconKey: "React", showInGrid: true, sortOrder: 1 },
    { name: "TypeScript", iconKey: "TypeScript", showInGrid: true, sortOrder: 2 },
    { name: "JavaScript", iconKey: "JavaScript", showInGrid: true, sortOrder: 3 },
    { name: "Redux", iconKey: "Redux", showInGrid: true, sortOrder: 4 },
    { name: "Node.js", iconKey: "Node.js", showInGrid: true, sortOrder: 5 },
    { name: "Express.js", iconKey: "Express.js", showInGrid: true, sortOrder: 6 },
    { name: "Go", iconKey: "Go", showInGrid: true, sortOrder: 7 },
    { name: "Python", iconKey: "Python", showInGrid: true, sortOrder: 8 },
    { name: "FastAPI", iconKey: "FastAPI", showInGrid: true, sortOrder: 9 },
    { name: "Flask", iconKey: "Flask", showInGrid: true, sortOrder: 10 },
    { name: "Gemini", iconKey: "Gemini", showInGrid: true, sortOrder: 11 },
    { name: "REST APIs", iconKey: "REST APIs", showInGrid: true, sortOrder: 12 },
    { name: "WebSockets", iconKey: "WebSockets", showInGrid: true, sortOrder: 13 },
    { name: "PostgreSQL", iconKey: "PostgreSQL", showInGrid: true, sortOrder: 14 },
    { name: "MongoDB", iconKey: "MongoDB", showInGrid: true, sortOrder: 15 },
    { name: "MySQL", iconKey: "MySQL", showInGrid: true, sortOrder: 16 },
    { name: "Redis", iconKey: "Redis", showInGrid: true, sortOrder: 17 },
    { name: "Prisma", iconKey: "Prisma", showInGrid: true, sortOrder: 18 },
    { name: "Drizzle", iconKey: "Drizzle ORM", showInGrid: true, sortOrder: 19 },
    { name: "SQL", iconKey: "SQL", showInGrid: true, sortOrder: 20 },
    { name: "Kafka", iconKey: "Kafka", showInGrid: true, sortOrder: 21 },
    { name: "Docker", iconKey: "Docker", showInGrid: true, sortOrder: 22 },
    { name: "AWS", iconKey: "AWS", showInGrid: true, sortOrder: 23 },
    { name: "AWS S3", iconKey: "AWS S3", showInGrid: true, sortOrder: 24 },
    { name: "AWS EC2", iconKey: "AWS EC2", showInGrid: true, sortOrder: 25 },
    { name: "CI/CD", iconKey: "CI/CD", showInGrid: true, sortOrder: 26 },
    { name: "Jenkins", iconKey: "Jenkins", showInGrid: true, sortOrder: 27 },
    { name: "Nginx", iconKey: "Nginx", showInGrid: true, sortOrder: 28 },
    { name: "Cloudflare", iconKey: "Cloudflare", showInGrid: true, sortOrder: 29 },
    { name: "Cloudflare R2", iconKey: "Cloudflare R2", showInGrid: true, sortOrder: 30 },
    { name: "Monitoring", iconKey: "Monitoring", showInGrid: true, sortOrder: 31 },
    { name: "Logging", iconKey: "Logging", showInGrid: true, sortOrder: 32 },
    { name: "Java", iconKey: "Java", showInGrid: true, sortOrder: 33 },
    { name: "DSA", iconKey: "DSA", showInGrid: true, sortOrder: 34 },
    { name: "OOPs", iconKey: "OOPs", showInGrid: true, sortOrder: 35 },
    { name: "Git", iconKey: "Git", showInGrid: true, sortOrder: 36 },
    { name: "GitHub", iconKey: "GitHub", showInGrid: true, sortOrder: 37 },
    { name: "GitHub Actions", iconKey: "GitHub Actions", showInGrid: true, sortOrder: 38 },
    { name: "Turborepo", iconKey: "Turborepo", showInGrid: true, sortOrder: 39 },
    { name: "Bun", iconKey: "Bun", showInGrid: true, sortOrder: 40 },
    { name: "Jest", iconKey: "Jest", showInGrid: true, sortOrder: 41 },
    { name: "Selenium", iconKey: "Selenium", showInGrid: true, sortOrder: 42 },
    { name: "Jira", iconKey: "Jira", showInGrid: true, sortOrder: 43 },
    { name: "Drizzle ORM", iconKey: "Drizzle ORM", showInGrid: false, sortOrder: 100 },
    { name: "React.js", iconKey: "React.js", showInGrid: false, sortOrder: 102 },
    { name: "WebSocket", iconKey: "WebSocket", showInGrid: false, sortOrder: 103 },
  ];

  const skills = await Promise.all(
    skillsData.map((s) => prisma.skill.create({ data: s }))
  );
  const skillMap = new Map(skills.map((s) => [s.name, s.id]));
  console.log("Skills seeded");

  const badgesData = [
    { skill: "Next.js", label: null, sortOrder: 0, version: "v1" },
    { skill: "Go", label: "Golang", sortOrder: 1, version: "v1" },
    { skill: "TypeScript", label: null, sortOrder: 2, version: "v1" },
    { skill: "Node.js", label: null, sortOrder: 3, version: "v1" },
    { skill: "React", label: null, sortOrder: 4, version: "v1" },
    { skill: "Prisma", label: null, sortOrder: 5, version: "v1" },
    { skill: "Python", label: null, sortOrder: 6, version: "v1" },

    { skill: "Next.js", label: null, sortOrder: 100, version: "v2" },
    { skill: "Go", label: "Golang", sortOrder: 101, version: "v2" },
    { skill: "TypeScript", label: null, sortOrder: 102, version: "v2" },
    { skill: "Node.js", label: null, sortOrder: 103, version: "v2" },
    { skill: "React", label: null, sortOrder: 104, version: "v2" },
    { skill: "Prisma", label: null, sortOrder: 105, version: "v2" },
    { skill: "Python", label: null, sortOrder: 106, version: "v2" },
  ] as const;

  await prisma.heroSkillBadge.createMany({
    data: badgesData.map((b) => ({
      skillId: skillMap.get(b.skill)!,
      label: b.label,
      sortOrder: b.sortOrder,
      version: b.version,
    })),
  });
  console.log("Hero skill badges seeded");

  function joinSkills(names: string[]) {
    return names
      .filter((n) => skillMap.has(n))
      .map((n, i) => ({ skillId: skillMap.get(n)!, sortOrder: i }));
  }

  await prisma.experience.create({
    data: {
      company: "Wiingy",
      position: "Software Development Engineer",
      location: "Bangalore, Karnataka",
      startedOn: new Date("2025-07-01"),
      endedOn: null,
      visibleBullets: 3,
      website: "https://wiingy.com", logoUrl: "/logos/wiingy.png",
      sortOrder: 0,
      skills: {
        create: joinSkills([
          "Next.js", "Express.js", "Node.js", "TypeScript", "Go",
          "Python", "Flask", "MySQL", "Drizzle ORM", "Docker", "GitHub Actions",
        ]),
      },
      bullets: {
        create: [
          {
            content: "**Built the scheduling platform from scratch** — architected end-to-end calendar operations with Google Calendar multi-timezone sync & automated engagement logic, completely eliminating manual coordination across the org.",
            sortOrder: 0,
          },
          {
            content: "**Led a full database modernization** — redesigned the production schema with strict relational standards, migrated identity from email-based to secure UUID-first models using Drizzle ORM with type-safe, repeatable migrations.",
            sortOrder: 1,
          },
          {
            content: "**Shipped AI-powered semantic search** — implemented vector embeddings to deliver intent-based results, dramatically improving relevance ranking and content discovery for users.",
            sortOrder: 2,
          },
          {
            content: "**Set up the entire DevOps infrastructure** — CI/CD pipelines, monitoring & logging, ASG-based autoscaling, and a pub/sub layer for horizontally scaling WebSocket communication across services.",
            sortOrder: 3,
          },
        ],
      },
    },
  });

  await prisma.experience.create({
    data: {
      company: "Nykaa",
      position: "Software Development Engineer Intern (Frontend)",
      location: "Gurugram, Haryana",
      startedOn: new Date("2025-01-01"),
      endedOn: new Date("2025-07-01"),
      website: "https://nykaa.com", logoUrl: "/logos/nykaa.png",
      sortOrder: 1,
      skills: {
        create: joinSkills([
          "React.js", "Jest", "Selenium", "JavaScript", "Git", "Jira",
        ]),
      },
      bullets: {
        create: [
          {
            content: "**Owned features on the My Orders team** — built user-facing components for both web & mWeb platforms, directly impacting how millions of customers track and interact with their orders.",
            sortOrder: 0,
          },
          {
            content: "**Worked on payment & checkout flows** — ensured correct order state transitions and rock-solid integration with the My Orders module, handling real money at scale.",
            sortOrder: 1,
          },
          {
            content: "**Drove frontend test coverage to 95%** — authored 100+ unit & integration tests with Jest and Selenium, cutting production bugs by 40%.",
            sortOrder: 2,
          },
          {
            content: "**Shipped consistently at 90% sprint velocity** — worked in Agile/Scrum with active participation in sprint ceremonies, code reviews, and cross-team collaboration.",
            sortOrder: 3,
          },
        ],
      },
    },
  });
  console.log("Experiences seeded");

  await prisma.project.create({
    data: {
      title: "Grill",
      summary: "AI mock interview platform — adaptive follow-ups, voice & video answers, and measured delivery scoring.",
      github: "https://github.com/YatinDora81/Grill",
      live: "https://grill.yatindora.in",
      logoUrl: "/logos/grill.png",
      gallery: { create: [{ externalUrl: "/projects/grill.jpg", sortOrder: 0 }] },
      sortOrder: 0,
      skills: {
        create: joinSkills(["Next.js", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Prisma", "Docker", "Turborepo"]),
      },
      bullets: {
        create: [
          { content: "**Architected an end-to-end AI interview platform** — dynamically generates interviews from job descriptions, résumés, custom topics, or behavioral (cultural-fit) tracks with adaptive AI follow-ups, supporting text, voice, and video-recorded responses.", sortOrder: 0 },
          { content: "**Engineered a quantitative voice-analytics pipeline** — built a dedicated FastAPI + Parselmouth microservice that measures pace, pauses, filler words, pitch, and energy directly from raw audio, delivering reports with per-question scoring, model ideal answers, and personalized improvement guidance.", sortOrder: 1 },
          { content: "**Designed fault-tolerant, secure infrastructure** — implemented Gemini with automatic Groq failover via rotating API key pools (exponential backoff on 429/5xx), Groq Whisper speech-to-text, an idempotent self-healing report pipeline, and Argon2 + JWT (jose) authentication with strict per-user data isolation.", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.project.create({
    data: {
      title: "Draw Sheet",
      summary: "Real-time collaborative drawing app enabling multi-user live drawing sessions.",
      github: "https://github.com/yatindora/draw-and-connect",
      live: "https://drawsheet.vercel.app",
      logoUrl: "/logos/drawsheet.png",
      gallery: { create: [{ externalUrl: "/projects/drawsheet.png", sortOrder: 0 }] },
      sortOrder: 1,
      skills: {
        create: joinSkills(["Next.js", "Node.js", "Express.js", "PostgreSQL", "Prisma", "WebSocket"]),
      },
      bullets: {
        create: [
          { content: "**Built real-time collaboration from scratch** — multi-user live drawing with instant cross-user synchronization using WebSockets.", sortOrder: 0 },
          { content: "**Achieved 99.9% data integrity** — designed backend with PostgreSQL, Prisma ORM, and Zod validation for secure, type-safe APIs.", sortOrder: 1 },
          { content: "**Adopted Turborepo monorepo setup** — boosted dev efficiency by 30% with shared packages across frontend and backend.", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.project.create({
    data: {
      title: "NextMoveApp",
      summary: "AI-powered job application platform with message generation, templates, and tracking.",
      github: "https://github.com/yatindora/next-move-app",
      live: "https://nextmove-yatin.vercel.app",
      logoUrl: "/logos/nextmove.png",
      gallery: { create: [{ externalUrl: "/projects/nextmove.png", sortOrder: 0 }] },
      sortOrder: 2,
      skills: {
        create: joinSkills(["Next.js", "Express.js", "TypeScript", "PostgreSQL", "Prisma", "Redis", "Docker"]),
      },
      bullets: {
        create: [
          { content: "**Built an interactive AI chat system** — using Google Gemini for context-aware email/message creation with reusable templates and clean workflows.", sortOrder: 0 },
          { content: "**Structured a production-grade backend** — Prisma, Redis, and Zod inside a Turborepo monorepo with secure Clerk auth and Docker containers.", sortOrder: 1 },
          { content: "**Shipped end-to-end job tracking** — full CRUD for applications, templates, and AI-generated messages with PostgreSQL persistence.", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.project.create({
    data: {
      title: "Connect",
      summary: "Real-time messaging platform for teams and friends with typing indicators and file sharing.",
      github: "https://github.com/yatindora/draw-and-connect",
      live: "https://connect-yatin.vercel.app",
      logoUrl: "/logos/connect.png",
      gallery: { create: [{ externalUrl: "/projects/connect.png", sortOrder: 0 }] },
      sortOrder: 3,
      skills: {
        create: joinSkills(["Next.js", "React", "TypeScript", "Express.js", "WebSocket", "Prisma", "Turborepo"]),
      },
      bullets: {
        create: [
          { content: "**Built real-time messaging from the ground up** — WebSocket-powered chat with instant delivery, typing indicators, and seamless file sharing.", sortOrder: 0 },
          { content: "**Shared monorepo architecture with Drawsheet** — Turborepo setup with shared UI components, Prisma DB package, and backend utilities across both apps.", sortOrder: 1 },
          { content: "**Scalable WebSocket infrastructure** — dedicated WS server handling connections for both apps, with background workers for async processing.", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.project.create({
    data: {
      title: "Netflix-GPT",
      summary: "AI-powered movie and TV show recommendation app with personalized suggestions and search.",
      github: "https://github.com/YatinDora81/Netflix-GPT",
      live: "https://netflix-gpt-uysk.vercel.app",
      logoUrl: "/logos/netflix-gpt.png",
      gallery: { create: [{ externalUrl: "/projects/netflix-gpt.png", sortOrder: 0 }] },
      sortOrder: 4,
      skills: {
        create: joinSkills(["React", "Node.js", "Express.js", "MongoDB", "Docker"]),
      },
      bullets: {
        create: [
          { content: "**Built AI-driven recommendations** — personalized movie and show suggestions based on user preferences, viewing history, and trending content.", sortOrder: 0 },
          { content: "**Shipped a full-featured entertainment UI** — search, watchlist management, and a rate & review system for community-driven discovery.", sortOrder: 1 },
          { content: "**Containerized for production deployment** — Dockerized the full stack with environment-based config for seamless cloud deployment.", sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.project.create({
    data: {
      title: "Trimrr",
      summary: "URL shortener with analytics to track clicks and usage statistics.",
      github: "https://github.com/YatinDora81/URL_Shortner",
      live: "https://url-shortner-git-main-yatindora81s-projects.vercel.app",
      logoUrl: "/logos/trimrr.png",
      gallery: { create: [{ externalUrl: "/projects/trimrr.png", sortOrder: 0 }] },
      sortOrder: 5,
      skills: {
        create: joinSkills(["React", "JavaScript", "Node.js", "Express.js", "MongoDB"]),
      },
      bullets: {
        create: [
          { content: "**Built a full URL shortening service** — users can shorten long URLs and get shareable links with instant redirection.", sortOrder: 0 },
          { content: "**Implemented click analytics** — tracks usage statistics per link including click counts and access patterns.", sortOrder: 1 },
          { content: "**Shipped with user auth and management** — authentication flow for managing personal shortened URLs and viewing analytics dashboards.", sortOrder: 2 },
        ],
      },
    },
  });
  console.log("Projects seeded");

  const blogsData = [
    {
      slug: "turborepo-monorepo",
      title: "Why I Chose Turborepo for My Monorepo Setup",
      description: "After trying Lerna, Nx, and plain workspaces — Turborepo changed everything with zero-config caching and parallel execution.",
      imageOrientation: "LANDSCAPE" as const,
      color: "from-blue-500/20 to-cyan-500/20",
      sortOrder: 0,
      content: `# Why I Chose Turborepo for My Monorepo Setup

Setting up a monorepo can be overwhelming. After trying Lerna, Nx, and plain workspaces, I landed on Turborepo — and it changed everything.

## The Problem

Managing multiple apps (frontend, backend, shared packages) in separate repos was a nightmare. Dependency drift, duplicate configs, and painful deployments.

## Why Turborepo Won

- **Zero-config caching** — build once, skip everywhere
- **Parallel execution** — tasks run concurrently out of the box
- **Incremental builds** — only rebuild what changed
- **Simple config** — just a \`turbo.json\` file

## My Setup

I use Turborepo with pnpm workspaces. Shared packages like \`@repo/ui\`, \`@repo/db\`, and \`@repo/config\` keep things DRY across apps.

The result? 30% faster dev cycles and zero dependency conflicts.`,
    },
    {
      slug: "websocket-scaling",
      title: "Scaling WebSockets — Lessons from Real-Time Apps",
      description: "Single-server WebSocket worked in dev. Production with load balancers? Redis pub/sub saved the day.",
      imageOrientation: "LANDSCAPE" as const,
      color: "from-purple-500/20 to-pink-500/20",
      sortOrder: 1,
      content: `# Scaling WebSockets — What I Learned Building Real-Time Apps

WebSockets are easy to set up. Scaling them? That's a different story.

## The Challenge

When I built Drawsheet and Connect, single-server WebSocket worked fine in dev. But in production with multiple instances behind a load balancer, messages stopped reaching the right clients.

## The Fix: Pub/Sub Layer

I added Redis pub/sub between WebSocket servers. When a message comes in on Server A, it publishes to Redis. Server B subscribes and forwards to its connected clients.

## Key Takeaways

1. **Sticky sessions help** but aren't enough for true horizontal scaling
2. **Redis pub/sub** is lightweight and battle-tested for WS fan-out
3. **Heartbeat pings** are essential — don't trust TCP keepalive alone
4. **Reconnection logic** on the client side saves your UX

Real-time is addictive once you get it right.`,
    },
    {
      slug: "drizzle-vs-prisma",
      title: "Drizzle vs Prisma — Which ORM Should You Pick?",
      description: "I've used both in production. Prisma for rapid prototyping, Drizzle when performance matters.",
      imageOrientation: "SQUARE" as const,
      color: "from-green-500/20 to-emerald-500/20",
      sortOrder: 2,
      content: `# Drizzle vs Prisma — Which ORM Should You Pick?

I've used both in production. Here's my honest take.

## Prisma

- Amazing DX with auto-generated types
- Prisma Studio is a lifesaver for debugging
- Migrations are smooth and repeatable
- But: the generated client is heavy, and raw SQL escape hatches feel clunky

## Drizzle

- SQL-like syntax that feels natural
- Lightweight — no generated client bloat
- Incredible TypeScript inference
- But: younger ecosystem, fewer guides

## My Verdict

Use **Prisma** when you want speed of development and your team is mixed-experience. Use **Drizzle** when you want full control and your team is comfortable with SQL.

I use Prisma for rapid prototyping and Drizzle for production systems where performance matters.`,
    },
    {
      slug: "docker-dev-setup",
      title: "Docker for Dev — Stop Breaking Your Local Machine",
      description: "One docker-compose up and everything works. Database, Redis, backend, frontend. Your teammates will thank you.",
      imageOrientation: "PORTRAIT" as const,
      color: "from-orange-500/20 to-amber-500/20",
      sortOrder: 3,
      content: `# Docker for Dev — Stop Breaking Your Local Machine

Every new project: install this, configure that, wrong Node version, port conflict. Sound familiar?

## The Solution

Docker Compose for local development. One \`docker-compose up\` and everything works — database, Redis, backend, frontend.

## My Stack

\`\`\`yaml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  app:
    build: .
    volumes: ["./src:/app/src"]
    ports: ["3000:3000"]
\`\`\`

## Tips

- Use **volumes** for hot reload in development
- Use **multi-stage builds** for production images
- Keep dev and prod Dockerfiles separate
- Add a \`Makefile\` for common commands

Your teammates will thank you.`,
    },
    {
      slug: "nextjs-app-router",
      title: "Next.js App Router — Worth the Migration?",
      description: "Migrated from Pages Router to App Router. Server components are a game-changer but the learning curve is real.",
      imageOrientation: "LANDSCAPE" as const,
      color: "from-slate-500/20 to-zinc-500/20",
      sortOrder: 4,
      content: `# Next.js App Router — Worth the Migration?

Migrated from Pages Router to App Router. Here's my experience.

## What Changed

- Server Components by default — less JavaScript shipped to client
- Nested layouts — finally, persistent UI across routes
- Streaming and Suspense — progressive loading built-in
- Route handlers replace API routes

## The Good

Server components are a paradigm shift. Fetching data directly in components without useEffect or getServerSideProps feels natural. Less client-side JavaScript means faster pages.

## The Challenges

- Mental model shift — thinking in server vs client components
- Caching behavior can be surprising
- Some libraries aren't App Router compatible yet

## My Verdict

Worth it for new projects, absolutely. For existing apps, migrate incrementally.`,
    },
    {
      slug: "redis-caching-patterns",
      title: "Redis Caching Patterns That Actually Work",
      description: "Cache-aside, write-through, TTL strategies — practical patterns I use in production every day.",
      imageOrientation: "SQUARE" as const,
      color: "from-red-500/20 to-rose-500/20",
      sortOrder: 5,
      content: `# Redis Caching Patterns That Actually Work

Caching sounds simple until you deal with stale data, thundering herds, and cache invalidation.

## Cache-Aside (Lazy Loading)

Check cache first. Miss? Fetch from DB, store in cache, return. Simple and effective for read-heavy workloads.

## Write-Through

Write to cache and DB simultaneously. Ensures cache is always fresh but adds write latency.

## TTL Strategies

- Short TTL (30s-5m) for frequently changing data
- Long TTL (1h-24h) for static content
- No TTL for session data (explicit invalidation)

## Tips

- Always set a TTL — unbounded caches are memory leaks
- Use cache prefixes for easy namespace management
- Monitor hit rates — below 80% means your strategy needs work`,
    },
    {
      slug: "cicd-github-actions",
      title: "CI/CD with GitHub Actions",
      description: "From zero to automated deployments. How I set up lint, test, build, and deploy pipelines for every project.",
      imageOrientation: "LANDSCAPE" as const,
      color: "from-violet-500/20 to-indigo-500/20",
      sortOrder: 6,
      content: `# CI/CD with GitHub Actions

Automated pipelines save hours every week. Here's how I set them up.

## My Pipeline

1. **Lint** — ESLint + Prettier on every push
2. **Type Check** — TypeScript strict mode
3. **Test** — Jest unit + integration tests
4. **Build** — Verify production build succeeds
5. **Deploy** — Auto-deploy to staging on PR merge, production on release

## Key Workflows

- PR checks run in parallel for speed
- Caching node_modules between runs saves 2-3 minutes
- Matrix builds test against multiple Node versions
- Slack notifications for failed deployments

## Tips

- Start simple — lint and build first, add tests later
- Use reusable workflows for shared logic across repos
- Keep secrets in GitHub Secrets, never in code`,
    },
    {
      slug: "typescript-tricks",
      title: "TypeScript Tricks I Wish I Knew Earlier",
      description: "Discriminated unions, template literals, satisfies operator, and more. Level up your TS game.",
      imageOrientation: "PORTRAIT" as const,
      color: "from-blue-500/20 to-indigo-500/20",
      sortOrder: 7,
      content: `# TypeScript Tricks I Wish I Knew Earlier

TypeScript is more powerful than most developers realize. Here are patterns that leveled up my code.

## Discriminated Unions

Perfect for state machines and API responses. The compiler narrows types automatically.

## Template Literal Types

Generate string types dynamically. Great for event names, CSS classes, and route patterns.

## The satisfies Operator

Validate types without widening. You get autocomplete AND type safety.

## Const Assertions

Use \`as const\` to preserve literal types in arrays and objects. Essential for configuration objects.

## Tips

- Use \`unknown\` over \`any\` — it forces you to narrow
- Leverage utility types: Pick, Omit, Partial, Required
- Enable strict mode from day one — it catches bugs early`,
    },
    {
      slug: "jwt-auth-patterns",
      title: "JWT Auth Done Right",
      description: "Access tokens, refresh tokens, rotation strategies. Stop storing JWTs in localStorage.",
      imageOrientation: "SQUARE" as const,
      color: "from-yellow-500/20 to-amber-500/20",
      sortOrder: 8,
      content: `# JWT Auth Done Right

JWTs are everywhere but most implementations have security holes. Here's how to do it properly.

## Token Strategy

- **Access token** — short-lived (15 min), stored in memory
- **Refresh token** — long-lived (7 days), stored in httpOnly cookie
- **Token rotation** — issue new refresh token on each use

## Common Mistakes

- Storing JWTs in localStorage (XSS vulnerable)
- No token expiration (compromised tokens live forever)
- Not validating token signatures on every request

## My Setup

Access tokens in memory, refresh tokens in httpOnly secure cookies. Automatic token refresh on 401 responses. Token rotation with reuse detection for security.

## Tips

- Always use HTTPS in production
- Implement token revocation for logout
- Keep access token payloads small`,
    },
    {
      slug: "postgres-performance",
      title: "PostgreSQL Performance Tips for Backend Devs",
      description: "Indexes, query plans, connection pooling, and EXPLAIN ANALYZE. Make your queries fly.",
      imageOrientation: "LANDSCAPE" as const,
      color: "from-teal-500/20 to-cyan-500/20",
      sortOrder: 9,
      content: `# PostgreSQL Performance Tips for Backend Devs

Your ORM hides the SQL, but the database still runs it. Here's how to make it fast.

## Use EXPLAIN ANALYZE

Always check query plans before optimizing. Look for sequential scans on large tables.

## Indexing Strategy

- Index columns used in WHERE, JOIN, and ORDER BY
- Use partial indexes for filtered queries
- Composite indexes for multi-column lookups
- Don't over-index — each index slows writes

## Connection Pooling

Use PgBouncer or built-in pooling. Opening a new connection per request is expensive.

## Tips

- Use LIMIT and pagination — never fetch all rows
- Batch inserts with unnest or COPY
- Monitor slow queries with pg_stat_statements
- Vacuum regularly to prevent table bloat`,
    },
  ];

  for (const blog of blogsData) {
    await prisma.blog.create({ data: blog });
  }
  console.log("Blogs seeded");

  await prisma.quote.createMany({
    data: [
      { quote: "First, solve the problem. Then, write the code.", author: "John Johnson", sortOrder: 0 },
      { quote: "Code is like humor. When you have to explain it, it's bad.", author: "Cory House", sortOrder: 1 },
      { quote: "Simplicity is the soul of efficiency.", author: "Austin Freeman", sortOrder: 2 },
      { quote: "Make it work, make it right, make it fast.", author: "Kent Beck", sortOrder: 3 },
      { quote: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler", sortOrder: 4 },
      { quote: "The best error message is the one that never shows up.", author: "Thomas Fuchs", sortOrder: 5 },
      { quote: "Programming isn't about what you know; it's about what you can figure out.", author: "Chris Pine", sortOrder: 6 },
      { quote: "It's not a bug — it's an undocumented feature.", author: "Anonymous", sortOrder: 7 },
      { quote: "The only way to go fast, is to go well.", author: "Robert C. Martin", sortOrder: 8 },
      { quote: "Talk is cheap. Show me the code.", author: "Linus Torvalds", sortOrder: 9 },
    ],
  });
  console.log("Quotes seeded");

  await prisma.contactPurpose.createMany({
    data: [
      { label: "Freelance", emoji: "\uD83D\uDCBC", sortOrder: 0 },
      { label: "Job Opportunity", emoji: "\uD83D\uDE80", sortOrder: 1 },
      { label: "Collaboration", emoji: "\uD83E\uDD1D", sortOrder: 2 },
      { label: "Consultation", emoji: "\uD83D\uDCA1", sortOrder: 3 },
      { label: "Just Saying Hi", emoji: "\uD83D\uDC4B", sortOrder: 4 },
    ],
  });
  console.log("Contact purposes seeded");

  await prisma.heroContent.createMany({
    data: [
      {
        version: "v1",
        intro: "I build scalable web apps using",
        tagline: "Ship it, scale it, make it smarter, keep learning — that's the loop I live in.",
        live: "live",
      },
      {
        version: "v2",
        intro:
          "Hand me an idea, I'll hand you back a product. Fast backends, clean frontends, and pipelines that do their job so quietly you forget they exist.",
        tagline: "Ship it, scale it, make it smarter — that's the loop I live in.",
        live: null,
      },
    ],
  });
  console.log("Hero content seeded");

  await prisma.siteSettings.create({
    data: {
      id: 1,
      name: "Yatin Dora",
      avatarUrl: "/mine/avatar.png",
      heroPhotos: ["/mine/avatar.png", "/mine/avatar2.jpeg"],
      resumeUrl: "https://drive.google.com/file/d/1eljvOFwiltQbn6EvSiTv1fwjDipTSVI1/view?usp=sharing",
      navbarLogo: "Yatin.Dora",
      contactEmail: "yatin.dora81@gmail.com",
      availabilityStatus: "Available for opportunities",
      availabilityDetail: "Open to freelance, full-time & collaborations",
      heroDotColor: "",
      heroDotPulse: true,
      catNapStyle: "TICKS",
      catNapSeconds: 30,
      projectsVersion: "v2",
      copyrightName: "Yatin Dora",
    },
  });
  console.log("Site settings seeded");

  const hashedPassword = await bcrypt.hash("admin123", 10);
  await prisma.adminUser.create({
    data: {
      email: "yatin.dora81@gmail.com",
      username: "yatin",
      password: hashedPassword,
      name: "Yatin Dora",
      role: "OWNER",
    },
  });
  console.log("Admin user seeded (email: yatin.dora81@gmail.com, password: admin123)");

  console.log("Database seeded successfully!");
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
