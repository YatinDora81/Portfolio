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
- [ ] 03 feature flags
- [ ] 04 content status
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
