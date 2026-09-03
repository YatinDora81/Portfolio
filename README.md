# Portfolio

A database-driven portfolio: a public site that renders from Postgres, and an admin app that
edits it and pushes the changes live. Turborepo monorepo, Bun, Next.js 16.

**Live:** [yatindora.in](https://yatindora.in) · **Repo:** [github.com/YatinDora81/Portfolio](https://github.com/YatinDora81/Portfolio)

Nothing on the public site is hardcoded. Copy, sections, projects, blog posts, the cat, the
background, even which hero variant is live — all of it comes out of the database, and all of it
is edited from the admin app.

## Tech stack

| | |
|---|---|
| Monorepo | Turborepo 2 + Bun 1.3.7 workspaces |
| Framework | Next.js 16.1.5 (pinned), React 19.2 |
| Language | TypeScript 5.9.2 (pinned), project references |
| Styling | Tailwind CSS 4 |
| Database | Postgres (Neon) + Prisma 7.8 |
| Object storage | Cloudflare R2 (S3 API) |
| Auth | jose HS256 JWT + bcrypt + email OTP |
| Email | Nodemailer over Gmail SMTP |
| Validation | Zod 3 (v3 API — `error.flatten()`, not `treeifyError()`) |
| Charts | Recharts |
| Motion | Motion.js, plus native view transitions |

## Layout

```
portfolio/
├── apps/
│   ├── web/            # the public site        (port 3000)
│   └── docs/           # the admin app          (port 3001)
├── packages/
│   ├── db/             # Prisma schema, client, and DB-side helpers
│   ├── config/         # the env schema — one Zod object, validated at boot
│   ├── shared/         # framework-free utilities used by both apps
│   ├── email/          # SMTP transport and templates
│   ├── storage/        # R2 client and media key rules
│   ├── ui/             # shared React components
│   ├── eslint-config/
│   └── typescript-config/
├── turbo.json
└── .env.example        # the single env reference for the whole repo
```

## apps/web — the public site

One page, rendered on the server, plus a route per blog post.

**Sections, in the order they appear:** Hero → About → Skills → Experience → Projects → Blogs →
Thought of the Day → Contact. Everything below the hero is wrapped in `HydrateWhenVisible`, so it
ships as server HTML and only hydrates as it nears the viewport.

**Rendering.** `export const revalidate = 86400` on both the landing page and `/blog/[slug]` — a
24-hour ISR window, cut short by on-demand revalidation from the admin. Reads go through
`unstable_cache` in `app/lib/data.ts`, tagged so single blog posts and projects can be busted
individually. The `'use cache'` directive and `cacheComponents` are **off**; `unstable_cache` is
the caching strategy here.

**Details worth knowing:**

- A full CSP and HSTS are set in `next.config.js` — adding a third-party script means editing
  that policy first.
- `experimental.viewTransition` is on; the theme toggle animates as a view-transition sweep.
- Images: AVIF/WebP, ~31-day minimum cache TTL, remote images allowed only from `cdn.yatindora.in`.
- A command menu (⌘K), a scroll-driven tuner rail, a terrain background layer, and the oneko cat
  that also fronts the 404 and error pages.
- `opengraph-image.tsx`, `sitemap.ts` and `robots.ts` are generated, not static.

### Web API routes

| Route | Method | What it does |
|---|---|---|
| `/api/revalidate` | POST | On-demand ISR. Secret in the `x-revalidate-secret` header or a `secret` body field, compared with `safeEqual`. Body takes `paths[]` and `tags[]` (≤100 entries, ≤512 chars each); an empty body revalidates `revalidatePath("/", "layout")` — the whole site. |
| `/api/contact` | POST | Contact form intake: Zod validation, spam heuristics, timing token, optional Turnstile, then a notification email. |
| `/api/contact/token` | GET | Issues the HMAC timing token the form posts back. |
| `/api/collect` | POST | First-party analytics beacon. Drops bot user-agents, batches events. |
| `/api/track/utm` | POST | Records UTM attribution for a visit. |
| `/api/blogs/[slug]` | GET | Blog post JSON. |
| `/api/github/refresh` | POST | Refreshes the cached GitHub profile and contribution years. |
| `/api/preview` · `/api/preview/exit` | GET | Draft Mode in and out, gated on a signed preview token. |
| `/r/[slug]` | GET | Short-link redirect. Looks up a `TrackedLink`, records a `LinkClick` in `after()`, 302s to the destination with `no-store`. |

## apps/docs — the admin

Every route except the auth pages is behind `middleware.ts`, which redirects to `/login` without a
valid `admin_session` cookie and clears the cookie if the JWT fails to verify.

**The page, top to bottom** — one screen per section of the public site:
Background · Hero · Cat · About (paragraphs, education) · Terminal (`whoami`) · Skills ·
Experience · Projects · Blogs · Thought of the day · Contact purposes

**Site & access:** Site chrome · Admins & roles · Change history · Revalidation · Feature flags ·
Media · Icon library

**Everything else:** Dashboard · Inbox · Notes · Refer emails · Tracker · Tracked links · Analytics

A few of these are substantial enough to call out:

- **Media** — a full R2 file browser. See below.
- **Notes** — a nested note vault (`NoteNode` is a self-referencing tree with a materialised
  `path` like `/dsa/graphs/dijkstra`). Folders and questions, reorderable siblings, soft-delete
  via trash, and zip import/export. Search is a small query language — bare words and phrases plus
  `tag:`, `in:<path>` and `is:` filters with negation — parsed in `lib/notes/query.ts` and
  compiled to Prisma. Revise grades each answer on a five-point confidence scale (unrated → again
  → shaky → good → solid). This is the one part of the repo with real test coverage: nine
  `bun:test` files under `app/lib/notes/`.
- **Analytics** — first-party, cookieless. Recharts dashboards over the rollup tables.
- **Tracked links** — short links with QR codes, click history, and per-link stats.
- **Change history** — an audit log; every mutation writes an `AuditEvent` plus per-field
  `AuditChange` rows.
- **Feature flags** — DB-backed kill switches read by the public site through a cached, tagged
  lookup.

### Auth

- **Session:** jose HS256 JWT in an httpOnly `admin_session` cookie, 7-day `maxAge`.
- **Lockout:** three failed passwords locks the account (`MAX_FAILED_ATTEMPTS = 3`). The way back
  in is an emailed OTP, valid 5 minutes — and OTP login is *only* offered after those three
  failures, not as a general login path.
- **Reset:** password reset by emailed link.
- **Roles:** `OWNER`, `ADMIN`, `SUB_ADMIN`. Middleware only proves the token is valid; role checks
  live in layouts and server actions.
- **Public-form defenses:** an HMAC timing token, a honeypot field, spam scoring, Turnstile, and a
  DB-backed rate limiter (`RateLimitBucket`). Each is independent — leaving its env var unset
  disables that one defense rather than breaking the form.

## Media and R2

The admin at `/media` is a real file manager over a Cloudflare R2 bucket, not a flat upload list.

- **Uploads** are direct-to-R2 through a presigned PUT (`UPLOAD_URL_TTL_SECONDS = 300`), then a
  `completeUpload` action writes the `MediaAsset` row. Max 10 MB; images plus a document
  allowlist; alt text is required (min 3 chars).
- **Keys** are sanitised, depth-capped at 6, and folder prefixes are held open by marker objects
  so an empty folder still exists.
- **The browser** walks the bucket as a paged folder tree down the left rail, renders a folder as
  cards or as a table, and carries a selection tray, an inspector for the file/folder/orphan in
  hand, and a context menu. Dropping a folder preserves its shape on the way in.
- **Move, rename, copy and bulk delete** operate on selections and on whole prefixes
  (`planFolderDelete` previews the damage before `deleteFolder` commits it).
- **Deletion is guarded.** `lib/media-references.ts` scans the content tables for keys that are
  still pointed at; anything in use is reported as blocked instead of deleted. Objects in the
  bucket with no matching row show up as orphans, and can be adopted into the library.

## packages

| Package | What's in it |
|---|---|
| `db` | Prisma schema (40 models, 9 enums), the pooled client, and DB-side helpers exported as subpaths: `lock`, `maintenance`, `publish-due`, `rate-limit`, `rollup`, `visibility`, `analytics-salt` |
| `config` | `@repo/config/env` — the one Zod schema every env var passes through |
| `shared` | `attribution`, `crypto`, `dates`, `flags`, `form-token`, `logger`, `preview-token`, `request-facts`, `result`, `slug`, `spam`, `tags`, `turnstile` |
| `email` | `auth`, `html`, `send`, `templates` |
| `storage` | `r2` (S3 client, presigning, list/copy/delete) and `media` (key rules, type and size limits) |
| `ui` | `button`, `card`, `code`, `icons`, plus `terminal` and `terrain` |
| `eslint-config`, `typescript-config` | shared configs |

Note the import names: the database package is imported **bare** as `db`, not `@repo/db`. The rest
use the `@repo/*` scope with subpath exports (`@repo/shared/tags`, `@repo/ui/button`). Both apps
alias `@/*` to `./app/*`.

## Database

40 models, grouped roughly:

- **Site content** — `HeroContent`, `HeroTitle`, `HeroSkillBadge`, `AboutParagraph`, `Education`,
  `Skill`, `Experience`, `ExperienceBullet`, `Project`, `ProjectBullet`, `Blog`, `Quote`,
  `SocialLink`, `SiteConfig`
- **Contact** — `ContactPurpose`, `ContactMessage`, `MessageReply`, `ReplyTemplate`
- **Analytics** — `AnalyticsSalt`, `AnalyticsSession`, `AnalyticsEvent`, `DailyStat`, `RollupRun`,
  `UtmTracker`, `TrackedLink`, `LinkClick`
- **Notes** — `NoteNode`, `NoteAnswer`
- **Media** — `MediaAsset`
- **Admin & ops** — `AdminUser`, `AuditEvent`, `AuditChange`, `FeatureFlag`, `RevalidationLog`,
  `TagState`, `JobLock`, `MaintenanceState`, `RateLimitBucket`
- **Integrations** — `GithubProfile`, `GithubYear`

**Enums:** `AdminRole`, `ContentStatus`, `MessageStatus`, `NoteKind`, `ScoreType`,
`ImageOrientation`, `EventType`, `RevalidationTrigger`, `RevalidationStatus`.

**Relationships:** Skill ↔ Experience and Skill ↔ Project are many-to-many; `ExperienceBullet`,
`ProjectBullet` and `NoteAnswer` cascade from their parents; `NoteNode` is a self-relation
(`NoteTree`) that cascades down the subtree.

## How a change reaches the site

1. An admin edits content in `apps/docs`. The server action writes the row and records an
   `AuditEvent`.
2. `publishSite()` (`app/lib/actions/publish.ts`) checks the session, then calls
   `revalidate()`, which POSTs to the public app's `/api/revalidate` with the shared secret.
3. The public app busts the named cache tags — `blogs`, `blog:<slug>`, `projects`,
   `project:<id>`, `site-config`, `flags` — or, with an empty body, the entire site.
4. The attempt is written to `RevalidationLog` with its trigger (`MANUAL` or `CONTENT_SAVE`) and
   status, and shown on the admin's Revalidation screen.

Content moves through `ContentStatus` (`DRAFT` → `SCHEDULED` → `PUBLISHED` → `ARCHIVED`).
Scheduled items are picked up by `publish-due`, and jobs that must not overlap take a `JobLock`.
Analytics roll up per day through `rollupDay` / `catchUpRollups` (≤5 days per request), with the
visitor-hashing salt rotated daily and old salts pruned — hashes, not cookies, so nothing
identifying is stored.

## Getting started

**Prerequisites:** [Bun](https://bun.sh) 1.3.7+ and a Postgres database ([Neon](https://neon.tech)
works well).

```bash
git clone https://github.com/YatinDora81/Portfolio.git
cd Portfolio
bun install
```

### Environment

There is **one** reference file, [`.env.example`](./.env.example) at the repo root — read it, it
explains each variable. There is no per-app `.env.example` to copy. Env lives in one `.env` per
app, plus one in `packages/db` so Prisma CLI commands work with no app loaded:

```
apps/web/.env        apps/docs/.env        packages/db/.env
```

Everything is validated at boot by `packages/config/src/env.ts`, so a missing or malformed value
fails fast instead of surfacing as a null three screens later.

The short version:

- **Everywhere:** `DATABASE_URL`
- **Both apps, identical value:** `REVALIDATE_SECRET` (min 32 chars)
- **Admin only:** `JWT_SECRET`, `SMTP_EMAIL`, `SMTP_PASSWORD`
- **Optional, both apps, identical value:** `PREVIEW_SECRET` — unset turns preview off; it must
  *not* equal `JWT_SECRET`
- **Optional, per feature:** Turnstile, Clarity, R2 (`R2_*`, all four or none), Google Sheets,
  Supabase, `CONTACT_FORM_HMAC_SECRET`, `NOTIFY_EMAIL_TO`, `ADMIN_BASE_URL`, `CDN_BASE_URL`

> `DATABASE_URL` should be Neon's **pooled** endpoint (host ends in `-pooler`) for the apps — they
> run serverless and open many short-lived connections. Use the direct endpoint for
> `prisma migrate` / `db push`.

### Database

```bash
cd packages/db
bun run db:push        # push the schema
bun run db:generate    # generate the Prisma client
bun run seed           # optional seed
bun run flags:seed     # optional: seed the feature flags
bun run hero:v2        # optional: install the v2 hero content
```

### Develop

```bash
bun run dev            # web on :3000, admin on :3001
```

### Everything else

```bash
bun run build          # turbo run build
bun run lint           # eslint, --max-warnings 0
bun run check-types    # next typegen && tsc --noEmit across the graph
bun run format         # prettier
bun test               # the notes test suite, from apps/docs
ANALYZE=true bun run build   # bundle treemaps under apps/web/.next/analyze/
```

## Gotchas

- **`revalidateTag` takes two arguments in Next 16** — `revalidateTag(tag, "max")` from a route
  handler, or `updateTag(tag)` from a server action when you need read-your-own-writes.
- **Zod is v3.** Use `error.flatten()`; `treeifyError()` is v4.
- **Next and TypeScript are pinned** (16.1.5 / 5.9.2). Bumping either is a deliberate act.
- **`cacheComponents` / `dynamicIO` are off** in both apps.
- **Server action body limit** in the admin is 5 MB (`next.config.js`), which is why uploads go
  direct to R2 rather than through an action.
- **`PORTFOLIO_URL` is vestigial.** `apps/docs/app/lib/revalidate.ts` still throws without it, but
  nothing imports that module any more — the live path is `lib/revalidation.ts` via
  `publishSite()`. It lingers in `turbo.json`'s `globalEnv` and is absent from `.env.example`.

## Further reading

- [IMPLEMENTATION-NOTES.md](./IMPLEMENTATION-NOTES.md) — full technical specifications
- [PERFORMANCE.md](./PERFORMANCE.md) — the SSR and payload work on the public site
- [packages/db/README.md](./packages/db/README.md) — schema notes
