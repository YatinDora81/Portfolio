# Database Schema Reference

## Hero Section

### HeroTitle
Rotating titles that cycle in the hero heading with a blur transition.
```
e.g. { title: "Full-Stack Developer", sortOrder: 1 }
```

### HeroSkillBadge
Inline skill badges displayed in the hero bio text ("I build scalable web apps using [React] [Next.js] ...").
```
e.g. { name: "React", iconKey: "react", sortOrder: 1 }
```

### SocialLink
Social links displayed in hero, footer, and contact sections (GitHub, LinkedIn, LeetCode, Email). `detail` is optional and shown in the contact section.
```
e.g. { name: "GitHub", href: "https://github.com/yatindora", iconKey: "github", detail: "@yatindora", sortOrder: 2 }
```

---

## About Section

### AboutParagraph
Bio paragraphs rendered in the about section. Supports inline HTML for bold/links.
```
e.g. { content: "I'm a <b>Full-Stack Developer</b> with experience building production-grade web applications.", sortOrder: 1 }
```

### ScoreType (Enum)
- `CGPA` — e.g. 9.5 / 10
- `PERCENTAGE` — e.g. 85 / 100

### Education
Education entries displayed as a card in the about section with institution, degree, and score.
- `score` — the value, e.g. "9.5" or "85"
- `scoreTotal` — the max, e.g. "10" or "100"
```
e.g. { institution: "Chitkara University", location: "Rajpura", degree: "B.E - CSE", scoreType: CGPA, score: "9.5", scoreTotal: "10", startYear: "2021", endYear: "2025" }
```

---

## Skills Section

### Skill
Single source of truth for all technologies. Shown in the skills grid when `show=true`. Also directly linked to Experience and Project via implicit many-to-many (Prisma auto-creates join tables).

- `show=true` — visible in skills grid on the landing page
- `show=false` — hidden from skills grid, but still usable in experience/project tech badges
- `experiences` — back-relation to experiences using this skill
- `projects` — back-relation to projects using this skill
```
e.g. { name: "TypeScript", iconKey: "typescript", show: true, sortOrder: 3 }
e.g. { name: "GitHub Actions", iconKey: "github-actions", show: false, sortOrder: 99 }
```

---

## Experience Section

### Experience
Work experience entries — each card shows company, role, location, date range, and linked skills/bullets.

- `bullets` — ExperienceBullet[] — bullet points for this experience
- `skills` — Skill[] — tech badges shown on this experience card, ordering controlled by array index
```
e.g. { company: "Wiingy", position: "Software Development Engineer", location: "Bangalore, Karnataka", startDate: "July 2025", endDate: "Present", isCurrent: true, website: "https://wiingy.com" }
```

### ExperienceBullet
Bullet points for each experience. Supports inline HTML for bold, links, etc. Shown with reveal animation on hover/tap.
```
e.g. { content: "<b>Built the scheduling platform from scratch</b> — architected end-to-end calendar operations with Google Calendar sync.", sortOrder: 1 }
```

---

## Projects Section

### Project
Portfolio project cards with summary, links (GitHub/live), preview image, and linked skills/bullets.

- `bullets` — ProjectBullet[] — bullet points for this project
- `skills` — Skill[] — tech icon badges shown on this project card, ordering controlled by array index
```
e.g. { title: "Draw Sheet", summary: "Real-time collaborative drawing app", github: "https://github.com/yatindora/draw-and-connect", live: "https://drawsheet.yatindora.xyz", image: "https://...", sortOrder: 1 }
```

### ProjectBullet
Bullet points for each project. Supports inline HTML for bold, links, etc. Shown with reveal animation on hover/tap.
```
e.g. { content: "<b>Built real-time collaboration from scratch</b> — multi-user live drawing with instant synchronization using WebSockets.", sortOrder: 1 }
```

---

## Blogs Section

### Blog
Blog posts displayed in a masonry grid. Clicking opens a modal with rendered markdown content.

- `imageOrientation` — enum controlling card image aspect ratio in the masonry grid. Frontend maps to CSS heights:
  - `LANDSCAPE` — wide/short (e.g. h-28, h-36)
  - `PORTRAIT` — tall/narrow (e.g. h-48, h-52)
  - `SQUARE` — equal ratio (e.g. h-40, h-44)
- `color` — Tailwind gradient classes for the card overlay (e.g. "from-blue-500/20 to-cyan-500/20")
```
e.g. { slug: "turborepo-monorepo", title: "Why I Chose Turborepo", description: "After trying Lerna, Nx...", content: "# Why Turborepo ...", image: "https://...", imageOrientation: LANDSCAPE, color: "from-blue-500/20 to-cyan-500/20", sortOrder: 1 }
```

---

## Thought of the Day

### Quote
Programming quotes that rotate daily on the landing page. Selected by day-of-year modulo total count.
```
e.g. { quote: "Talk is cheap. Show me the code.", author: "Linus Torvalds" }
```

---

## Contact Section

### ContactPurpose
Purpose chips in the contact form. User selects one to categorize their inquiry before sending.
```
e.g. { label: "Job Opportunity", emoji: "🚀", sortOrder: 2 }
```

---

## Site Config

### SiteConfig
Key-value store for site-wide configuration that was previously hardcoded in frontend components. Fetched in a single query by `getSiteConfig()` in `data.ts`, with fallback defaults if keys are missing.

**Keys:**
| Key | Used In | Description |
|-----|---------|-------------|
| `name` | Hero | First name shown in hero heading ("Hi, I'm {name} —") and avatar alt text |
| `tagline` | Hero | Sentence after the skill badges in hero bio |
| `intro` | Hero | Text before inline skill badges ("I build scalable web apps using") |
| `avatarUrl` | Hero | Path to avatar image (e.g. "/avatar.png") |
| `resumeUrl` | Hero | Path to resume PDF (e.g. "/Yatin-SDE-1.pdf") |
| `navbarLogo` | Navbar | Logo text in the navbar (e.g. "Yatin.Dora") |
| `contactEmail` | Contact | Email address used in the mailto link of the contact form |
| `availabilityStatus` | Contact | Status text (e.g. "Available for opportunities") |
| `availabilityDetail` | Contact | Detail text below status (e.g. "Open to freelance, full-time & collaborations") |
| `copyrightName` | Footer | Name in the copyright line (e.g. "Yatin Dora") |

```
e.g. { key: "name", value: "Yatin" }
e.g. { key: "contactEmail", value: "yatin.dora81@gmail.com" }
```

---

## Notes

- **Blogs section** is conditionally rendered — hidden entirely when no blog entries exist in the database. The "Blogs" nav link in the Navbar is also removed when `hasBlogs` is false.
