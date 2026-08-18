# Database Schema Reference

## Hero Section

Two hero layouts exist side by side and the `HeroContent` row holding `live` picks the one the site serves:

- **v1** — one bio paragraph carries the skill badges inline and ends with the tagline; ghost "Resume / CV" comes before solid "Get in touch".
- **v2** — a plain intro paragraph, then the tagline on its own italic line; the skill badges sit in a wrapped pill row that ends in a `+N more ↓` chip linking to `#skills`; solid "Get in touch" comes before ghost "View Resume".

The role line itself is shared: it cycles whenever the live version has more than one title, in either version.

HeroTitle, HeroSkillBadge and SocialLink each carry a `version` column so both sets of rows can live in one table; HeroContent carries one row *per* version instead.

**Invariant:** `sortOrder` is dense *within* a version, never across the table — v1 and v2 each start at 0 and number independently, in HeroTitle, HeroSkillBadge and SocialLink. Every read that feeds the hero must therefore carry a version filter. The one deliberate exception is the admin's icon-usage lookup, which asks "is this icon used anywhere at all".

### HeroContent
Exactly two rows, one per hero version, holding that version's copy and whether it is the one visitors see. Replaces the `heroVersion`, `intro`, `tagline`, `introV2` and `taglineV2` SiteConfig rows.

- `version` — `"v1"` or `"v2"`, unique, with a `HeroContent_version_check` CHECK constraint
- `intro` / `tagline` — NOT NULL, default `""`. **Blank means blank:** v2 no longer inherits v1's copy when its own field is empty. The migration resolved that fallback once, into the rows.
- `live` — the sentinel `"live"` on the served row, NULL on the other. Unique, so "at most one row is live" is a database constraint rather than a convention. A boolean would have needed a partial index Prisma cannot express; `@unique` on a boolean would have allowed only one *non*-live row.

Edited on the admin's `/hero` page, through the same save bar as the titles and badges — which is the point: flipping the live version commits in the same transaction as the rows that version depends on.
```
e.g. { version: "v2", intro: "Hand me an idea…", tagline: "Ship it, scale it…", live: "live" }
```

### HeroTitle
Role titles shown under the name in the hero heading with a blur transition. Two or more rows in the live version cycle; a single row holds still. v1 ships several, v2 ships one.

- `version` — `"v1"` or `"v2"`, required (defaults to `"v2"`)
```
e.g. { title: "Full-Stack Developer", sortOrder: 1, version: "v1" }
```

### HeroSkillBadge
Skill badges shown in the hero. v1 draws them inline inside the bio sentence (`intro` + badges + `tagline`); v2 draws them as a separate pill row below the intro, followed by a `+N more ↓` chip counting the skills that only appear in the skills grid.

- `version` — `"v1"` or `"v2"`, required (defaults to `"v2"`)
```
e.g. { name: "React", iconKey: "react", sortOrder: 1, version: "v2" }
```

### SocialLink
Social links displayed in hero, footer, and contact sections (GitHub, LinkedIn, LeetCode, Email). `detail` is optional and shown in the contact section.

- `version` — nullable, and NULL means "shown in every version". It is nullable here and not above because the footer and contact section read this table too and stay version-agnostic; scope a row only when one hero version needs a link the other does not.
```
e.g. { name: "GitHub", href: "https://github.com/yatindora", iconKey: "github", detail: "@yatindora", sortOrder: 2, version: null }
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

### GithubProfile / GithubYear
The contribution heatmap in the contact section's GitHub tile. Written only by the refresh in `apps/web/app/lib/github.ts`; nothing in the admin edits these rows, the same arrangement as `UtmTracker` and `ContactMessage`.

The upstream source (`github-contributions-api.jogruber.de`, unauthenticated, no SLA) serves only a **trailing 365 days**, so these tables are both the outage fallback and the only place older history will ever exist — a day not captured before it scrolls out of that window is unrecoverable. Rows are therefore a permanent archive, never overwritten wholesale.

**GithubProfile** — one row per account, holding the scalars from the last successful poll.
- `total` — contributions in the trailing year, taken verbatim from the API. Not summed from `GithubYear`: the API's window starts on a week boundary and runs ~369 days, so a 365-day sum legitimately disagrees by a day or two, and the API's number is the authoritative one.
- `fetchedAt` — what the tile prints as "as of jul 24". Advanced **only** on a successful, validated poll, so the label can never claim to be newer than the data.
```
e.g. { handle: "YatinDora81", total: 456, fetchedAt: 2026-07-30T13:00:00Z }
```

**GithubYear** — one row per calendar year of history.
- `days` — one character per day, index 0 = Jan 1 UTC, encoded against `0-9a-zA-Z-_` where the index *is* the count. A year reads as `000310021045000…` and needs no decoder to skim. Length is 365 or 366, held there by `GithubYear_days_length_check` — the length carries the calendar, so a row of any other size could not be indexed by day-of-year at all.
- `spikes` — `"index:count"` pairs for the rare days above 63, which one character cannot hold. Empty in a normal year; it exists so the archive is lossless rather than lossy in the tail.

Keyed to the **calendar year**, not to the fetch window: a trailing year slides one day daily, so any offset stored against it drifts, whereas Jan 1 never moves. A refresh writes only the days the response actually mentioned, which is what lets an outage heal on the next success and leaves scrolled-out years untouched.

Raw **counts** are stored, never the API's `level` — that level is quantile-derived over the API's own sliding window, so the same day reports 3 one month and 2 the next. Levels, streaks and the layout are all recomputed at read time in `apps/web/app/lib/github-codec.ts`.
```
e.g. { handle: "YatinDora81", year: 2026, days: "0003100210450…", spikes: "" }
```

---

## Site Config

### SiteConfig
Key-value store for site-wide configuration that was previously hardcoded in frontend components. Read by `getSiteConfig()` in `data.ts`, alongside the HeroContent rows, with fallback defaults if keys are missing.

The hero's own copy and the version it serves are **not** here — they are columns on [HeroContent](#herocontent), so that flipping the live version commits atomically with the titles and badges it depends on.

**Keys:**
| Key | Used In | Description |
|-----|---------|-------------|
| `name` | Hero, JSON-LD | Full name on the hero nameplate (split on whitespace, trailing dot appended), and `Person.name` in the structured data |
| `avatarUrl` | Hero, JSON-LD | Path to avatar image (e.g. "/mine/avatar.png"). Also `Person.image` |
| `heroPhotos` | Hero | Comma-separated photo paths for the name-hover peek deck (e.g. "/mine/avatar.png,/mine/avatar-2.png"). Gliding across the nameplate flips through them; one entry means no flipping. Falls back to `avatarUrl` when unset |
| `resumeUrl` | Hero, About | Path to resume PDF (e.g. "/Yatin-SDE-1.pdf"). The About terminal's `resume`/`cv` command opens the same URL |
| `navbarLogo` | Navbar | Logo text in the navbar (e.g. "Yatin.Dora") |
| `contactEmail` | Contact | Email address used in the mailto link of the contact form |
| `availabilityStatus` | Hero, Contact | Status text (e.g. "Available for opportunities") — the hero pill and the contact availability card render the same string |
| `availabilityDetail` | Contact | Detail text below status (e.g. "Open to freelance, full-time & collaborations") |
| `projectsVersion` | Projects | Which layout the Projects section renders — `v1` the work ledger, `v2` the build log. Both layouts read the same [Project](#project) rows, so unlike the hero there is nothing to flip atomically with them. A missing or unrecognised value reads as `v2` |
| `copyrightName` | Footer | Name in the copyright line (e.g. "Yatin Dora") |

```
e.g. { key: "name", value: "Yatin" }
e.g. { key: "contactEmail", value: "yatin.dora81@gmail.com" }
```

---

## Notes

- **Blogs section** is conditionally rendered — hidden entirely when no blog entries exist in the database. The "Blogs" nav link in the Navbar is also removed when `hasBlogs` is false.
