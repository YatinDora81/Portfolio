# Implementation Notes

Running log for the 10-phase build. Every path below was read from the tree, not
inferred from a README — the phase documents were written from the README and
are wrong about a lot of it. Where they disagree with this file, this file wins.

## Verified paths

| Thing | Real value |
|---|---|
| Public app | `apps/web` (package `web`, port 3000) |
| Admin app | `apps/docs` (package `docs`, port 3001) |
| Prisma schema | `packages/db/prisma/schema.prisma` |
| Prisma config | `packages/db/prisma.config.ts` |
| **Prisma client import** | `import { prisma } from "db";` — bare and unscoped. **Not** `@repo/db`. |
| Migrations | `packages/db/prisma/migrations/`, hand-written raw SQL with a prose header |
| Email helper | `apps/docs/app/lib/mail.ts` — nodemailer, `service: "gmail"`, inline-styled HTML strings |
| Auth primitives | `apps/docs/app/lib/auth.ts` — `signToken` / `verifyToken` (jose HS256, 7d) |
| Session helper | `apps/docs/app/lib/session.ts` — `getSession()`, cookie `admin_session` |
| **`requireAdmin`** | **Does not exist.** Each action file has its own private `requireSession()`. See "Auth" below. |
| Live revalidation | `apps/docs/app/lib/actions/publish.ts` → `publishSite()` |
| Dead revalidation | `apps/docs/app/lib/revalidate.ts` — nothing imports it, and it **throws at module load** if `PORTFOLIO_URL` is unset. Do not import. |
| Revalidate endpoint | `apps/web/app/api/revalidate/route.ts` — accepts the secret in the `x-revalidate-secret` **header** (preferred) or the legacy **JSON body** `secret` field |
| Public content reads | `apps/web/app/lib/data.ts` — the only file with landing-page Prisma reads |
| UI package | `@repo/ui`, subpath exports, no barrel. `"./*": "./src/*.tsx"` cannot serve `.ts` — those need their own exports entry. |
| Path alias, both apps | `"@/*": ["./app/*"]` — so `@/lib/session` is `apps/docs/app/lib/session.ts` |

## Versions

- next `16.1.5` (pinned) · react `19.2.4` · prisma `7.8.0` · typescript `5.9.2` (pinned)
- zod `3.25.76` — **v3 API surface**. `import { z } from "zod"` is v3; v4 lives behind `zod/v4`.
  Use `error.flatten()`, not `treeifyError()`.
- bun `1.3.7`

## next.config flags

**`cacheComponents` / `dynamicIO` are OFF in both apps.** No `experimental` block in
`apps/web/next.config.js` at all; `apps/docs` has only `serverActions.bodySizeLimit`.

→ **Use `unstable_cache`. Not `'use cache'` + `cacheTag`.** The latter is only legal
inside a `"use cache"` function, which needs `cacheComponents: true`, and turning
that on is a repo-wide rendering change.

Reference implementation already in the tree: `apps/docs/app/lib/notes/vault.ts:114`.

⚠️ **`revalidateTag` takes two arguments in Next 16**: `revalidateTag(tag, profile)`.
Single-arg fails typecheck. Use `updateTag(tag)` from a server action for
read-your-own-writes, `revalidateTag(tag, "max")` otherwise — as
`apps/docs/app/lib/actions/notes.ts:82,105` does.

## Auth

Three layers, only one of which gates writes:

1. **Cookie + JWT** — `admin_session`, jose HS256, payload `{ userId, email, role }`.
2. **Middleware** (`apps/docs/middleware.ts`) — proves the JWT parses. Never inspects
   `role`, and **does not run for a direct server-action POST**.
3. **Dashboard layout** — `getSession()` + `redirect("/login")`. Covers **pages only**;
   route handlers are not wrapped by layouts.

A new admin **server action** must call a session guard as its first statement.
A new admin **route handler** must do the same and return **401**, not a redirect —
a 307 to `/login` is the wrong answer to a `fetch`. Precedent:
`apps/docs/app/(dashboard)/notes/export/route.ts`.

## Deviations from the phase docs

| Doc says | Reality | Handling |
|---|---|---|
| `packages/config`, `packages/shared` exist | Neither existed | Created in Phase 01 as `@repo/config` and `@repo/shared` |
| `import { prisma } from "@repo/db"` | It is `from "db"` | Use `db` everywhere |
| `PUBLIC_SITE_URL` | No such var. It is `NEXT_PUBLIC_SITE_URL`, and it is **absent from every local `.env`** — 23 call sites carry the fallback `https://www.yatindora.in` | Env schema defaults to that same string so adding validation cannot move a build |
| `PORTFOLIO_URL` is the site origin | Read by exactly one dead file that throws at module load | Do not resurrect |
| Revalidate auth is an `x-revalidate-secret` header | Secret arrives in the **JSON body**; three callers depend on that | Phase 02 keeps the body form working and adds the header form alongside |
| `REVALIDATE_SECRET` needs generating | Already set, 79 chars — clears `min(32)` | Left alone |
| `JWT_SECRET` min 32 | Deployed value is **25 chars** | Schema floors it at 1, not 32, or every admin is locked out at boot. Rotating it is a separate change with a login flow to re-test. |
| `server-only` is available | **Not installed anywhere** | Added as a dependency of `@repo/shared`, `@repo/config`, `db`. Verified it survives a production build inside a route handler. |
| `Blog.status` enum | It is `show Boolean @default(true)` | Phase 04 |
| `Project.slug` | **Project has no slug and no unique string column** | Phase 04 must key projects by `id` |
| `Project` visibility flag | **None.** `data.ts:190` has no `where` at all — every project is public | Phase 04 |
| `Project.live` is a lifecycle flag | It is the **demo URL**. `HeroContent.live` is a third, unrelated meaning | Never name a visibility column `live` |
| `ContactMessage.body` | The column is **`message`** | Phase 05 |
| Blog/Project ride the staging + audit system | They do not — `staging.ts`'s `Entity` union excludes them | Leave them as immediate-write actions |

## Row counts, recorded before any data migration (2026-08-21)

```
Blog                 10   (show = true: 0,  show = false: 10)
Project               6   (no visibility column exists)
ContactMessage        7
```

**Every blog is currently hidden.** `page.tsx:185` renders the Blogs section only
when `blogs.length > 0`, so it does not render today, and `Navbar hasBlogs` is
false. Phase 04's backfill must therefore produce **10 DRAFT / 0 PUBLISHED** for
Blog, and — because Project has no flag and all 6 are live — **6 PUBLISHED** for
Project.

## Phase log

- [x] 01 foundations
- [x] 02 revalidation
- [x] 03 feature flags
- [x] 04 content status
- [ ] 05 inbox
- [ ] 06 analytics core
- [ ] 07 dwell time
- [ ] 08 link registry
- [ ] 09 rollup
- [ ] 10 media manager

---

## Phase 01 — foundations

### Import paths every later phase uses

```ts
import { env }                    from "@repo/config/env";
import { safeEqual, sha256, randomToken } from "@repo/shared/crypto";   // server-only
import { utcDayStart, utcDayEnd, utcYesterday, toDateKey, eachUtcDay } from "@repo/shared/dates";
import { logger }                 from "@repo/shared/logger";
import { ok, err, type Result }   from "@repo/shared/result";
import { acquireLock }            from "db/lock";                        // server-only
import { prisma }                 from "db";
```

### Files created

- `packages/shared/{package.json,tsconfig.json,eslint.config.mjs}` — new workspace package
- `packages/shared/src/result.ts` — `Result<T,E>`, `ok`, `err`
- `packages/shared/src/logger.ts` — one JSON object per line
- `packages/shared/src/crypto.ts` — `safeEqual`, `sha256`, `randomToken` (`server-only`)
- `packages/shared/src/dates.ts` — UTC day helpers (client-safe, deliberately no `server-only`)
- `packages/config/{package.json,tsconfig.json,eslint.config.mjs}` — new workspace package
- `packages/config/src/env.ts` — zod-validated env, parsed once at module load
- `packages/db/src/lock.ts` — `acquireLock` (`server-only`)
- `packages/db/prisma/migrations/20260821120000_add_job_lock/migration.sql`
- `.env.example` — did not exist; `README.md:106` told you to copy a file that was never there

### Files modified

- `packages/db/prisma/schema.prisma` — added `JobLock`
- `packages/db/package.json` — `exports["./lock"]`, `server-only` dep
- `apps/web/next.config.js`, `apps/docs/next.config.js` — `transpilePackages` += `@repo/shared`, `@repo/config`
  (**hard requirement** — the packages ship raw TS)
- `apps/web/package.json` — deps += `@repo/shared`, `@repo/config`, `zod`
- `apps/docs/package.json` — deps += `@repo/shared`, `@repo/config`
- `tsconfig.json` — references += the two new packages

### Schema changes

- `JobLock`: `key` (PK), `lockedAt`, `lockedBy`, `expiresAt`, `@@index([expiresAt])`
- Migration: `add_job_lock`

### Idempotency audit

- `acquireLock()` — **Pattern A**. Create-or-conditional-update; the steal is
  `updateMany({ where: { key, expiresAt: { lt: now } } })`, so of two concurrent
  callers exactly one matches a row.
- `releaseLock()` — **Pattern A**, guarded on `lockedBy` so an expired holder
  cannot release the lock that was stolen from it.

### Verification

- [x] `prisma validate` — valid
- [x] `prisma generate` — 7.8.0
- [x] `tsc --noEmit` — 0 errors, both apps + both new packages
- [x] `bun run lint` — 5/5 tasks, `--max-warnings 0`
- [x] `bun run build` — both apps. `/` still `○` static, `/blog/[slug]` still `●` (no ISR regression)
- [x] Lock: `true / false / true`, then cleaned up
- [x] Dates: `toDateKey("2026-08-21T23:30+05:30")` → `2026-08-21`; `"2026-08-22T01:00+05:30"` → `2026-08-21` (the trap, working as designed)
- [x] Env: unsetting `DATABASE_URL` fails at boot naming `DATABASE_URL`, not a Prisma stack trace
- [x] `server-only` survives a production build when imported into a route handler

### Note on the pre-existing pending migration

`migrate status` showed **two** unapplied migrations, not one:
`20260818120000_add_projects_version` had never been applied. It is a single
`INSERT ... ON CONFLICT DO NOTHING` seeding `projectsVersion = 'v2'`, which the
reading code already treats as the default, so applying it changed nothing a
visitor can see. Both are now applied; `migrate status` is clean.

### Env vars added

None. `NEXT_PUBLIC_SITE_URL` is now *validated* (with a default) but was already read
in 23 places.

### Blockers for the next phase

None.

---

## Phase 02 — revalidation observability

### Import paths this phase adds

```ts
import { tags, blogTags, projectTags, ALL_KNOWN_TAGS } from "@repo/shared/tags";
import { revalidate, readHealth, readRecentLogs, readTagStates } from "@/lib/revalidation";  // apps/docs, server-only
import { findStaleContent, type StaleItem } from "@/lib/stale";                              // apps/docs, server-only
import { revalidateNow, revalidateWholeSite, revalidateBlog, revalidateAllStale } from "@/lib/actions/revalidation";
```

### Files created

- `packages/shared/src/tags.ts` — the one place a tag string is built
- `apps/docs/app/lib/revalidation.ts` — `revalidate()` (never throws) + the dashboard's read helpers
- `apps/docs/app/lib/stale.ts` — `findStaleContent()`
- `apps/docs/app/lib/actions/revalidation.ts` — four server actions
- `apps/docs/app/(dashboard)/revalidation/{page,parts}.tsx` — the dashboard
- `packages/db/prisma/migrations/20260821130000_add_revalidation_log/migration.sql`

### Files modified

- `apps/web/app/api/revalidate/route.ts` — header **or** body secret, `safeEqual`, zod, paths/tags branch
- **`apps/web/app/lib/data.ts` — `getBlogs`, `getBlogBySlug`, `getProjects`, `getSiteConfig` wrapped in `unstable_cache` with real tags.** See the deviation below.
- `apps/docs/app/lib/actions/publish.ts` — routed through `revalidate()`; signature and `recordPublish` unchanged
- `apps/docs/app/lib/nav.ts`, `apps/docs/app/control-room.css` — one nav entry, page styles
- `packages/db/src/index.ts` — re-export `RevalidationTrigger`, `RevalidationStatus`

### Schema changes

- `RevalidationLog`, `TagState`, enums `RevalidationTrigger`, `RevalidationStatus`
- Migration: `add_revalidation_log`

### Idempotency audit

- `revalidate()` → `revalidationLog.create` — **append-only by design.** One row per attempt is the point; two attempts *should* be two rows.
- `revalidate()` → `tagState.upsert` — **Pattern B**, upsert on the `tag` primary key. Re-running overwrites, never accumulates. The failure branch uses `{ increment: 1 }`, which is deliberate: consecutive failures are a count, not a state.
- `publishSite()` — unchanged semantics; still one audit record per gesture.

### 🚨 Deliberate deviation from the phase doc — tagging the public reads

The doc says *"Do not change what gets revalidated yet... migrating the public app's fetches to tag-based caching is a separate concern."* **Following that literally produces a dashboard that lies**, and three independent reviewers caught it:

`apps/web` carried **no cache tags at all**. So `revalidateTag("blogs")` matched nothing, returned 200, was recorded `SUCCESS`, and stamped `TagState.lastSuccessAt` — which is the value the stale detector reads. Pressing "Revalidate" would have *cleared the warning* about a page that was still stale. Meanwhile `publishSite()`, the only flush that actually worked, wrote no `TagState`, so every blog stayed listed as stale forever. The two halves were exactly inverted.

So the four public reads are now genuinely tagged. Phase 03 requires this anyway — its `getFlags` is specified as `unstable_cache(..., { tags: ["flags"] })`.

Proven end-to-end against a production build, **with a negative control**:

```
GET  /                          x-nextjs-cache: HIT
POST /api/revalidate {"tags":["flags"]}      -> GET /  HIT    (correctly unaffected)
POST /api/revalidate {"tags":["blogs"]}      -> GET /  STALE
POST /api/revalidate {"tags":["site-config"]}-> GET /  STALE
GET  /sitemap.xml               HIT -> flush "blogs" -> STALE
```

Real per-tag matching, not a blanket flush.

### 🚨 `unstable_cache` does not preserve `Date`

The highest-value find of the phase. `next/dist/server/web/spec-extension/unstable-cache.js` stores `JSON.stringify(result)` and returns `JSON.parse(...)` on a hit — so **the same function returns a `Date` on the cold call and a `string` on every warm one**, while `unstable_cache`'s `<T extends Callback>(cb: T) => T` signature keeps claiming `Date`.

Measured in the real runtime:

```
call #1 (cold)  publishedAtIsDate: true   ctor: [object Date]
call #2 (warm)  publishedAtIsDate: false  ctor: [object String]
```

`app/sitemap.ts` hands `updatedAt` straight to `lastModified`, and a future `.toISOString()` on it would have thrown on the warm path. Fixed by reviving explicitly at the boundary (`reviveBlogDates`) rather than shipping a type that lies. **Any later phase that caches a row with a `DateTime` column must do the same.**

### Deviations from the phase doc

| Doc | Reality |
|---|---|
| `apps/docs/app/api/admin/revalidate/route.ts` | `apps/docs/app/api` does not exist; the repo uses **server actions**. Built as actions in `lib/actions/revalidation.ts`, matching house style. |
| `requireAdmin()` | Does not exist. Each action guards with `getSession()` first and returns `{ ok: false }` — a redirect is the wrong answer to a button waiting on a result. |
| `findStaleContent` covers Blog **and** Project | **Blog only.** `Project` has no `updatedAt` and no `slug`, so there is nothing to compare against. Projects join the detector in whichever phase gives them an `updatedAt`. |
| `tags.project(slug)` | `tags.project(id)` — Project has no unique string column. |
| Stale detector reads `TagState` alone | Also floors on the newest whole-site `SUCCESS` log row. A layout flush provably re-rendered every blog route, so it covers every blog tag even though it names none. |
| "Flush the site" = `paths: ["/"]` | That flushes **only the homepage** — bare `revalidatePath("/")` emits only `_N_T_/`, which no other route carries. `revalidateWholeSite()` sends nothing at all, so the route takes its `revalidatePath("/", "layout")` branch. |

### Verification

- [x] `prisma validate` · `prisma generate` · `tsc --noEmit` (0 errors) · `lint` · `build` (both apps)
- [x] Route table unchanged: `/` `○`, `/blog/[slug]` `●`, `/sitemap.xml` `○`
- [x] Legacy `{ secret }` body still returns `{ revalidated: true, now }` — 200; wrong secret 401; bad JSON 400; over-cap arrays 400
- [x] Header secret works; an **empty** header beats a valid body secret (401) — header wins, as specified
- [x] Tag flush reaches the page, with a negative control
- [x] Stale detector returns **0** against live data (all 10 blogs are `show: false`, so none is publicly reachable)
- [x] `publishSite` signature byte-identical; all 8 call sites unchanged; `lib/revalidate.ts` untouched and still unimported

### Not yet verified (needs a browser)

The dashboard's own rendering was verified via its RSC payload, not by eye. Manual steps 1–6 from the phase doc (clicking the buttons, breaking the secret to see a red error) are still worth doing once.

### Env vars added

None. `REVALIDATE_SECRET` and `NEXT_PUBLIC_SITE_URL` are now read through `@repo/config/env` instead of `process.env`.

### Known, accepted

`tags.flags()` is in `ALL_KNOWN_TAGS` and gets a button, but nothing caches under it until Phase 03 creates `getFlags`. Flushing it is a no-op **that the negative control above actually relies on**. Phase 03 makes it real.

### Blockers for the next phase

None.

---

## Phase 03 — feature flags

**Maintenance mode was deliberately excluded** at the user's direction. No `apps/web/middleware.ts`,
no Edge Config, no Upstash, no `/maintenance` page. Feature flags only.

### Import paths this phase adds

```ts
import { FLAG_KEYS, FLAG_DEFINITIONS, flagValue, defaultFlagMap, type FlagMap } from "@repo/shared/flags";
import { getFlags } from "@/lib/flags";              // apps/web — server-only, cached, FAILS OPEN
import { setFlag } from "@/lib/actions/flags";       // apps/docs
```

Seed: `cd packages/db && bun run flags:seed` — idempotent, and `update` deliberately never
names `enabled`.

### Files created

- `packages/shared/src/flags.ts` — the registry: 9 keys, labels, defaults, `flagValue` (fail-open)
- `packages/db/scripts/seed-flags.ts` — additive seed, **separate from the destructive `seed.ts`**
- `apps/web/app/lib/flags.ts` — `getFlags()`, `cache(unstable_cache(...))`, tag `flags`, 24h backstop
- `apps/docs/app/lib/actions/flags.ts` — `setFlag()`
- `apps/docs/app/(dashboard)/flags/{page,parts}.tsx` — the board
- `packages/db/prisma/migrations/20260821140000_add_feature_flags/migration.sql`

### Files modified

Public: `page.tsx`, `layout.tsx`, `Navbar.tsx`, `Hero.tsx`, `Contact.tsx`,
`contact/SentenceForm.tsx`, `blog/[slug]/page.tsx`, `blog/[slug]/not-found.tsx`,
`api/contact/route.ts`, `api/track/utm/route.ts`, `package.json` (+`server-only`).
Admin: `nav.ts`, `control-room.css`, `components/ui/switch.tsx` (+`ariaLabel`),
`site-config/{page,form,chrome-preview}.tsx`, `terminal/page.tsx`.

### Schema changes

- `FeatureFlag`: `key` (PK), `label`, `description`, `enabled`, `note`, `updatedById`, timestamps
- Migration: `add_feature_flags`

### Idempotency audit

- `seedFlags()` — **Pattern B**, upsert on the `key` primary key. **Verified by experiment:** set
  `section.blogs` to off, re-ran the seed, confirmed it stayed off (`0 created, 9 refreshed`).
- `setFlag()` — **Pattern A**, `updateMany({ where: { key } })`. Never `upsert`, never `create`:
  the key arrives from a client component, and creating rows from client input lets unknown keys
  pile up. `count === 0` is an error, not a silent create.

### 🚨 Every one of the nine flags is wired to something real

The first pass shipped `contact.form`, `analytics.enabled` and `easter-eggs.enabled` as
switches with **zero consumers**, while the admin UI reported them live. A `contact.form`
kill switch that does not stop submissions is worse than no kill switch — you flip it during
a flood, get a green tick, and the flood continues. All three are now wired, and each was
**verified at runtime, not by reading**:

| Flag | Off → observed |
|---|---|
| `contact.form` | `POST /api/contact` → **503**; `ContactMessage` count **7 → 7**; section still renders, form replaced by a paused note pointing at the email address |
| `analytics.enabled` | `POST /api/track/utm` → `{ skipped: true }` **200**; `UtmTracker` **1453 → 1453**; the three analytics mounts absent from the payload |
| `easter-eggs.enabled` | oneko cat's props gone from the flight payload |
| all on | `/` **byte-identical** to a `HEAD` build — 276084 = 276084, zero diff |

The endpoint is the enforcement and the UI is a courtesy — a bot posts straight at the URL,
and an ISR-cached page can still show the form for a moment after the flip.

### Complete anchor audit — the failure mode of this phase

Every reference to a gated section, gated:

| Where | Gate |
|---|---|
| `Navbar.tsx` `allNavItems` | one filtered array feeding **both** desktop `NavItems` and `MobileNavMenu` — they cannot disagree |
| `Hero.tsx` — `#contact` CTA in **both** hero bodies (v1 and v2 are separate code paths) | `SECTION_CONTACT` |
| `Hero.tsx` — `#skills` "+N more" chip | `SECTION_SKILLS` |
| `Hero.tsx` — `#about` scroll cue | `SECTION_ABOUT` |
| `blog/[slug]/page.tsx` — `/#blogs` back-link | `SECTION_BLOGS` |
| `blog/[slug]/not-found.tsx` — `/#blogs` back-link | `SECTION_BLOGS` **and** `blogs.length > 0` |
| `site-config/chrome-preview.tsx` — the admin's navbar preview | the same rule the real navbar uses |
| `terminal/page.tsx` — the terminal reference | per-command, with the reason named |

**`not-found.tsx` needed both halves**, not just the flag: the homepage renders the section on
`flag && blogs.length > 0`, and with every post unpublished — the live state today — `#blogs`
does not exist even with the flag on. The one page whose job is recovery would have pointed at
a fragment that is not there.

**`About.tsx` was left alone deliberately.** Its terminal already filters commands by
`document.querySelector(c.target)`, so a section that does not render drops out of `help`, `ls`
and Tab-completion by itself. Verified by reading it, and confirmed in the rendered output.

**No section `id` was renamed or wrapped.** `globals.css` binds `#skills`/`#experience`/
`#projects`/`#blogs`/`#contact` to `content-visibility: auto` with hundreds of descendant rules,
and `packages/ui/src/terminal.ts` targets the same ids. Gating means not rendering, never renaming.

### Deviations and corrections

| Doc / first pass | What shipped |
|---|---|
| Maintenance mode, Edge Config, middleware | **Excluded** — user's call |
| `getFlags` with `revalidate: 3600` | **86400.** Measured: 3600 pulled `/` from `1d` to `1h` in the route table, because Next takes the minimum lifetime across a render. It would have re-run the homepage's ~10 queries and the GitHub poll 24× a day for nothing. |
| `getFlags` bare `unstable_cache` | Wrapped in React `cache()` too — the layout and the page both read it, so a cold render raced two `findMany` queries. Same pairing `getSiteConfig` uses. |
| `import "server-only"` "just works" | `server-only` was **not a dependency of `apps/web`** — it resolves from `packages/*` but not there, and `tsc` does not catch an unresolved side-effect import. Added it. |
| `easter-eggs.enabled` covers "the cat, the About terminal, and other hidden interactions" | **Narrowed to the cat.** The About terminal renders the About bio itself — gating it would delete the section's only content, not hide an egg. `section.about` already covers that. |
| "live in a few seconds" / "within seconds" | **"from the next visit onward".** `revalidateTag(tag, "max")` is stale-while-revalidate: the request that triggers the flush is still served the old entry. Measured — `400 503 503 503…` after a flip, not `503` immediately. |
| `"Unknown flag."` for a key with no row | Its own message naming the actual remedy (`flags:seed`) — the page already tells the admin the key is right and the row is missing. |

### Verification

- [x] `prisma validate` · `prisma generate` · `tsc --noEmit` (0 errors) · `lint` · `build` (both apps)
- [x] Route table unchanged: `/` `○` **1d**, `/blog/[slug]` `●`, `/sitemap.xml` `○` **1d**
- [x] Fail-open proven three ways: thrown query, empty table, **and a deleted row** — deleting
      `section.projects` left the section and its nav link rendering
- [x] Seed cannot re-enable a disabled flag (run twice, checked)
- [x] Flags-on build byte-identical to `HEAD`
- [x] Each of the three system flags changes real behaviour (table above)
- [x] End-to-end admin loop with no rebuild: flip → flush `flags` tag → behaviour changes in the
      same running process

### Env vars added

None.

### Blockers for the next phase

None. Phase 06 will add `/api/collect`, which must read `FLAG_KEYS.ANALYTICS` the same way
`/api/track/utm` now does.

---

## Phase 04 — draft / scheduled / published + preview

### Migration, three steps, all applied to production

| Step | Migration | What |
|---|---|---|
| 1 | `add_content_status_nullable` | `ContentStatus` enum; `status`/`publishAt` nullable on both; `publishedAt` + `updatedAt` on Project |
| 2 | `backfill_content_status` | filled from the old boolean, guarded on `status IS NULL` so a re-run cannot re-classify |
| 3 | `require_content_status` | `SET NOT NULL`, `DEFAULT 'DRAFT'` |

Recorded before, verified after:

```
Blog     10 rows — show=true: 0, show=false: 10   ->  10 DRAFT,  0 PUBLISHED
Project   6 rows — no visibility column at all    ->   6 PUBLISHED
NULL statuses after backfill: 0 / 0
Blog PUBLISHED == old show=true count: 0 == 0
```

**`show` was NOT dropped.** It stays as the rollback path; nothing reads it. The only
surviving `show: true` in `apps/web` is `getSkills()` on the **Skill** model — a different
table. Drop `Blog.show` after a week of stable production.

**`DEFAULT 'DRAFT'` is the safety property.** The boolean it replaces defaulted to *visible*;
a row inserted by a seed or a future migration that does not know about this column is now
invisible until someone says otherwise.

### 🚨 Draft-leak test — run by hand against a production build

Two of the three review agents stalled, including the draft-leak reviewer, so this was run
directly rather than trusted. Live data: 10 DRAFT blogs, 6 PUBLISHED projects.

```
homepage — draft blog titles present      : 0   (of 10 checked)
homepage — published projects present     : 6/6   (no regression)
/blog/turborepo-monorepo                  : 404
/blog/websocket-scaling                   : 404
/blog/jwt-auth-patterns                   : 404
/api/blogs/turborepo-monorepo             : 404  {"error":"Blog not found"}   no body leaked
/sitemap.xml — /blog/ entries             : 0
/blog/<draft>/opengraph-image             : 200, PNG contains the draft title 0 times
/api/preview  no token                    : 400
/api/preview  bogus token                 : 401
/blog/<draft> with a FORGED __prerender_bypass cookie : 404
public homepage after all of the above    : still 0 draft titles
```

### Every public content query — the anti-leak checklist

| Query | `where` |
|---|---|
| `readProjects` | `contentWhere(isPreview)` — previously **no `where` at all** |
| `readBlogs` | `contentWhere(isPreview)` — previously `{ show: true }` |
| `readBlogBySlug` | `{ slug, ...contentWhere(isPreview) }` + explicit `select` — previously `findUnique({ slug })` and a **JS guard on the next line** that four public surfaces depended on |

| Surface | Visibility |
|---|---|
| `/` | honours draft mode — the only place a draft **project** is previewable |
| `/blog/[slug]` body + `generateMetadata` | honours draft mode |
| `generateStaticParams` | **never preview** — `draftMode()` throws at build time, and prerendering a draft would cache it for everyone |
| `sitemap.ts` | **never preview** — a sitemap asks crawlers to index what it lists |
| `api/blogs/[slug]` | **never preview** — unauthenticated JSON returning the whole body; honouring a cookie would make it a draft-exfiltration endpoint |
| `opengraph-image` | **never preview** — crawlers send no cookies; the image is cached and re-shared |
| `not-found.tsx` | **never preview** — reads `blogs.length` only |

**Preview reads are uncached, not differently-keyed.** The cached callbacks hard-code
`false` and take no visibility argument, so no preview value can structurally reach a cached
entry — there are no two keys whose non-collision needs proving.

### Deviations

| Doc | Reality |
|---|---|
| "add `publishedAt`" to Blog | **It already existed** as the editorial date the article prints. Kept its meaning; only `status`/`publishAt` are new. |
| Preview covers Blog and Project by slug | **Project has no slug and no detail page.** `PreviewClaims` is `{ type: "Blog"; slug } \| { type: "Home" }`; a draft project is previewed via the homepage. |
| — | `Project.updatedAt` added, so projects can finally join the stale detector from Phase 02. |
| — | `previewContentWhere()` originally used `as const`, producing a `readonly` tuple that is **not assignable** to Prisma's `in?: ContentStatus[]`. It failed to typecheck at every call site. Now annotated with the generated enum. |

### Idempotency audit

- `publishDueContent()` — **Pattern A.** `updateMany({ where: { id, status: "SCHEDULED", publishAt: { lte: now } } })`. The status guard *inside* the where is what makes concurrent callers safe: the first matches, the second matches zero rows. No fetch-then-update anywhere.
- `publishBlogNow` / `publishProjectNow` / `setBlogStatus` / `setProjectStatus` — **Pattern A**, conditional `updateMany`.
- The backfill migration — guarded on `status IS NULL`, so re-running cannot drag an ARCHIVED row back.

### Verification

- [x] `prisma validate` · `prisma generate` · `tsc --noEmit` (0 errors) · `lint` · `build` (both apps)
- [x] Route table: `/` `○` **1d**, `/blog/[slug]` `●`, `/sitemap.xml` `○` **1d**; `/api/preview` and `/api/preview/exit` registered `ƒ`
- [x] Draft-leak test above, all ten checks
- [x] Migration counts match the recorded baseline exactly
- [x] No cron job, no `vercel.json`
- [x] `PREVIEW_SECRET` is unset in this environment and the app still boots, builds and degrades cleanly

### Not yet verified (needs a browser or a configured secret)

- The admin editor by eye — status selector, IST datetime picker, filter tabs, overdue warning
- A real preview round trip end to end (needs `PREVIEW_SECRET` generated and set in **both** apps)
- Scheduled publishing on a real timer

### Env vars added

- `PREVIEW_SECRET` — optional, `min(32)`, signs Draft Mode preview links. **Must differ from `JWT_SECRET`.**
  Generate with `openssl rand -hex 32`. Unset today, so preview is off in both directions.

### Blockers for the next phase

None. Phase 06 must add `/api/collect` and call `maybePublishDue()` from its `after()` block,
replacing the admin-load trigger as the primary path.
