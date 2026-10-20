# yatindora.in — v1 → v2 PRODUCTION CUTOVER RUNBOOK

**58 numbered steps. One operator. Live site. Read the whole STOP-THE-LINE block before Step 1.**

```
STAGE 0  PRE-FLIGHT        Steps  1 – 12
STAGE 1  EXPAND            Steps 13 – 23    (11 SQL files, additive only)
STAGE 2  VERIFY EXPAND     Steps 24 – 27    (v1 must still be correct)
STAGE 3  DEPLOY            Steps 28 – 32    (git push, two Vercel builds)
STAGE 4  VERIFY DEPLOY     Steps 33 – 37b   (v2 must be correct; freeze ends at 37)
STAGE 5  CONTRACT          Steps 38 – 49    (11 SQL files, destructive)
STAGE 6  VERIFY CONTRACT   Steps 50 – 52
STAGE 7  POST-CUTOVER      Steps 53 – 58    (soak, then delete things)
```

A **lettered** step (`8b`, …) is one added after the first numbering, sitting between the two numbers
it is named for. It is not optional and it is not an appendix; run it in place.

**Admin freeze:** starts at Step 10, ends at Step 37. Budget **120 minutes**, hard stop at 180.
Step **37b** is deliberately the first thing you do *after* the freeze — it is the R2 upload and the
SMTP reply, the two writes rule 2 below will not allow inside one.
A second, shorter freeze covers Steps 38 – 49 (~30 minutes).

**Public downtime target: zero.** Nothing in EXPAND or CONTRACT drops a column the *currently
deployed* code reads. All 22 SQL files carry their own `BEGIN;`/`COMMIT;` — **never** supply an outer
one — and every `ALTER` runs under `lock_timeout = '3s'` so a blocked statement fails instead of
queueing the site behind it. `SET LOCAL` is a silent no-op outside a transaction block, so that
promise and the per-file transaction are the same promise.

**All 22 files now set a lock timeout. Four of them did not.** `analytics-expand.sql`,
`analytics-contract.sql`, `contact-admin-audit-expand.sql` and `contact-admin-audit-contract.sql`
contained no `lock_timeout` and no `statement_timeout` at all, which made the paragraph above false
for them and made **S3** unreachable — with `lock_timeout` unset, Neon's default is `0`, *wait
forever*. All four now open each stage with a **plain `SET` pair before the `BEGIN`**, the form
`hero-expand.sql` and `hero-contract.sql` already used. The distinction is not style: `SET LOCAL`
placed before a `BEGIN` sets nothing and warns. **Six** files now use plain `SET` (the four above plus
the two `hero` files), **sixteen** use `SET LOCAL` inside their own transaction, and both forms are in
effect — what matters is that
**`WARNING: SET LOCAL can only be used in transaction blocks` must appear in no run log.** If it
does, that file lost its lock timeout; stop and find out why before the next `ALTER`.

**Point of no clean return: Step 43.** Before Step 43 every undo is a SQL statement. From Step 43
the only undo for `HeroSkillBadge.iconKey` is the JSON dump from Step 7 — via
`v2-production/recover-from-dump.jq`, which **Step 8b** exists to rehearse. "The dump is the floor"
is only true if you have run Step 8b.

---

## STOP-THE-LINE

Abort the moment you see any of these. Abort means: **stop where you are, do not run the next
step, run the rollback named in the step you are on, then read the ROLLBACK block at the bottom of
the SQL file you were running.** Do not improvise forward.

| # | Symptom | What it means | First move |
|---|---|---|---|
| S1 | `https://www.yatindora.in/` returns **500** at any point | The deployed code and the schema disagree. This is the one failure the whole plan exists to prevent. | If before Step 30: roll back the SQL file you just ran. If after Step 30: Vercel instant-rollback to the previous deployment, then stop. |
| S2 | A `psql` run reports **42P01 undefined_table** or **42703 undefined_column** | A CONTRACT statement ran before its DEPLOY, or you ran a contract file out of order. | Stop. Re-read which stage you are in. Restore the dropped object from the step's undo line. |
| S3 | An `ALTER` reports **55P03 lock_not_available** | Something was holding the table. Nothing was applied — the transaction rolled back. | Safe. Wait 30 seconds and re-run the same file. It is written to be re-runnable. Do **not** raise `lock_timeout`. |
| S4 | A `DO $$` block **RAISE EXCEPTION**s | A guard caught a value the plan did not predict. Nothing was applied. | Read the message — it names the rows. Fix the data, do not relax the guard. |
| S5 | **22P02 invalid input value for enum** | A value outside an enum's label set exists. | Stop. Find the row. Do not coerce it. |
| S6 | **23502 not_null_violation** during an admin save | A `NOT NULL` column lost its default too early. | Restore the default: `ALTER TABLE x ALTER COLUMN c SET DEFAULT ...`. This is always a CONTRACT statement that leaked into EXPAND. |
| S7 | A Vercel build **fails** after EXPAND has run | You are stuck mid-window with no deadline. Three distinct causes, in descending likelihood: **(a) env** — `Invalid environment variables` from `packages/config/src/env.ts:39-43`, i.e. a missing `DATABASE_URL` or a `REVALIDATE_SECRET` under 32 chars in *that* environment (Step 6); **(b) schema** — a `42703`/`42P01` from the prerender, because `next build` reads the database (Step 4, gate 2); **(c) code**. | Do not push again blindly. Read which of (a)/(b)/(c) it is before doing anything. Fix the build locally (Step 5 exists to prevent this). EXPAND is safe to sit on indefinitely — v1 runs correctly against it. |
| S8 | Only **one** of the two Vercel projects went Ready | Half-deployed is the one state CONTRACT cannot survive. | Do not run any contract file. Fix or roll back the failed project first. |
| S9 | The Vercel build log shows **`prisma db push`** or **`prisma migrate deploy`** | The deploy is mutating the schema behind your back. It will silently drop the CHECK constraints and may drop columns while v1 lambdas drain. | **Stop before Step 13.** Fix the dashboard command. This is Step 3. |
| S10 | Vercel `DATABASE_URL` points at the wrong database in **any** environment | **Production → child branch:** the live site serves from a throwaway clone, *and* the build bakes its HTML from it. **Preview → production:** the branch push at Step 30 stands up a live v2 admin against production before the production deploy. | Stop. Repoint it. This is Step 6, which reads all three environments for both projects. |
| S11 | An admin save you did not make appears in the audit log during the freeze | Someone is editing. Window writes are the primary silent-corruption vector. | Stop, find out who, restart the affected cluster's EXPAND (they are all re-runnable). |
| S12 | `bun run db:verify` reports drift you cannot name | You do not know what state the database is in. | Stop. Diff against `packages/db/v2-migration-draft/target-ddl.sql` by hand before doing anything else. |

**Two rules that override everything:**

1. **EXPAND is always safe to leave in place.** v1 runs correctly against the expanded schema. If
   anything goes wrong between Step 13 and Step 32, the correct move is almost always *stop and do
   nothing*, not *roll back*.
2. **R2 and SMTP do not roll back.** An upload puts bytes in the bucket before the row is written
   (`HEAD:apps/docs/app/lib/actions/media.ts:237`), and a reply mails the visitor before the
   `MessageReply` insert (`HEAD:apps/docs/app/lib/actions/messages.ts:158` then `:162`). A database
   rollback leaves an orphaned object in R2 and an email already delivered. **Do not upload media
   and do not send a reply during either freeze.**

---

# STAGE 0 — PRE-FLIGHT

## Step 1 — Establish that you can write to production at all, and how

**What it does.** Settles the single most confusing thing about this cutover before you are under
pressure: **the repo's own tooling refuses to touch production.**

`packages/db/scripts/apply-sql.ts:31-38` and `scripts/restore.ts:32-39` both build a
`protectedHosts` list from `PROD_DATABASE_URL` and exit 1 if the target resolves to it:

```
refusing: PROD_DATABASE_URL resolves to <host>, which PROD_DATABASE_URL protects
```

So `bun run db:apply-sql --to=PROD_DATABASE_URL` **cannot** run any file in this runbook. Every
EXPAND and CONTRACT file is applied with `psql`.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
grep -n 'PROD_DATABASE_URL' .env | sed 's/=.*/=<redacted>/'      # confirm the var exists
export PGPROD="$(grep '^PROD_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"'")"
# Neon: use the DIRECT endpoint, NOT the -pooler host. Long ACCESS EXCLUSIVE
# transactions and session-level SET do not behave through the pooler.
echo "$PGPROD" | sed -E 's#//[^@]*@#//<user>:<pw>@#'
psql "$PGPROD" -v ON_ERROR_STOP=1 -c "select current_database(), current_user, version();"
mkdir -p /tmp/v2/prod/log
```

**Expected output.** The database name and role your production Neon branch uses, and
`PostgreSQL 17.x`. The host in the echoed URL must **not** contain `-pooler`.

**Gate.** `psql` connects, and the host is the direct endpoint. If it is `-pooler`, get the direct
connection string from the Neon console and use that for every SQL step in this runbook.

**Undo.** Nothing was written.

---

## Step 2 — Confirm which branch deploys, and that the working tree is the v2 you mean

**What it does.** Vercel deploys from git. There is no `vercel.json`, so the branch → project
mapping lives only in the Vercel dashboard. You are about to push 79 uncommitted files.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
git branch --show-current
git rev-parse --short HEAD
git status --porcelain | wc -l
git stash list
cd packages/db && bunx prisma validate
```

**Expected output.** `main`; `0050cc9`; roughly `79`; an empty stash list; `The schema at
prisma/schema.prisma is valid 🚀`.

**Gate.** All four:
- The branch is the one the Vercel dashboard has set as **Production Branch** for *both* projects
  (`web` and `docs`). Open both dashboards and read it. Do not assume.
- `HEAD` is `0050cc9`. Every "v1 does X" claim in every SQL file was checked against that commit
  with `git show HEAD:<path>`. If `HEAD` has moved, the claims are stale — re-check before
  proceeding.
- `prisma validate` passes.
- Nothing is stashed that belongs in this change.

**Undo.** Nothing was written.

---

## Step 3 — Read the Vercel build and install command. This is a STOP-THE-LINE gate.

**What it does.** Production deploys work today, but a clean clone **cannot build**: the generated
Prisma client is gitignored (`.gitignore:34` → `**/generated/prisma`, and `git ls-files | grep -c
generated/prisma` returns **0**), `db:generate` is in no turbo task, `packages/db` has no `build`
script, and there is no `vercel.json`, no `postinstall` and no `prebuild`. Therefore the Vercel
project must be carrying an install or build command set in its dashboard that is invisible to this
repo. **You must read it before you change the schema.**

**Command.** Not SQL. In the Vercel dashboard, for **both** projects:
Settings → Build & Development Settings → read and copy into your run log:
- Install Command
- Build Command
- Root Directory
- Node version

**Expected output.** Something that runs `prisma generate` and then `next build`, scoped to the app.

**Gate — this is S9.** If either command contains **`prisma db push`** or **`prisma migrate
deploy`**, **stop and do not run Step 13.**
- `db push` against the v2 schema would try to drop `Blog.show`, `Skill.show`, `Project.images` and
  the two implicit join tables *at deploy time*, while v1 lambdas are still draining. Non-interactively
  it either fails the build or, with `--accept-data-loss`, destroys them.
- `db push` also silently **removes every CHECK constraint** — Prisma cannot express a CHECK
  (`schema-v2.md:819`) — and it **drops `Skill_name_lower_key`**, the functional unique index that is
  the only thing enforcing case-insensitive skill identity.
- Either command must be changed to build-only before you touch production.

**Undo.** Nothing was written. Record the original command verbatim so you can restore it.

---

## Step 4 — Make the build self-sufficient. Four of the five edits are already committed.

**What it does.** Moves `prisma generate` into the turbo build graph so the deploy is reproducible
from git. Every one of the eleven clusters names this as a required step, because a failed build
after EXPAND leaves you mid-window with **no deadline** (S7).

**Status, verified against git.** Four of the five edits below are **already in `HEAD`**. Do not
re-make them. Verify them, then make edit 5, which is the only one outstanding.

| # | Edit | Where it landed | Verify with |
|---|---|---|---|
| 1 | `packages/db/package.json` → `"build": "prisma generate"` | `6493c8f` | `git log --oneline -S'"build": "prisma generate"' -- packages/db/package.json` |
| 2 | **New file** `packages/db/turbo.json` | `83743d2` | `git show 83743d2 --stat` |
| 3 | root `turbo.json` → `"^build"` in `tasks["check-types"].dependsOn` (`turbo.json:52-57`) | `83743d2` | same |
| 4 | root `package.json` → `"postinstall": "bun run --cwd packages/db db:generate"` | `83743d2` | same |
| 5 | `packages/db` gets a `check-types` task — **see below, still outstanding** | — | — |

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
git show 83743d2 --stat
cat packages/db/turbo.json
git log --oneline -S'"build": "prisma generate"' -- packages/db/package.json
```

Edit 2's committed `inputs` are `["prisma/schema.prisma", "prisma.config.ts"]` — the draft of this
runbook also listed `package.json`; its absence is harmless (a script rename would not bust the
cache, but a script rename does not change the generated client either). The package-level override
is **required**, for the reason the draft gave: the root `build` task declares
`outputs: [".next/**"]` (`turbo.json:41-45`), which is wrong for `packages/db` and would cache
nothing. Nothing else is needed: `apps/web/package.json` and `apps/docs/package.json` already
depend on the `db` workspace, and the root `build` task already has `dependsOn: ["^build"]`.

**Edit 5, the one that is still missing.** `packages/db` has **no `check-types` script**, so
`turbo run check-types` skips the package entirely — and Steps 5 and 29 both gate on
`bun run check-types` passing. That means `packages/db/seed.ts` (19 `deleteMany` calls, rewritten
for v2), `scripts/install-hero-v2.ts`, `scripts/seed-flags.ts` and the five newer
`packages/db/scripts/*.ts` are **never typechecked by anything**. Neither app imports them, so
`tsc --noEmit` in `apps/web`/`apps/docs` does not reach them. A `seed.ts` still naming `Blog.show`,
`Skill.show`, `Project.images` or `SiteConfig` would pass every gate in this runbook and only
explode the next time someone seeds. Two files:

1. **New file** `packages/db/tsconfig.check.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "rootDir": ".",
       "noEmit": true
     },
     "include": ["src", "scripts", "seed.ts", "prisma.config.ts"]
   }
   ```
2. `packages/db/package.json` — add to `scripts`:
   ```json
   "check-types": "tsc --noEmit -p tsconfig.check.json",
   ```

A separate tsconfig is **required**, not tidiness. The plain `"check-types": "tsc --noEmit"` that
every other package uses would run against `packages/db/tsconfig.json`, whose `include` is
`["src"]` — so it would typecheck the client wrapper and skip every file this edit exists to cover.
Widening `include` in `tsconfig.json` itself fails outright: `rootDir` there is `./src`, and
`tsc` answers with nine `TS6059: File ... is not under 'rootDir'` errors. The override sets
`rootDir: "."` and keeps `noEmit`, which is the only combination that compiles all three trees.

**Expected output.** `bun run build` generates the client before either `next build`.
`bunx turbo run check-types --filter=db` prints `db:check-types: $ tsc --noEmit -p
tsconfig.check.json` and exits 0. Verified on this tree: 3 tasks, 3 successful.

**Gate — two things, and the second is the one that gets missed.**

1. `prisma generate` **fails** with `PrismaConfigEnvError: Cannot resolve environment variable:
   DATABASE_URL` if `DATABASE_URL` is unset, because `packages/db/prisma.config.ts` resolves
   `env("DATABASE_URL")` at config load. It never opens a connection. So `DATABASE_URL` must be
   **present** in the Vercel *build* environment. It already is in `turbo.json` `globalEnv`
   (line 5), so Turbo passes it through.

2. **`next build` is not like `prisma generate`: it opens a real connection and issues real SQL.**
   This is stated nowhere else in this runbook and it governs Steps 5, 21, 29, 30, 31 and 33.
   - `apps/web` — `apps/web/app/page.tsx:276` is `export const revalidate = 86400` with no
     `force-dynamic`, and `apps/web/app/layout.tsx` calls neither `cookies()` nor `headers()`, so
     `/` is **prerendered at build time**. That prerender runs `getAboutData()`, which does
     `prisma.education.findMany(...)`. `apps/web/app/sitemap.ts:8` and
     `apps/web/app/blog/[slug]/page.tsx:14` `generateStaticParams()` both call `getBlogs()`.
     Three database reads, in the build, against **whatever `DATABASE_URL` the build environment
     holds**.
   - `apps/docs` — every dashboard page is dynamic (`apps/docs/app/(dashboard)/layout.tsx:12`
     awaits `getSession()`, which reads `cookies()`), and the four non-dashboard pages
     (`/`, `/login`, `/forgot-password`, `/reset-password`) touch no table. So the docs build
     issues **no SQL** — but it still evaluates `@repo/config/env` (reached from
     `apps/docs/app/lib/revalidation.ts`), which throws at module load on a missing
     `DATABASE_URL` or a `REVALIDATE_SECRET` under 32 characters. A docs build therefore fails on
     bad env without ever proving the database is reachable.
   - Consequence to hold onto: a build is a **schema compatibility test against one specific
     database**. Step 21 edits the schema mid-EXPAND, which is what makes this dangerous —
     see Step 21 sub-steps **21.3** and **21.4**.

**Undo.** Edits 1–4 are committed history; leave them. For edit 5:
`git checkout -- packages/db/package.json && rm -f packages/db/tsconfig.check.json`.

---

## Step 5 — Prove a clean clone builds (this is what prevents S7)

**What it does.** Verifies Step 4 actually works, before EXPAND makes the window open-ended.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
rm -rf packages/db/src/generated
bun install
bun run check-types
bun run build
```

**Expected output.** `bun run build` recreates `packages/db/src/generated/prisma/**` and both
`apps/web` and `apps/docs` build. `check-types` is clean. The `apps/web` build log ends with a
`Generating static pages (N/N)` line and a route table marking `/` and `/blog/[slug]` as
prerendered.

**Gate.** All four:
- All three commands exit 0.
- The build log shows the `db#build` task running **before** `web#build` and `docs#build`. If
  `db#build` does not appear, edit 1 or 2 of Step 4 is wrong.
- The `check-types` run lists a **`db#check-types`** task. If it does not, **edit 5 of Step 4 is
  missing**, and `seed.ts` plus every script under `packages/db/scripts/` is going out
  untypechecked. This is the only gate in this runbook that catches Step 58 hazard 3 before it
  fires.
- `Generating static pages` appears and does not error. **This build just read the database** (Step
  4, gate 2) — specifically the one local `DATABASE_URL` points at, which is the Neon child branch,
  **not** production. So a green build here proves the v2 code matches *the branch's* schema. That
  is exactly the guarantee Step 21 breaks, and Step 29 is where you re-establish it.

**Undo.** `bun install` restores the generated client. Nothing in the database was touched.

---

## Step 6 — Confirm Vercel environment variables. All three environments, both projects.

**What it does.** Local `.env` files now point `DATABASE_URL` at the **Neon child branch**.
Vercel's own variables were not touched. Verify that, because a mistake here means the live site
serves from a throwaway clone (S10) or, worse, that EXPAND lands on the branch while production
goes untouched and you spend the night confused.

**Read Production, Preview AND Development. Not just Production.** Step 30 makes the entire cutover
conditional on **two green Preview builds** — so Preview env is load-bearing, and an unverified
Preview env has two failure modes, both bad:
- **Preview is missing `DATABASE_URL` or `REVALIDATE_SECRET`** → both preview builds throw at module
  load in `packages/config/src/env.ts:37-43`, Step 30's gate can never be satisfied, and you are
  parked mid-window with EXPAND applied and no deadline. That is **S7**, arrived at by a route S7
  does not mention.
- **Preview `DATABASE_URL` points at production** → the branch push at Step 30 stands up a live v2
  public site *and* a live v2 admin **against production**, before the production deploy. Step 10's
  freeze instruction ("Close EVERY admin tab in every browser and on every device") was written
  before that URL existed. See Step 30's gate.

Development matters less but is not free: `bun run dev` and `vercel dev` read it, and a Development
`DATABASE_URL` pointing at production is hazard 1 of Step 58 already armed.

**Command.** Not SQL. In both Vercel dashboards (`web` and `docs`), Settings → Environment
Variables, read every row below for **each** of Production / Preview / Development. Then compare
hosts to local:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
for v in DATABASE_URL PROD_DATABASE_URL SCRATCH_DATABASE_URL; do
  printf '%-18s %s\n' "$v" \
    "$(grep "^$v=" .env | cut -d= -f2- | tr -d '"'"'"'" | sed -E 's#^postgres(ql)?://[^@]*@##; s#/.*##')"
done
```

**The exact variables to read.** Group A is fatal at **module load**, which means it fails the
*build*, not a request. Group B is validated only if it is set, so a typo is fatal and an absence is
not. Group C is never validated, so a miss is silently wrong behaviour rather than an error.

| Group | Variable | Needed by | Rule | Source |
|---|---|---|---|---|
| **A** | `DATABASE_URL` | web + docs | non-empty, or the build throws | `packages/config/src/env.ts:10` |
| **A** | `REVALIDATE_SECRET` | web + docs | **≥ 32 characters**, or the build throws | `env.ts:13` |
| **A** | `JWT_SECRET` | **docs only** | non-empty; bare `throw` at module load | `apps/docs/app/lib/auth.ts:2`, `actions/auth.ts:13` |
| **A** | `PORTFOLIO_URL` | **docs only** | non-empty; bare `throw` at module load | `apps/docs/app/lib/revalidate.ts:1` |
| B | `NEXT_PUBLIC_SITE_URL` | web + docs | must parse as a URL if set; defaults to `https://www.yatindora.in` | `env.ts:14` |
| B | `PREVIEW_SECRET` | web + docs | ≥ 32 if set | `env.ts:21` |
| B | `CONTACT_FORM_HMAC_SECRET` | web | ≥ 32 if set | `env.ts:23` |
| B | `SMTP_EMAIL` / `SMTP_PASSWORD` | web + docs | `SMTP_EMAIL` must be an email if set | `env.ts:18-19` |
| B | `NOTIFY_EMAIL_TO` | web | must be an email if set | `env.ts:26` |
| B | `ADMIN_BASE_URL` | web | must be a URL if set | `env.ts:27` |
| B | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | web | non-empty if set | `env.ts:24-25` |
| B | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | docs (uploads) | `""` counts as unset, not invalid | `env.ts:29-32` |
| B | `CDN_BASE_URL` | docs | must be a URL if set; `""` is unset | `env.ts:34` |
| C | `NEXT_PUBLIC_CDN_URL` | web + docs | falls back to `https://cdn.yatindora.in` — a miss silently rewrites every media URL | `apps/web/app/lib/site.ts:14`, `apps/docs/app/lib/utils.ts:6` |
| C | `NEXT_PUBLIC_ENABLE_CLARITY`, `NEXT_PUBLIC_CLARITY_PROJECT_ID` | web | analytics script only | `apps/web/app/components/ClarityAnalytics.tsx:9-10` |
| C | `TRACKING_ENABLED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | docs | tracking silently disables itself when absent | `apps/docs/app/lib/supabase-tracking.ts:7-15` |
| C | `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` | docs | `/refer-emails` sheet sync | `apps/docs/app/lib/sheet.ts:97-100` |

**Expected output.** **Two** distinct local hosts, not three — verified on this tree:
`DATABASE_URL` and `SCRATCH_DATABASE_URL` are currently the *same* branch (`ep-aged-cake-a1ipqgrh`,
database `neondb`), and `PROD_DATABASE_URL` is the other one (`ep-withered-bird-a1tz5xe6`,
`neondb`). `apps/web/.env` and `apps/docs/.env` also point `DATABASE_URL` at
`ep-aged-cake-a1ipqgrh`. Three hosts is the state you reach **after** Step 9 repoints
`SCRATCH_DATABASE_URL` at a fresh branch cut from production; if you see three before Step 9, someone
already cut it.

`PROD_DATABASE_URL`'s host is the one that must match Vercel **Production**. Local `DATABASE_URL`
must **not** appear anywhere in Vercel Production.

Note what the shared branch is: **not** a production clone. It carries the **v2 canonical** schema —
43 tables, `Education.startYear integer NOT NULL`, `Education.endYear integer NULL`,
`Experience.startedOn date NOT NULL`, `Experience.logoAssetId` present, and no `startDate` /
`endDate` / `isCurrent` at all. That is why Step 9 insists on a **fresh** branch cut from production
for the rehearsal, and it is the fact Step 21 sub-step 21.3 turns on.

**Gate — five, and write the answers into the run log.**
- Vercel **Production** `DATABASE_URL` host **==** local `PROD_DATABASE_URL` host, in both projects.
- Vercel **Preview** has a non-empty `DATABASE_URL` and a `REVALIDATE_SECRET` of **at least 32
  characters**, in both projects, and `docs` Preview also has `JWT_SECRET` and `PORTFOLIO_URL`.
- **You have written down, verbatim, which database Preview points at** — production, the child
  branch, or a third thing. Step 30's gate reads this line back. If you cannot answer it, stop:
  you do not know what the push at Step 30 will do.
- Every Group A row is present in **Production** for the project that needs it. Group B rows are
  unchanged by this cutover; confirm that, because a typo here becomes a build failure at Step 31
  that looks nothing like an env problem.
- Export the secret you will need for the cache flushes:
  ```bash
  export REVALIDATE_SECRET='<the production value>'
  ```

**Undo.** Nothing was written. If you changed a Vercel variable, change it back — variable changes
take effect on the **next deployment**, not immediately, which is its own trap.

---

## Step 7 — Take the fresh production dump. This is the floor under everything.

**What it does.** The read-only JSON dump is the only undo for three things:
`HeroSkillBadge.iconKey` (Step 43), `FeatureFlag.label`/`description` for any key outside
`FLAG_DEFINITIONS` (Step 40), and `Blog.show`'s per-row values (Step 47). Step 56a adds a fourth,
`legacy_v1."SiteConfig"`.

**"The only undo" means a specific, rehearsed command, not a hope.** The path from this file back
into a single table is `v2-production/recover-from-dump.jq`, and **Step 8b** is where you prove you
can run it. `bun run db:restore` is *not* that path and cannot be made into it: it has no per-table
mode — `scripts/restore.ts:144-147` `TRUNCATE`s every dumped table present in the target and
`:150-216` reloads all of them — so using it to recover one column would destroy everything written
since this dump.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:dump --from=PROD_DATABASE_URL --out=backups/PRE-CUTOVER-$(date -u +%Y%m%dT%H%M%SZ).json
ls -lh backups/ | tail -3
```

**Expected output.** 43 tables, ~4803 rows (it will be slightly higher — the analytics and
revalidation tables move constantly). The dump opens a `begin transaction read only isolation level
repeatable read`, so it is a consistent snapshot and cannot write.

**Gate.** The file exists, is non-trivial in size, and `jq '.tables | length'` returns 43:

```bash
jq '.tables | length' backups/PRE-CUTOVER-*.json
jq '[.tables[].rows | length] | add' backups/PRE-CUTOVER-*.json
```

Also copy it somewhere off this machine. It is the floor under the whole night.

**Undo.** N/A — read-only.

---

## Step 8 — Prove the dump actually restores

**What it does.** An untested backup is not a backup. `db:restore` **refuses** to target
`PROD_DATABASE_URL` (`scripts/restore.ts:32-39`), so restore into a **throwaway** Neon branch.

**Command.** Create a fresh Neon branch from production in the console, put its URL in
`packages/db/.env` as `SCRATCH_DATABASE_URL`, then:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:restore --file=backups/PRE-CUTOVER-<stamp>.json --to=SCRATCH_DATABASE_URL          # dry run
bun run db:restore --file=backups/PRE-CUTOVER-<stamp>.json --to=SCRATCH_DATABASE_URL --apply=true
```

**Expected output.** The dry run prints source, target and per-table counts and says
`re-run with --apply=true`. The apply run truncates and reloads every table and reports the same
row counts as the dump.

**Gate.** Row counts after restore match the dump for all 43 tables. If `db:restore` prints
`refusing: ... which PROD_DATABASE_URL protects`, you pointed `SCRATCH_DATABASE_URL` at production —
fix it, do not work around the guard.

**What this step does NOT prove.** It proves the dump is complete and parseable. It does **not**
prove you can get one column of one table out of it and into **production**, which is the direction
Steps 40, 43, 47 and 56a actually need — and `db:restore` is structurally incapable of that
direction, for both of the reasons in Step 7. That is Step 8b. **Do not skip it.** The untested half
is the half you will need.

**Undo.** Delete the scratch Neon branch. Production was never a target.

---

## Step 8b — Rehearse the recovery you will actually need: one table, out of the dump

**What it does.** Three CONTRACT steps name this dump as their only undo (Step 40's off-registry
`FeatureFlag.label`/`description`, Step 43's `HeroSkillBadge.iconKey`, Step 47's per-row `Blog.show`),
and Step 56a adds `legacy_v1."SiteConfig"`. This step turns that claim into something you have done
once, at zero production risk, before the night starts.

`packages/db/v2-production/recover-from-dump.jq` reads the dump and **emits a `.sql` file** that
touches exactly one table and exactly the columns you name. It connects to nothing. The generated
file is an ordinary SQL file with its own `BEGIN;`/`COMMIT;`, a guard, and a verification `SELECT`,
so at recovery time it goes through the **same production-apply path as any `*-contract.sql`** (Stage
1, PASS 2). No new production write path is introduced by any of this, and no guard is bypassed.

**FIRST, check the shape of the branch you are about to rehearse against.** This is the one thing
that will waste your evening. The generator reads the **dump**, which is v1-shaped, but the apply
lands on a **branch**, and `db:restore` does not change a target's shape — `scripts/restore.ts` keeps
only the dump columns the target already has (`ignoring <cols>`) and leaves target-only columns at
their default. So restoring the PRE-CUTOVER dump into a branch that has already had EXPAND **and**
CONTRACT run against it (which is what the `SCRATCH_DATABASE_URL` branch is after Step 9) gives you v1
*data* in a v2 *shape* — and the `HeroSkillBadge.iconKey` rehearsal then dies on apply with
`42703 column "iconKey" of relation "HeroSkillBadge" does not exist`, which looks like the generator
is broken and is not.

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:dump --from=SCRATCH_DATABASE_URL --out=/tmp/v2/prod/8b-shape.json | tail -2
jq -r '[.tables[]|select(.name=="HeroSkillBadge")|.columns[].name]|join(" ")' /tmp/v2/prod/8b-shape.json
jq -r '[.tables[].name]|index("SiteConfig")' /tmp/v2/prod/8b-shape.json
```

- `iconKey` and `name` present, `SiteConfig` present (a number, not `null`) → **v1 shape**. Run
  part A, which is the real rehearsal of Steps 43 and 56a.
- Either one absent → **post-CONTRACT shape.** Either cut a fresh Neon branch from production, point
  `SCRATCH_DATABASE_URL` at it and re-run Step 8, or skip to part B, which proves the same mechanism on a
  column that exists in both shapes. **Do not skip both.**

**Part A — the real thing, on a v1-shaped branch.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
mkdir -p /tmp/v2/prod

# 1. Break the branch on purpose, the way Step 43 breaks production. No BEGIN/COMMIT
#    in this one: db:apply-sql supplies its own (scripts/apply-sql.ts:54-56).
printf '%s\n' 'UPDATE "HeroSkillBadge" SET "iconKey" = $$WRONG$$;' > /tmp/v2/prod/rehearsal-break.sql
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/rehearsal-break.sql --apply=true

# 2. Generate the recovery from the dump. This writes a file; it opens no connection.
jq -r -f v2-production/recover-from-dump.jq \
   --arg table HeroSkillBadge --arg key id --arg cols 'iconKey,name' --arg mode update \
   backups/PRE-CUTOVER-<stamp>.json > /tmp/v2/prod/rehearsal-badge-iconkey.sql

# 3. READ IT. This is the step that makes the rehearsal worth anything.
less /tmp/v2/prod/rehearsal-badge-iconkey.sql

# 4. Apply it to the branch.
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/rehearsal-badge-iconkey.sql
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/rehearsal-badge-iconkey.sql --apply=true

# 5. Rehearse the insert shape too — it is what Step 56a's undo needs, and it is a
#    different code path (INSERT ... ON CONFLICT DO NOTHING, all columns).
jq -r -f v2-production/recover-from-dump.jq \
   --arg table SiteConfig --arg key id --arg cols '*' --arg mode insert \
   backups/PRE-CUTOVER-<stamp>.json > /tmp/v2/prod/rehearsal-siteconfig.sql
less /tmp/v2/prod/rehearsal-siteconfig.sql
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/rehearsal-siteconfig.sql --apply=true
```

**Part B — shape-independent, works on any branch.** `HeroSkillBadge.label` exists in both v1 and v2,
so this exercises generate → break → recover → verify without needing a v1-shaped target. **This
exact sequence has been run against the `SCRATCH_DATABASE_URL` child branch and the restored labels came
back byte-identical to the dump**, so a clean pass is the expected result, not a lucky one.

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:dump --from=SCRATCH_DATABASE_URL --out=/tmp/v2/prod/8b-before.json | tail -2

jq -r -f v2-production/recover-from-dump.jq \
   --arg table HeroSkillBadge --arg key id --arg cols 'label' --arg mode update \
   /tmp/v2/prod/8b-before.json > /tmp/v2/prod/8b-recover.sql
less /tmp/v2/prod/8b-recover.sql

printf '%s\n' 'UPDATE "HeroSkillBadge" SET "label" = $$WRONG$$;' > /tmp/v2/prod/8b-break.sql
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/8b-break.sql --apply=true
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/8b-recover.sql --apply=true

bun run db:dump --from=SCRATCH_DATABASE_URL --out=/tmp/v2/prod/8b-after.json | tail -2
for f in before after; do
  jq -S '[.tables[]|select(.name=="HeroSkillBadge")|.rows[]|{id,label}]|sort_by(.id)' \
     /tmp/v2/prod/8b-$f.json > /tmp/v2/prod/8b-$f.cmp
done
diff /tmp/v2/prod/8b-before.cmp /tmp/v2/prod/8b-after.cmp && echo 'RECOVERED byte-identical'
```

**Part C — prove the guard fires, and that a failed recovery leaves nothing half-applied.** This is
the half you will care about most, because the row you are recovering may have been deleted. Forge a
dump with a row the target does not have, and watch the whole transaction abort:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
jq '(.tables[]|select(.name=="HeroSkillBadge").rows) += [{"id":"ghost-row","label":"GHOST"}]' \
   /tmp/v2/prod/8b-before.json > /tmp/v2/prod/8b-ghost.json
jq -r -f v2-production/recover-from-dump.jq \
   --arg table HeroSkillBadge --arg key id --arg cols 'label' --arg mode update \
   /tmp/v2/prod/8b-ghost.json > /tmp/v2/prod/8b-ghost.sql
bun run db:apply-sql --to=SCRATCH_DATABASE_URL --file=/tmp/v2/prod/8b-ghost.sql --apply=true; echo "exit=$?"
```

Expected: `P0001 recover aborted: HeroSkillBadge row(s) [ghost-row] in the dump no longer exist.
Decide what that means before restoring the rest.`, a non-zero exit, and the branch **unchanged** —
re-run part B's `diff` to confirm. Verified: it aborts and the labels are untouched.

Every recovery the runbook depends on, with its arguments and the dump it must come from.
`FeatureFlag`'s key column is `key`, not `id`, because that is its primary key. **The first four are
the ones that matter** — they are the steps whose undo has no other source.

| Step | table | `--arg key` | `--arg cols` | `--arg mode` | which dump |
|---|---|---|---|---|---|
| 40 | `FeatureFlag` | `key` | `label,description` | `update` | 38, or 7 |
| 43 | `HeroSkillBadge` | `id` | `iconKey,name` | `update` | 7 (pre-EXPAND) |
| 47 | `Blog` | `id` | `show` | `update` | **38** — a post published in the window exists only there |
| 56a | `SiteConfig` | `id` | `*` | `insert` | **38 or 7 only.** No post-cutover dump has this table: `dump.ts:31-33` reads `table_schema='public'` and C4 moved it to `legacy_v1` |
| 48 | `AnalyticsSession` | `id` | `lastSeenAt` | `update` | 38. Cosmetic, and the largest table here — check the row count first |
| 56b | `UtmTracker` | `id` | `*` | `insert` | 52, where it is named `UtmTracker__retired_v2`. Pass the name the dump actually holds |
| 56c | `Project` | `id` | `images` | `update` | any dump before Step 46 |

**Expected output.** The generator prints a header naming the dump's host, database and
`generatedAt`, the table and the row count; then `BEGIN;`, the two `SET LOCAL`s, one guard
`DO $recover$` block (update mode only), one statement per dumped row, two verification `SELECT`s
(the second leads with the key column, so rows are identifiable against the dump), `COMMIT;`. For
`HeroSkillBadge` that is one `UPDATE` per badge. `db:apply-sql`'s dry run prints the target and the
character count and changes nothing; the apply run prints `applied.`

**It refuses to generate rather than emit a wrong file**, exit 1 with a one-line reason, when: the
table is not in the dump; a named column is not in the dump; the key column is not in the dump; `mode`
is neither word; the table has **zero rows** in the dump (you picked the wrong dump, or the table is
under a post-rename name — see Step 48's `UtmTracker__retired_v2`); or `update` mode was handed
nothing but the key column to set, which would emit `UPDATE t SET  WHERE …` and fail `42601` halfway
through a recovery. Every one of those refusals happens on your laptop with nothing connected.

**A nested transaction, in this rehearsal only — and you will not be told about it.** `db:apply-sql`
wraps whatever you hand it in its own `begin`/`commit` (`scripts/apply-sql.ts:54-56`), so a file that
already carries its own produces `there is already a transaction in progress` on the inner `BEGIN;`
and `there is no transaction in progress` on the helper's trailing `commit`. Both are server
**notices**, and `apply-sql.ts` registers no `notice` listener, so **neither is printed** — the run
just looks clean. It is clean: the statements land atomically, because the generated file's `COMMIT;`
is its **last** statement, so the inner commit and the helper's commit close the same transaction with
nothing after it. Two consequences worth holding:
- Do **not** strip the `BEGIN;`/`COMMIT;` out of a generated file to make the nesting go away. It is
  what makes the file safe on the production path, where `apply-sql` is not involved.
- Do **not** append anything after the `COMMIT;` in a generated file. Anything past it runs in
  autocommit and is not covered by the rollback.

This nesting is a property of the branch-only helper, **not** of the production path: at recovery
time the generated file supplies the only transaction, exactly like every `*-contract.sql`.

**Gate.** Five. The **first four are mandatory**; the fifth is only reachable on a v1-shaped branch.
- The generated file has a `BEGIN;` and a `COMMIT;` and you have **read** it end to end. It is
  generated SQL aimed at production; treat it like every other file in this directory. (Above a few
  thousand rows that stops being possible — read the header, spot-check, and say so in the run log.)
- **Part B's `diff` is empty.** The recovery put every value back byte-for-byte, including `NULL`s and
  empty strings, which the two forms in the generated file (`NULL` vs `''::"text"`) distinguish.
- **Part C aborts with `P0001 recover aborted`, exits non-zero, and part B's `diff` is still empty
  afterwards.** This is the important one: it proves the guard catches a deleted row *and* that a
  failed recovery is atomic. A recovery that half-applies is worse than one that refuses.
- `SHOW standard_conforming_strings;` is `on`. The generator emits backslashes verbatim, which is
  only correct while it is. **Verified `on` on the Neon child branch**, and it is the PG17/Neon
  default that nothing in this cutover changes — but read it on **production** once, here, rather
  than during a recovery. While you are there, confirm the `::"udt"` casts the generator emits parse:
  `SELECT 1::"int4", now()::"timestamp", ARRAY['a']::"_text", '{}'::"_text", '{"x":1}'::"jsonb";`
  All five are verified good on Neon PG17; `information_schema.columns.udt_name` is the `pg_type`
  name, so the quoted form always resolves.
- Part A step 5's `INSERT` shows `ON CONFLICT DO NOTHING` semantics, i.e. re-running it is a no-op
  rather than 26 duplicate-key errors. Run it twice to see that.

**If the generator raises.** Read the message; it names exactly what it could not find. In `update`
mode the *generated* file also aborts if a key in the dump no longer exists in the target — that is a
row somebody deleted, and it is information, not an obstacle. **Do not delete the guard**, and do not
hand-edit the generated file: fix the arguments, or prune the dump, and regenerate.

**Undo.** N/A for production — nothing here touches it. The branch is disposable; if you mangle it,
re-run Step 8.

---

## Step 9 — Rehearse the ordered run on a fresh Neon branch. Do not skip this.

**What it does.** Converts the static reasoning in eleven SQL files into an observed result at zero
production risk. The hero cluster asks for this explicitly, because its safety argument rests on
how `@prisma/adapter-pg` serialises parameters (`addInt16(0)`, no parameter type OIDs) — analysis
that is correct but worth confirming empirically.

**Command.**

```bash
# Cut a NEW Neon branch from production in the console. Put its URL in
# packages/db/.env as SCRATCH_DATABASE_URL. Then, for the EXPAND files in the
# Step 13-23 order:
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
export PGREHEARSE="$(grep '^SCRATCH_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"'")"
for f in analytics contact-admin-audit media-flags-reval-github about-quotes-notes \
         blogs projects skills-joins hero-badges experience-education hero settings; do
  echo "=== $f ==="
  psql "$PGREHEARSE" -v ON_ERROR_STOP=1 -f "/tmp/v2/prod/$f-expand.sql" \
    2>&1 | tee "/tmp/v2/prod/log/rehearse-expand-$f.log" || break
done
```

Then, **with the v1 code** — `git stash && bun install && bun run db:generate` — point a local dev
server at `SCRATCH_DATABASE_URL` and load the public home page and the admin `/hero`, `/site-config`,
`/quotes`, `/projects`. Then `git stash pop`.

Then run the CONTRACT files in the Step 39–49 order against the same branch, with the v2 code.

**Expected output.** Every EXPAND file commits. The v1 site renders correctly against the expanded
schema. Every CONTRACT file commits. `bun run db:verify --from=SCRATCH_DATABASE_URL` comes back clean
except the two known-pending opclass indexes.

**Gate.** All of the above. Any `RAISE EXCEPTION` you see here you would have seen on production at
2 a.m. instead. Fix the cause, re-cut the branch, rehearse again.

**Before the first `-f`, prove the branch is a v1 clone.** `SCRATCH_DATABASE_URL` as shipped in
`packages/db/.env` is **not** a production clone — it is the same branch local `DATABASE_URL` uses
(`ep-aged-cake-a1ipqgrh`, `neondb`), and it already holds the **v2 canonical** schema: 43 tables,
`Education.startYear integer NOT NULL`, `Experience.startedOn date NOT NULL`, no `startDate` /
`endDate` / `isCurrent`. Rehearsing against it does not test anything this runbook does, and section
E of `experience-education-expand.sql` will fail `42883` because `public.v2_year_to_int` takes `text`
and would be handed an `integer`. **Repoint `SCRATCH_DATABASE_URL` at a genuinely fresh branch cut from
production first**, then confirm with the read-only probe (Step 21.3's form,
`TARGET=SCRATCH_DATABASE_URL`): `Education.startYear` must come back `text`, and `Experience` must still
have `startDate` / `endDate` / `isCurrent`. Every preflight in every file is written against that
shape.

**Undo.** Delete the rehearsal branch.

---

## Step 10 — Start the admin freeze

**What it does.** Opens the window. **From this moment until Step 37, no admin save.**

**Command.** Not SQL, and there is no software lock — this is discipline. There is a single admin,
who is also you.

```bash
# Confirm nobody (including a forgotten tab) is mid-edit. Staged ops live only
# in React state (apps/docs/app/components/staging/staging-provider.tsx:64,
# useState<StagedOp[]>([]), no localStorage), so a stale tab holds unsaved work
# that will silently target the wrong schema.
#
# 1. Close EVERY admin tab in every browser and on every device.
# 2. Confirm no recent activity:
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select "createdAt", "action", "surface", "actorRole"
from "AuditEvent" order by "createdAt" desc limit 10;'
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select "createdAt", "trigger", "entityType" from "RevalidationLog"
order by "createdAt" desc limit 10;'
# 3. Write the start time into the run log:
date -u +'FREEZE START %Y-%m-%dT%H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
```

**Expected output.** The most recent `AuditEvent` and `RevalidationLog` rows are older than a few
minutes.

**Gate.** No admin tab is open. If a new `AuditEvent` row appears during any later step, that is
**S11**.

**What happens if someone saves during the freeze.** Per cluster, precisely:

| Save | What actually happens | Mitigated by |
|---|---|---|
| Any setting (`/site-config`, `/background`, `/hero`, `/cat`, `/contact-purposes`, `/projects`) | Lands in `SiteConfig`, takes visible effect on the live v1 site (the same action calls `publishSite()`), then **silently reverts** at DEPLOY when v2 starts reading `SiteSettings`. Nothing logs an error. The admin form also shows the old value, so it reads as "my save got undone". | **Yes** — `settings-expand.sql` STEP B installs a statement-level `AFTER` trigger on `SiteConfig` that mirrors into `SiteSettings`. The Step 28 gate proves it kept up. |
| The **Résumé URL** on `/hero` | Same loss, and easiest to miss: `HEAD:apps/docs/app/lib/actions/links.ts:11-15` upserts `SiteConfig` key `resumeUrl` *outside* `updateSiteConfig` (it is absent from `ALLOWED_KEYS`). The Résumé button on the live site reverts to the old Drive link. | Yes, same trigger. |
| The **cat** nap style | Most deceptive: `HEAD:apps/docs/app/(dashboard)/cat/cat-console.tsx:86` has a live preview that looks right at save time, then snaps back to `moon`/`45` at DEPLOY. | Yes, same trigger. |
| A project gallery edit or a new project | Without the bridge, `ProjectImage` keeps the pre-EXPAND set → the public card renders the **old cover**, or **no cover at all** for a new project. Silently wrong content. | **Yes** — `projects-expand.sql` step 10's `AFTER INSERT` + `AFTER UPDATE OF "images"` triggers. |
| An experience or project **skill chip list** | Only `_ExperienceToSkill` / `_ProjectToSkill` is written → the deploy publishes the **old** chip list, or **no chips** on a new row. | **Yes** — `skills-joins-expand.sql` statements 12–13 (forward mirror). |
| A skill visibility toggle | Writes only `show` → the deploy reverts the toggle; a hidden skill reappears in the grid. | **Yes** — `skills-joins-expand.sql` statement 4 (bidirectional sync trigger). |
| A hero badge create / rename | A free-text badge name matching no `Skill` lands with `skillId` NULL → after DEPLOY the **public home page 500s** (v2 reads a required relation at `apps/web/app/lib/data.ts:117-121`). | **Partly** — the bridge trigger resolves by name; a name matching no Skill still lands NULL and Step 43's guard aborts and names the row. |
| A hero badge **icon** change | `iconKey` is silently discarded at Step 43. v2 has no per-badge icon. **Unfixable by any trigger** — the target column does not exist in v2. | **No.** Do not touch `/icons`. |
| Publishing or scheduling a **blog post** | Keeps the seed date `2026-03-08 07:24:25.xxx` permanently: `HEAD:apps/docs/app/lib/actions/publishing.ts:157-159` only ever pulls a *future* stamp back to now. It goes live printing `08 mar 2026`, and Step 47 correctly skips PUBLISHED rows. | **No.** Do not publish. |
| An **Education** edit | Surfaces nothing useful — `HEAD:apps/docs/app/lib/actions/staging.ts:260-266` flattens every non-`StagingError` into "Couldn't save your changes. Nothing was applied." The reason lives only in the Postgres log. | **No.** Do not stage Education edits. |
| Any hero / social-link edit | `updatedAt` is stamped with the migration clock and v1 never writes it, so the new audit column is **wrong from birth** for every row touched. Not recoverable afterwards. Cosmetic: no v2 consumer reads it. | **No**, and accepted. |
| Deleting a **Skill** | `HEAD:apps/docs/app/lib/actions/staging.ts:740-742` is a bare `deleteMany` with no badge count (the guard exists only in v2). Orphans a badge's `skillId` → **public home page 500s** after DEPLOY, and Step 43's FK fails too. | **No.** This is the single strongest reason not to touch `/skills`. |
| Deleting an **admin account** | A reply or upload by the now-ghost session fails with P2003 **after** its external side effect: the email is already sent, the bytes are already in R2. | **No.** Do not delete an admin. |
| A media **upload** or a **reply** | The R2 object / the sent email survives any database rollback. | **No.** Rule 2 of STOP-THE-LINE. |
| Running `bun run hero:v2` | `packages/db/scripts/install-hero-v2.ts:24-35` does `deleteMany({version:'v2'})` then `createMany` — destroying the `createdAt` and `label` EXPAND just backfilled. | **No.** Do not run it. |

**Undo.** `date -u` again and note the end time. The freeze costs nothing but your evening.

---

## Step 11 — Know that there is no cron, and what rides on visitor beacons instead

**What it does.** Stops you from waiting for something that will never fire, and from concluding
"nothing failed" when the truth is "nothing ran".

**Command.** Read, do not run:

- There is **no `vercel.json`**, therefore **no cron**. Three background jobs ride `after()` on the
  public collect beacon (`HEAD:apps/web/app/api/collect/route.ts:108-110`):
  scheduled publishing (`packages/db/src/publish-due.ts`), the analytics rollup
  (`packages/db/src/rollup.ts`) and retention (`packages/db/src/maintenance.ts`).
- The GitHub refresh rides the *home page's own ISR regeneration*:
  `HEAD:apps/web/app/page.tsx:120-134` POSTs `/api/github/refresh` inside `after()` whenever
  `!github || github.stale`. **An ISR regeneration is itself a write trigger**, not a shield.
- Consequence: on a low-traffic site, "the next rollup" can be **hours** away. Step 48 (analytics
  CONTRACT) requires at least one `RollupRun` row with `status = 'ok'` and a `createdAt` **after**
  the deploy. Plan for that wait; do not fake it.
- **A fourth trigger, and it is not an `after()`:** `/analytics` in the admin awaits
  `catchUpRollups()` **synchronously inside the render**
  (`apps/docs/app/(dashboard)/analytics/page.tsx:39`), which runs `rollupDay` for up to
  `MAX_DAYS_PER_REQUEST = 5` unsummarised past days and inserts `DailyStat` and `RollupRun` rows.
  So *you* are a scheduler: **opening one admin page is an analytics write.** This matters twice —
  it means `/analytics` is not a safe page to open idly during a freeze (Step 35 says so), and it
  means Step 48's prerequisite is reachable on demand rather than only by waiting (Step 37).
  It is also a `try/catch` that renders its error into the page, so a failure is visible rather than
  silent — the opposite of the beacon path.

**Gate.** You have accepted that Step 48 may need to happen the next day — or that you will force it
by opening `/analytics` after the freeze ends.

**Undo.** N/A.

---

## Step 12 — Understand ISR, and record the starting state

**What it does.** Settles the "does stale HTML help or hurt" question so you do not re-litigate it
mid-run.

**ISR, decided:**

- `HEAD:apps/web/app/page.tsx:276` is `export const revalidate = 86400`, and
  `HEAD:apps/web/app/lib/data.ts:8` sets `CACHE_LIFETIME_SECONDS = 86400` on the
  `unstable_cache` wrappers. Cache tags are `blogs`, `projects`, `site-config`, `flags`
  (`packages/shared/src/tags.ts`).
- **During EXPAND → DEPLOY, ISR neither helps nor hurts** — *precisely because EXPAND is additive*.
  A regeneration mid-window re-renders with v1 code against columns that all still exist and whose
  values did not change, producing byte-identical output.
- **ISR becomes a hazard only if CONTRACT runs early.** Then a regeneration on still-v1 code raises
  `42P01`/`42703` inside the **root layout** (`HEAD:apps/web/app/layout.tsx:69` →
  `HEAD:apps/web/app/lib/data.ts:70-72`) — which is *every route*, not one section.
- **Warm HTML will NOT hide a bad backfill after DEPLOY**, and that is what makes the Step 34 gate
  honest. `unstable_cache` keys on the callback source
  (`next/dist/server/web/spec-extension/unstable-cache.js:55` computes
  ``fixedKey = `${cb.toString()}-${keyParts.join(',')}` ``), and v2's `readSiteConfig` body differs
  from v1's, so v2 cannot reuse v1's persisted payload even though Vercel keeps the Data Cache
  across deployments. The first v2 render goes to the database.
- **An admin save flushes the cache itself.** `HEAD:apps/web/app/api/revalidate/route.ts:37-39`:
  a POST with an empty body calls `revalidatePath("/", "layout")` — the widest flush available —
  and an admin save triggers it. So you cannot rely on stale HTML to hide a window mistake.
- **Analytics is the one cluster where ISR only hurts.** `/api/collect` and `/api/track/utm` are
  uncached route handlers, so a schema change is felt by the *next beacon*, not the next
  revalidation. Stale HTML keeps the **v1 beacon alive in browsers after DEPLOY** — which is
  compatible (v2's `bodySchema` is a non-strict `z.object` with `.nullish()` on the new keys), and
  a stale page's `UtmTrackerBeacon` POSTs to a route v2 deleted and gets a 404 the client swallows.

**Command.**

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /dev/stdin <<'SQL' | tee /tmp/v2/prod/log/12-starting-state.log
select 'tables'      as k, count(*)::text from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'
union all select 'enums', count(distinct t.typname)::text
  from pg_type t join pg_namespace n on n.oid=t.typnamespace
  where t.typtype='e' and n.nspname='public'
union all select 'checks', count(*)::text from pg_constraint c
  join pg_namespace n on n.oid=c.connamespace where c.contype='c' and n.nspname='public'
union all select 'SiteConfig', count(*)::text from "SiteConfig"
union all select 'Quote', count(*)::text from "Quote"
union all select 'HeroSkillBadge', count(*)::text from "HeroSkillBadge"
union all select 'Blog', count(*)::text from "Blog"
union all select 'Project', count(*)::text from "Project"
union all select 'Skill', count(*)::text from "Skill"
union all select 'NoteNode', count(*)::text from "NoteNode"
union all select 'migrations', count(*)::text from "_prisma_migrations";
SQL
curl -s -o /dev/null -w 'home %{http_code} in %{time_total}s\n' https://www.yatindora.in/
```

**Expected output.** 43 tables; `SiteConfig` 26; `Quote` 28; `HeroSkillBadge` 14; `Blog` 10;
`Project` 6; `Skill` 47; `NoteNode` 881; 24 migrations. Home page 200.

**Gate.** The numbers match `packages/db/v2-migration-draft/data-facts.txt`. Where they do not
(analytics, revalidation), you now know the real number.

**Undo.** N/A.

---

# STAGE 1 — EXPAND

**The contract of this stage:** *every statement is additive, and the currently deployed v1 code
keeps working untouched.* If any file makes you doubt that, stop and re-read its
`expand_safe_because` block rather than pushing on.

**How to run every step in this stage — the same two-pass procedure each time:**

```bash
F=<cluster>                                    # e.g. analytics
# PASS 1 — read the preflight. Open psql interactively and paste the PART 0 /
# PREFLIGHT block from the top of the file. Compare each answer to the expected
# value the file prints next to it. Paste the answers into the run log.
psql "$PGPROD"
#   \i is NOT used here on purpose: you must READ these before any DDL.

# PASS 2 — apply. The in-file DO $$ guards are the real enforcement; they
# RAISE and roll back if a preflight answer was wrong.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f "/tmp/v2/prod/$F-expand.sql" \
  2>&1 | tee "/tmp/v2/prod/log/$F-expand.log"
echo "exit=$?"
```

**Every one of the 22 files carries its own `BEGIN;` / `COMMIT;`. Never supply an outer transaction**
— no `psql --single-transaction`, no hand-typed `BEGIN;` before an `\i`. Two reasons, and they apply
to Stage 5 as well as Stage 1:

- **Six files open more than one transaction** and need each boundary honoured:
  `analytics-expand.sql` (STAGE 1 as one transaction, STAGE 2's `VALIDATE`s outside one, STAGE 3's
  `CREATE INDEX CONCURRENTLY` which **cannot** be inside one, and a `BEGIN … ROLLBACK` probe at V6),
  `contact-admin-audit-expand.sql` (T1, T2), `hero-expand.sql`, `settings-expand.sql` (STEP A,
  STEP B), `analytics-contract.sql` (three stages) and `settings-contract.sql` (C1, then C2–C4).
- **An outer `BEGIN` does not add safety, it removes signal.** The inner `BEGIN` becomes a
  `WARNING: there is already a transaction in progress`, the inner `COMMIT` commits *your* outer
  transaction, and the trailing outer `COMMIT` warns that there is no transaction in progress. The
  statements still land atomically, but the log no longer tells you where the boundaries were.

`SET LOCAL lock_timeout`/`statement_timeout` at the head of every file depends on this: outside a
transaction block `SET LOCAL` is a **silent no-op** that emits only
`WARNING: SET LOCAL can only be used in transaction blocks`, which would make the header claim about
`lock_timeout = '3s'` false for that file. If a run's log shows that warning, **stop** — the file lost
its lock timeout, and you should find out why before the next `ALTER`.

> Historical note, since the old instruction may still be in your muscle memory: until this revision
> `media-flags-reval-github-expand.sql` and `-contract.sql` were the only two files *without* their
> own transaction, and their headers told the operator to supply one while Stage 1 and Step 40
> invoked them with a plain `-f`. Both now carry their own. If you are looking at a copy in
> `/tmp/v2/prod/` that has no `BEGIN;` on the line after the header, re-copy it.

**Two clusters deliberately overlap.** `contact-admin-audit-expand.sql` and
`media-flags-reval-github-expand.sql` both add `FeatureFlag.updatedByName` and
`RevalidationLog.actorName`. Both use `ADD COLUMN IF NOT EXISTS`, so whichever runs second is a
no-op on the column and its backfill reports 0 rows. **That is expected, not a failure.** Run
contact-admin-audit first (Step 14) and media second (Step 15) — media's backfill uses
`IS DISTINCT FROM`, which also repairs a *stale* name, so it must be the one that runs last.

**CHECK constraints.** Prisma cannot model a CHECK (`schema-v2.md:819`), so `db push` never creates
one and the Neon child branch has **none** of them. They are listed per cluster in
`schema-v2.md:825-846`. In this plan they belong to **EXPAND**, with three exceptions, because
every one of them is either unreachable from v1 or already satisfied by every v1 writer:

| CHECK | Stage | Why |
|---|---|---|
| `SiteSettings` — `id = 1`, six terrain ranges, `catNapSeconds 3..300`, `heroDotColor` hex-or-empty, `heroPhotos` no blank element | **EXPAND**, Step 23 (A3) | Unreachable from v1: v1 never names `SiteSettings`. Added *before* the row so the backfill is validated by them. |
| `Blog`/`Project` — `status <> 'PUBLISHED' OR publishedAt IS NOT NULL`; `status <> 'SCHEDULED' OR publishAt IS NOT NULL` | **EXPAND**, Steps 17 & 18 | Traced against all five v1 writers; none can produce a violation, and adding them early converts the one genuinely dangerous v1 path (`updateBlog` sets status without stamping) into a loud failure instead of a post that `publicContentWhere` silently hides. |
| `Blog` — not both `coverAssetId` and `image` | **EXPAND**, Step 17 | `coverAssetId` is NULL on all ten rows and v1 never writes it. |
| `Project`/`Experience` — not both `logoAssetId` and `logoUrl` | **EXPAND**, Steps 18 & 21 | v1 has no `logoAssetId` writer at all, so the column is NULL on every row v1 can produce. |
| `ProjectImage` — exactly one of `assetId`/`externalUrl`; `ProjectHealth` — the three status/latency rules | **EXPAND**, Step 18 | New tables; v1 cannot name them. |
| `Education` — both years `1950..2200`, `endYear >= startYear` | **EXPAND**, Step 21 | The one that earns its keep: both inputs were free text with no min or max, so `endYear = '99999'` passes v1 today and renders. |
| `Experience` — `endedOn >= startedOn`, both dates on day 01 | **EXPAND**, Step 21 | On new columns the bidirectional trigger fills. The day-01 check doubles as a tripwire for the `@db.Date` timezone trap. |
| `Skill` — `CREATE UNIQUE INDEX ON "Skill" (lower("name"))` | **EXPAND**, Step 19 | The only v1 flow it changes is a bug: `HEAD:staging.ts:531` creates a skill with no duplicate pre-check. No duplicate exists today. |
| `MediaAsset` — `folder` equals the directory prefix of `key` | **EXPAND**, Step 15 | The expression is a literal transcription of `folderOfKey` in `packages/storage/src/media.ts`; all 14 v1 call sites already satisfy it. |
| `AnalyticsSession`/`TrackedLink` `channel`, `DailyStat.dimension`, `RollupRun.status`/`triggeredBy` | **EXPAND**, Step 13 — `NOT VALID` then a separate `VALIDATE` | `VALIDATE` takes only `SHARE UPDATE EXCLUSIVE`, so `/api/collect` keeps writing straight through it. The sets are taken from the *writer*, not the observed data. |
| `NoteNode` — `parentId <> id`, `depth >= 0`; `NoteAnswer` — `confidence 0..4` | **EXPAND**, Step 16 | Admin-only tables with zero public readers; `data-facts.txt:161-162` already proves zero violations. |
| `GithubYear` — `length(days) IN (365,366)`, `year 1950..2200` | **already exist** | Nothing to do. |
| `HeroContent_live_check` | **already exists, must SURVIVE** | Step 22 drops four `*_version_check` constraints and deliberately **not** this one. `hero-expand.sql` V3 asserts it is still present. |
| `HeroContent_version_check` | **dropped in EXPAND**, Step 22 | The fourth one, from migration `20260728140000`, not `20260728120000`. **This is the one that gets missed.** |
| `HeroSkillBadge` — `skillId NOT NULL`, its FK, `@@unique([version, skillId])` | **CONTRACT**, Step 43 | These *can* reject a v1 write. EXPAND's one job is that no v1 statement that worked before now fails. |
| `GithubYear_handle_fkey` | **CONTRACT**, Step 40 | If added in EXPAND and the github handle changed mid-window, the first refresh inserts a year row before the profile row (`HEAD:apps/web/app/lib/github.ts:146-153` before `:156-161`), fails 23503, aborts the transaction, is swallowed at `:164` — and retries forever on every ISR regeneration, with the GitHub tile never appearing. |
| The five `AdminUser` FKs (`ON DELETE SET NULL`) | **EXPAND**, Step 14 | All five columns are written from one expression, `session.userId`. No `'system'`/`'cron'` sentinel exists anywhere. Zero orphans today. |

---

## Step 13 — EXPAND: analytics

**What it does.** Three new `AnalyticsSession` columns (`rawContent`, `rawTerm`, `messageId`), five
value-set CHECKs added `NOT VALID` then validated, the `DailyStat` primary-key swap to
`(date, dimension, key)` **keeping the `id` column**, and the one statement that appears in none of
the 14 drafts: `ALTER TABLE "DailyStat" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text`.

**Why this one is first.** It is the only cluster that **cannot take the public site down** —
nothing on the public site *reads* these tables to render, so no revalidation can regenerate a page
against a mismatched schema. It also contains the one `CREATE INDEX CONCURRENTLY`, which wants a
quiet moment.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: paste the STAGE 0 preflight, read P2 and P4
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/analytics-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/13-analytics-expand.log
```

**Expected output.** STAGE 1 commits. STAGE 2's five `VALIDATE CONSTRAINT` statements each return
`ALTER TABLE`. STAGE 3's `CREATE INDEX CONCURRENTLY` returns `CREATE INDEX`.

**Gate.** Preflight **P2** is the only one `data-facts.txt` cannot pre-prove: it lists
`AnalyticsSession.channel` values but never `TrackedLink.channel`. Read it. **P4** is
load-bearing: it must show `DailyStat.id` is `TEXT NOT NULL` with **no** database default
(`@default(uuid())` is client-side only) — that is what the bridge `SET DEFAULT` fixes. Then:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select indexrelid::regclass as invalid_index from pg_index where not indisvalid;'
```
Must return **0 rows** — an interrupted `CREATE INDEX CONCURRENTLY` leaves an INVALID index that
must be dropped before any retry.

**Undo.** In one transaction: drop the five CHECKs by name; `DROP CONSTRAINT "DailyStat_pkey"` and
`ADD CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id")` — **exact**, because the id values were never
destroyed — then recreate `DailyStat_date_dimension_key_key` and `DailyStat_date_idx`; then
`ALTER TABLE "AnalyticsSession" DROP COLUMN "rawContent", DROP COLUMN "rawTerm", DROP COLUMN
"messageId"`. `COMMIT`, then `DROP INDEX CONCURRENTLY IF EXISTS
"AnalyticsSession_rawContent_startedAt_idx"` outside the transaction. **Leave the `DailyStat.id`
DEFAULT in place** — v1 overrides it, so it is harmless, and you want it on the retry.
Full text: ROLLBACK block of `analytics-expand.sql`.

---

## Step 14 — EXPAND: contact-admin-audit

**What it does.** `AdminUser.lockedUntil` + `otpAttempts` (with `DEFAULT 0`), three denormalised
name columns, five `AdminUser` FKs with `ON DELETE SET NULL` and their indexes, and the enum pass:
`AuditAction`, `AuditSurface`, `PublishState`, `AuditChangeKind` created whole, plus
`AuditEvent.actorRole` retyped to the **pre-existing** `AdminRole`.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: preflight P1-P9. P3 and P6 can change the plan.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/contact-admin-audit-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/14-contact-admin-audit-expand.log
```

**This step must run before Step 15, and now enforces it.** T1 adds `FeatureFlag.updatedByName` and
`RevalidationLog.actorName`, and so does Step 15 — the same two columns, `IF NOT EXISTS` in both.
Step 15's preflight **P7** aborts if this step's T1 has not committed, so the order is fail-closed
from that side. From this side the order is a note, not an abort, because if the order has already
slipped this file still *must* run (it owns the `AdminUser` columns, the five FKs and the enum pass)
and aborting it would strand you mid-window. What Step 14 gains from going first is its own preflight
**P1**, which asserts the three name columns *do not exist yet* — the only tripwire either file has
for EXPAND being replayed over a database that has already had it. Read P1 rather than skimming it.

**Expected output.** T1 commits, T2 commits. Section 0 of T1 reports one `ALTER TABLE` for
`ContactMessage.read`'s default, and `updatedByName`'s sweep may report `UPDATE 0` — both normal.

**Gate.** Two preflights decide the shape, and two verifications are hard stops:
- **P3** — the distinct stored values of the five columns about to become enums. Any value outside
  the label set is **S5**. Do not coerce it.
- **P6** — the label set of the pre-existing `"AdminRole"` type. **If a label is missing**, run T0
  first, in its **own transaction** (a label added by `ALTER TYPE` cannot be used by a `USING` cast
  in the same transaction). **T0 is NOT reversible** — Postgres has no `ALTER TYPE ... DROP VALUE`
  and `AdminUser.role` depends on the type. If P6 surprises you, prefer *leaving `actorRole` as
  text and writing the drift down* over widening a type irreversibly mid-cutover.
- **V9 must report `column_default = false` on `ContactMessage.read`.** This is the most consequential
  single line in the file's output and it used to be listed nowhere in this step. `read` stays
  `BOOLEAN NOT NULL` from Step 30 until Step 39, and Stage 5's preamble explicitly lets you sit there
  for a week — through which the **only** thing keeping the public contact form working is that
  database default, because v2's insert
  (`apps/web/app/api/contact/route.ts:175-187`) stops naming the column where v1's did
  (`0050cc9:apps/web/app/api/contact/route.ts:182` `read: verdict.isSpam`). If the default is missing,
  **every** public `POST /api/contact` returns HTTP 500 `{"error":"Failed to send message"}` for the
  whole gap: no log row, no retry, no record, and nothing visible in the admin.
  T1 section 0 now sets it unconditionally (`ALTER TABLE "ContactMessage" ALTER COLUMN "read" SET
  DEFAULT false;`), which is idempotent and the exact mirror of what Step 18 does for
  `Project.images` and Step 20 for `HeroSkillBadge.name`/`iconKey`. So a blank `column_default` here
  means **you are running a stale copy of the file** — re-copy it. Blank is a stop, not a note.
  The other three columns v2 stops writing that survive into CONTRACT were audited the same way and
  all three already have a default, so none needs a belt: `Blog.show` (`DEFAULT true`),
  `Skill.show` (`DEFAULT true`, and also filled by `skills-joins-expand.sql:257`'s BEFORE trigger),
  `AnalyticsSession.lastSeenAt` (`DEFAULT CURRENT_TIMESTAMP`).
- **V6 must return 0 rows from all six arms.** It compares each denormalised name against its
  `AdminUser` row. If a `mismatch` row appears on `MessageReply` or `RevalidationLog`, **do not repair
  it by hand** — those two columns are append-only and the stored value is the name as of the event.
  Such a row means EXPAND is being replayed over a database that already has it. Find out which
  before continuing. The `id without name` arms have no exception.
- **The log contains no `SET LOCAL can only be used in transaction blocks`,** and it contains two
  `SET` statements before each of T1 and T2. This file previously set no timeouts at all; if you see
  neither the `SET`s nor a warning, you are running the pre-revision copy and both transactions ran
  with `lock_timeout = 0`, i.e. willing to queue the public `FeatureFlag` read behind them forever.

**Then the smoke test, and do it now rather than later.** In the live admin, change one hero title,
press Save, open `/history`. One gesture exercises a v1 `INSERT` into all four retyped `AuditEvent`
columns plus `AuditChange.kind`, through the real deployed client. Its blast radius is one admin
gesture, never a public request.

> This is the one sanctioned exception to the freeze. Change the title **back** immediately, and
> note the `updatedAt` on that row is now the migration clock (accepted, see Step 10).

**Undo.** T2 first, then T1, each its own transaction, and none of it loses a row. T2: drop the
`publishState` default, cast all five columns back to `TEXT` with `USING <col>::text`, restore the
default, re-add the three CHECKs verbatim from migration `20260728150000_add_audit_log`, then drop
the four new types **last** (they refuse while a column references them — that is the safety net).
**Do not drop `"AdminRole"`** — it predates this cluster and still types `AdminUser.role`. T1: drop
the five FKs and five indexes, then the three name columns, then `otpAttempts`, then `lockedUntil`.
Full text: ROLLBACK block of `contact-admin-audit-expand.sql`.

---

## Step 15 — EXPAND: media-flags-reval-github

**What it does.** `MediaAsset_key_prefix_idx` and the `MediaAsset_folder_check`,
`FeatureFlag.updatedByName` + its `IS DISTINCT FROM` sweep, `FeatureFlag.label DROP NOT NULL`, the
`RevalidationScope` type, and `RevalidationLog.scope` + `.actorName` with their backfills.

**The two columns it shares with Step 14, and the one rule that governs them.** `updatedByName` and
`actorName` are created by *both* files, `IF NOT EXISTS` in both, so this file finds them already
there. The **predicates** are what must not diverge, and there is a single rule — stated canonically
in `contact-admin-audit-contract.sql`'s header, now honoured by all four files that touch these
columns:

| column | kind | guard | why |
|---|---|---|---|
| `FeatureFlag.updatedByName` | **mutable** — "who last changed it" | `IS DISTINCT FROM` | a v1 toggle moves `updatedById` without moving the name (`0050cc9:apps/docs/app/lib/actions/flags.ts:52`), so the copy goes stale and must be *repaired* |
| `RevalidationLog.actorName` | **append-only** ledger | `IS NULL` | v2 writes it at insert time (`apps/docs/app/lib/revalidation.ts:102`); re-deriving it from today's `AdminUser.name` rewrites history rather than repairing it |
| `MessageReply.sentByName` | **append-only** | `IS NULL` | same, and `apps/docs/app/lib/actions/messages.ts:169` falls back to `session.email`, a value no re-sync can reconstruct |

This revision changed `actorName`'s sweep here from `IS DISTINCT FROM` to `IS NULL`. During EXPAND
the two select **exactly the same rows** — v1 never writes the column — so the forward run is
unchanged; what changes is that a re-run can no longer restamp every past revalidation with the
current admin's name. V5 was corrected to match: `INNER JOIN` instead of `LEFT JOIN` (the old form
flagged a deleted actor's preserved name, i.e. the very rows these columns exist for), and the
`RevalidationLog` half now asks only "is a name missing".

**Order is enforced, not assumed.** Preflight **P7** aborts this file if Step 14's T1 has not
committed, detected by `FeatureFlag_updatedById_fkey` and `RevalidationLog_actorId_fkey` — the last
two objects T1 creates, so their presence proves T1 committed *in full*. P7 runs before any DDL, so a
fire leaves nothing applied. The one genuinely order-dependent hazard is the **rollback**: both files'
undo blocks drop these two columns, so undoing one cluster silently disarms the other. Both undos now
open with a fail-closed guard, and this file's ROLLBACK also carries a shared-column-safe variant.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the folder gate must return 0, and RUN THE
                                      # PREFLIGHT DUMP of FeatureFlag key/label/description --
                                      # it is the ONLY paper record of what Step 40 destroys.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/media-flags-reval-github-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/15-media-flags-reval-github-expand.log
```

**Expected output.** One `BEGIN`, then one `COMMIT` — the file carries its own transaction, like the
other 21. `FeatureFlag.updatedByName` and `RevalidationLog.actorName` report `ALTER TABLE` with no
change (Step 14 already added them) — **expected**. The `scope` backfill updates every existing row.

**Gate.** The folder preflight returns **0**. **P7 did not fire** — if it did, Step 14 has not
committed its T1 and you are out of order; run Step 14, then come back (nothing was applied, P7 runs
before any DDL). The `FeatureFlag` dump is in your run log. `scope` is `NULLABLE with no default` —
verify that, because a `NOT NULL` `scope` makes the v1 log INSERT fail 23502 inside a `catch` that
merely logs (`0050cc9:apps/docs/app/lib/revalidation.ts:109-110`), silently losing both the log row
**and** the `TagState` upsert loop that follows it — the cache-staleness detector's substrate. **V5
returns 0 rows from both arms**, and read which question each arm asks before you act on a row: the
`FeatureFlag` arm is an agreement check, the `RevalidationLog` arm is a missing-name check only.

**Note the row set is not frozen.** `HEAD:packages/db/src/maintenance.ts:163-177` batch-deletes
`RevalidationLog` rows older than 30 days, fired from a **visitor beacon**. So the preflight count
is an upper bound, not an invariant. Verify "no NULL scope", never "count equals N".

**Also confirm the log contains no `SET LOCAL can only be used in transaction blocks`.** If it does,
you are running a stale copy of the file from before it carried its own `BEGIN;` — the two `ALTER`s
on `FeatureFlag` then ran with **no** `lock_timeout`, and `FeatureFlag` is on the public render path
(`apps/web/app/lib/flags.ts:13` inside `apps/web/app/layout.tsx:70`). Re-copy the file and re-run;
everything in it is idempotent.

**Undo.** Two transactions, not one, because restoring `label`'s `NOT NULL` may need a step that is
not SQL:

- **First transaction:** `DROP COLUMN scope, actorName`; then `DROP TYPE IF EXISTS
  "RevalidationScope"` (must follow the drop); `DROP COLUMN updatedByName`; drop
  `MediaAsset_folder_check`; drop `MediaAsset_key_prefix_idx`.
  **`actorName` and `updatedByName` are not this cluster's alone.** Step 14 creates them too and v2
  requires them (`flags/page.tsx:43`, `revalidation/page.tsx:145` — P2022 without them), so this
  transaction now opens with a **fail-closed guard** that aborts if Step 14's cluster is still applied
  (detected by `AdminUser.otpAttempts`). If it fires: either undo Step 14's T1 as well, or use the
  **shared-column-safe variant** printed beside R1 in the file, which drops only `scope`,
  `RevalidationScope` and the two `MediaAsset` objects and leaves the two nullable, v1-unread columns
  in place. Deleting the guard is not a third option.
- **Then** `SELECT count(*) FROM "FeatureFlag" WHERE "label" IS NULL`. If it is **0** (the expected
  answer — no v1 writer can produce a NULL label), a second transaction does
  `ALTER COLUMN "label" SET NOT NULL` and you are done. If it is **non-zero**, the v2 seed ran in the
  gap: restore the text first (**R3** of this file's own ROLLBACK block — the `recover-from-dump.jq`
  route over the Step 7 dump, which also covers off-registry keys, or failing that the v1 seed **with**
  `DATABASE_URL="$PGPROD"`), then `UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL` as a
  mop-up, then `SET NOT NULL`.

Do **not** put `SET NOT NULL` in the first transaction: a single NULL label makes it raise `23502`
and roll back the whole undo — including the `DROP TYPE` and both `DROP COLUMN`s, which had nothing to
do with it. Nothing in this EXPAND destroys anything, so the **shape** comes back without a dump; the
dump appears only for a label the *v2 seed* overwrote after DEPLOY, which is a plain `UPDATE` of a
column this file never dropped. Full text: ROLLBACK block of the file.

---

## Step 16 — EXPAND: about-quotes-notes

**What it does.** Closes the gap the ten classified clusters left. `createdAt`/`updatedAt` on
`AboutParagraph`, `ContactPurpose` and `Quote`; **`Quote.sortOrder`** backfilled by `row_number()`
over the current id order; and the three notes CHECKs.

**Why this is not optional.** `apps/web/app/lib/data.ts:356` in the v2 working tree is
`prisma.quote.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })`. Production has no
`Quote.sortOrder`. **Without this step the v2 DEPLOY makes the public landing page throw 42703** on
the thought-of-the-day read, and `apps/docs/app/(dashboard)/quotes/page.tsx:21` fails the same way.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: PART 0, P0-P7. Keep P7's output -- it is the quote
                                      # order the live site is showing right now.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/about-quotes-notes-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/16-about-quotes-notes-expand.log
```

**Expected output.** One `COMMIT`, then the post-commit `SELECT` printing 28 quotes numbered 0–27
in the same order P7 showed.

**Gate.** **P0** must show all six no-DDL tables (`ProjectBullet`, `ReplyTemplate`, `LinkClick`,
`MaintenanceState`, `AnalyticsSalt`, `RateLimitBucket`) as `ok = t` — if any is `f`, there is an
*additional* uncovered cluster and you should stop. **P2** must return 0 rows (no `Quote.active`).
Then confirm the one piece of deliberate temporary drift landed:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select column_name, is_nullable, column_default from information_schema.columns
where table_schema=$$public$$ and table_name=$$Quote$$ order by ordinal_position;'
```
`sortOrder` must be `NO` / `0`. That `DEFAULT 0` is why a v1 quote create still works
(`HEAD:staging.ts:543-547` names no `sortOrder`, because `quote` is excluded from the
sortable-entity machinery at `HEAD:staging.ts:202`). Step 42 removes it.

**Undo.** Drop the three notes CHECKs, then `DROP COLUMN` `sortOrder`/`createdAt`/`updatedAt` from
`Quote` and `createdAt`/`updatedAt` from `ContactPurpose` and `AboutParagraph`. Lossless. **Do not
touch `Education` here** — its timestamps belong to Step 21. Full text: ROLLBACK block of
`about-quotes-notes-contract.sql`.

---

## Step 17 — EXPAND: blogs

**What it does.** `Blog.createdAt` backfilled from `publishedAt` (which *is* the creation stamp
today) with `SET DEFAULT` and `SET NOT NULL` **in one statement**; `publishedAt DROP NOT NULL`;
`image DROP NOT NULL`; `coverAssetId` + its FK and index; the four CHECKs; and the
`Blog_status_publishedAt_idx` swap to `DESC` **under the same name**.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: P1-P8. P6 (ZERO user triggers on Blog) and P8
                                      # (every publishedAt CONTRACT will discard) both matter.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/blogs-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/17-blogs-expand.log
```

**Expected output.** One `COMMIT`. `UPDATE 10` on the `createdAt` backfill, `UPDATE 0` on the
guard.

**Gate.** The load-bearing in-transaction assertion: `publishedAt IS NULL` must still be **0
rows**. EXPAND changes no data v1 can see. Also confirm the single-statement `SET DEFAULT` +
`SET NOT NULL` on `createdAt` really is one statement in the log — split, it opens a moment where a
v1 `createBlog` 23502s.

**Undo.** Roll the **code** back first if v2 is somehow already live (a v2 lambda can write
`image = NULL` while the SQL rollback runs, aborting `SET NOT NULL`). Then: drop the three CHECKs
and the FK, drop `Blog_coverAssetId_idx`, drop `coverAssetId`,
`UPDATE "Blog" SET "image" = '' WHERE "image" IS NULL`, `ALTER COLUMN "image" SET NOT NULL`,
`ALTER COLUMN "publishedAt" SET NOT NULL` (which succeeds with no repair, because the null-out lives
in CONTRACT — that is the whole point of the split), restore the ascending index, drop `createdAt`.
Full text: ROLLBACK block of `blogs-expand.sql`.

---

## Step 18 — EXPAND: projects

**What it does.** `Project.logoAssetId` + FK + index, `Project.createdAt` (NOT NULL **with**
`DEFAULT CURRENT_TIMESTAMP`), `images SET DEFAULT ARRAY[]::TEXT[]`, the three lifecycle/logo CHECKs,
the new `ProjectImage` table backfilled from the array by `LATERAL unnest ... WITH ORDINALITY`, the
empty `ProjectHealth` table and `LiveProbeStatus`, two dual-write triggers, and
`_v2_backup_project_images`.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the step-0 PREFLIGHT GATE
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/projects-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/18-projects-expand.log
```

**Expected output.** `UPDATE 0` on the `publishedAt` repair, `UPDATE 6` on the `createdAt` repair,
`DELETE 0` then `INSERT 0 6` on the `ProjectImage` rebuild (all six `externalUrl`, all `sortOrder`
0), `COMMIT`.

**Gate.** Both new tables' FKs must be `ON DELETE CASCADE`. That is not cosmetic: `RESTRICT` or
`NO ACTION` (Prisma's default for a required relation without `onDelete`, which is what you get if
you hand-write the FK and forget) would make v1's `deleteProject`
(`HEAD:apps/docs/app/lib/actions/projects.ts:110`) fail 23503 for the whole window. Verify:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select conname, confdeltype from pg_constraint
where conname in ($$ProjectImage_projectId_fkey$$,$$ProjectHealth_projectId_fkey$$);'
```
`confdeltype` must be `c` for both.

**Undo.** Before COMMIT: plain `ROLLBACK` — every statement is transactional, including
`CREATE TYPE`. After COMMIT, one transaction: drop both triggers and the function, `DROP TABLE
"ProjectHealth"`, `"ProjectImage"`, `DROP TYPE "LiveProbeStatus"`, drop the three CHECKs and the
FK, drop `Project_logoAssetId_idx`, `ALTER COLUMN "images" DROP DEFAULT`, drop `logoAssetId` and
`createdAt`, `DROP TABLE "_v2_backup_project_images"`. **Lossless for the gallery** — `images` was
never modified and the trigger only ever derives `ProjectImage` *from* it; the arrow never points
the other way.

---

## Step 19 — EXPAND: skills-joins

**What it does.** `Skill.showInGrid` (`NOT NULL DEFAULT true`) beside `show`, backfilled, with a
**bidirectional** `BEFORE ROW` sync trigger; `Skill_name_key` and the functional
`Skill_name_lower_key`; the explicit `ExperienceSkill` and `ProjectSkill` tables with four indexes;
both backfills with an invented 0-based `sortOrder`; and **four mirror triggers** (forward and
reverse) keeping the implicit and explicit representations identical at every instant.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: statement 1's raising guard reads pg_constraint to
                                      # confirm _ExperienceToSkill_A_fkey -> "Experience" and
                                      # _ProjectToSkill_A_fkey -> "Project". Statements 10 and 11
                                      # are written A=parent, B=skill and are SILENTLY WRONG if
                                      # that is reversed.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/skills-joins-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/19-skills-joins-expand.log
```

**Expected output.** `UPDATE 2` on the `showInGrid` backfill (`React.js`, `WebSocket`),
`INSERT 0 17` into `ExperienceSkill`, `INSERT 0 38` into `ProjectSkill`, then `COMMIT`.

**Gate.** The in-transaction guard (statement 16) must pass: 0 `Skill` rows where
`show <> showInGrid`, and 0 differing pairs in either direction on either table.

**One permanent consequence to accept now.** `prisma migrate diff` will **forever** propose
`DROP INDEX "Skill_name_lower_key"`, which must **never** be applied, and `prisma db push` actually
drops it. Re-run that one `CREATE UNIQUE INDEX` after any push, and prefer `migrate deploy`.
The reverse mirror triggers exist for a second reason worth knowing: they make the **DEPLOY itself
reversible** — v2's writes reach the representation v1 reads.

**Undo.** Before COMMIT: plain `ROLLBACK`. After COMMIT, run **section R1** of
`/tmp/v2/prod/skills-joins-contract.sql` as one transaction. It is lossless for every byte v1 can
represent; it discards only the invented `sortOrder` and the duplicated visibility column.
No redeploy needed — v1 is still what is deployed.

---

## Step 20 — EXPAND: hero-badges

**What it does.** `HeroSkillBadge.skillId` + `label` + timestamps; `SET DEFAULT ''` on `name` and
`iconKey`; three backfill UPDATEs resolving 12 badges by name and 2 `Golang` badges onto skill `Go`;
`HeroSkillBadge_skillId_idx`; and the two-way bridge trigger, created **last**.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: PART 0, 8 preflights. P5 (every badge resolves) and
                                      # P7 (icon drift: badge.iconKey vs Skill.iconKey) MUST be
                                      # read and PASTED INTO THE RUN LOG. P7 is the one answer
                                      # data-facts.txt cannot give, and it is the only thing that
                                      # tells you whether Step 43 is reversible.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/hero-badges-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/20-hero-badges-expand.log
```

**Expected output.** `UPDATE 12`, `UPDATE 2`, `UPDATE 2` on the three backfills, then `COMMIT`.

**Gate.** `SET DEFAULT ''` on `name` and `iconKey` is **not cosmetic**: both are `TEXT NOT NULL`
with no default (`20260307195336_init/migration.sql:19-20`) and v2's badge create writes only
`{skillId, label, sortOrder, version}`, so without it the **first badge created after DEPLOY**
raises 23502. Verify both defaults exist. Also: the bridge trigger **must** be created last — if it
existed during the backfill, its "skillId changed" branch would rewrite `name`/`iconKey` from the
`Skill` row and clobber the live v1 hero mid-transaction.

**Undo.** One transaction: drop the trigger and function **before** the columns (leaving it behind
after `skillId` is gone makes every v1 INSERT fail with `record "new" has no field "skillId"`), drop
`HeroSkillBadge_skillId_idx`, `ALTER COLUMN "name" DROP DEFAULT, ALTER COLUMN "iconKey" DROP
DEFAULT`, then `DROP COLUMN skillId, label, createdAt, updatedAt`. Fully reversible with **zero
data loss** — `name` and `iconKey` were never modified.

---

## Step 21 — EXPAND: experience-education

**What it does.** Three helper functions (`v2_month_to_date`, `v2_open_end`, `v2_year_to_int`);
`Experience.startedOn`/`endedOn`/`logoAssetId`/timestamps with the string→date backfill and
`SET NOT NULL` on `startedOn`; the `logoAssetId` FK and index;
`ExperienceBullet_experienceId_sortOrder_idx`; three `Experience` CHECKs;
`Education.startYearInt`/`endYearInt` — **new physical names**, reached from v2 by two `@map` lines —
with three `Education` CHECKs; and **two bidirectional sync triggers**.

**Command.** Run the **PREFLIGHT outside any transaction first** — an open transaction holds
`ACCESS EXCLUSIVE` on `Experience` while you read your screen, and that blocks even a public
`SELECT`.

```bash
psql "$PGPROD"                        # PASS 1: every startDate parses as 'Month YYYY'; every
                                      # non-current endDate parses; Education.startYear is exactly
                                      # 4 digits (P6); P7 prints every id where endYear is
                                      # non-numeric and becomes NULL = 'still enrolled'.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/experience-education-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/21-experience-education-expand.log
```

**Expected output.** One `COMMIT`. Wiingy → `2025-07-01` / NULL; Nykaa → `2025-01-01` /
`2025-07-01`. `Education.startYearInt` = 2021, `endYearInt` = 2025.

### Step 21, sub-steps — the code half, in this order. Do not stop after 21.1.

This is the one step in the whole runbook where the **schema file changes mid-EXPAND**, and the
consequence is a red local build at Step 29 that has a wrong, tempting fix. Run all four.

**21.1 — the two `@map` lines.** `packages/db/prisma/schema.prisma`, model `Education`
(`schema.prisma:136-137` today, `startYear Int` / `endYear Int?`):

```prisma
startYear   Int  @map("startYearInt")
endYear     Int? @map("endYearInt")
```

The Prisma **field** names stay `startYear` / `endYear`, so **zero TypeScript churn** and the six v2
call sites compile untouched. `bunx prisma validate` already passed in Step 2 for this shape.

**21.2 — regenerate the client.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:generate
```

**21.3 — rename the two columns on the Neon branch that local `DATABASE_URL` points at.**
**This is the sub-step that gets skipped, and skipping it is what breaks Step 29.** This is also the
third of the three mandatory follow-ups the SQL file itself names
(`experience-education-expand.sql:78-83`), and the only one with no other home.

The rule is simple and does not depend on which branch you are on: after 21.1, the physical columns
the build queries are `startYearInt` and `endYearInt`. **Whatever database local `DATABASE_URL`
points at must have columns by those names**, or `next build` fails `42703`.

Verified state of that branch as of this revision — `ep-aged-cake-a1ipqgrh`, `neondb`, 43 tables — is
the **v2 canonical** shape: `Education.startYear integer NOT NULL`, `Education.endYear integer NULL`,
and no `startYearInt`/`endYearInt` at all. So a rename is all it needs: no backfill, no trigger, no
`v2_year_to_int`. Check before you act, because the branch may have moved since:

`bun run db:apply-sql` executes a file but prints only the table count, never a result set, so it
cannot answer this. `psql` is not installed. Use a read-only inline probe — it refuses the production
host by the same rule `apply-sql.ts` uses, and `TARGET` names the env var, never a URL:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
TARGET=DATABASE_URL Q="select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='Education'
   and column_name in ('startYear','endYear','startYearInt','endYearInt')
 order by column_name" bun -e '
import "dotenv/config";
import { Client } from "pg";
const h = (x: string) => new URL(x.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
const u = process.env[process.env.TARGET!]!;
if (h(u) === h(process.env.PROD_DATABASE_URL!)) { console.error("refusing: production host"); process.exit(1); }
const c = new Client({ connectionString: u });
await c.connect();
console.log("target", h(u));
console.table((await c.query(process.env.Q!)).rows);
await c.end();
'
```

Verified output on this tree: `target ep-aged-cake-a1ipqgrh-...`, two rows — `endYear integer YES`
and `startYear integer NO`.

- **Two rows, `startYear`/`endYear`, both `integer`** → the canonical shape. Run the rename below.
- **Four rows** → EXPAND already ran against this database (you rehearsed on it). Nothing to do; the
  `@map` targets already exist.
- **`startYear`/`endYear` as `text`** → this is a production clone. Do **not** rename: run the real
  `experience-education-expand.sql` against it instead, which adds the two INTEGER columns additively
  with the backfill and the sync triggers.

`psql` is not installed on this machine, so use the repo's own applier. It refuses any target
resolving to `PROD_DATABASE_URL` (`scripts/apply-sql.ts:31-38`), which is exactly why it is safe to
point at a branch by env-var name:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
cat > /tmp/v2/prod/21-rehearse-education-rename.sql <<'SQL'
-- Local dev branch ONLY. Never production. Production gets the additive
-- startYearInt/endYearInt from experience-education-expand.sql section E;
-- this branch already holds v2's canonical INTEGER names, so @map's physical
-- names are all it is missing.
ALTER TABLE "Education" RENAME COLUMN "startYear" TO "startYearInt";
ALTER TABLE "Education" RENAME COLUMN "endYear"   TO "endYearInt";
SQL
bun run db:apply-sql --file=/tmp/v2/prod/21-rehearse-education-rename.sql --to=DATABASE_URL
bun run db:apply-sql --file=/tmp/v2/prod/21-rehearse-education-rename.sql --to=DATABASE_URL --apply=true
```

The first invocation is a dry run: it prints the target host and the table count and executes
nothing. **Read the host and confirm it is not production** before adding `--apply=true`.

**One ordering trap, because of how `.env` is set up right now.** `DATABASE_URL` and
`SCRATCH_DATABASE_URL` are currently the **same branch** (Step 6). Step 9 tells you to repoint
`SCRATCH_DATABASE_URL` at a *fresh* branch cut from production — do that first, and do not run this
rename until Step 9's rehearsal is finished, or you will rename columns out from under the
rehearsal's own EXPAND run. If you have already repointed `SCRATCH_DATABASE_URL`, only `DATABASE_URL`
matters here: it is the one the **build** reads.

**21.4 — re-prove the build, in full.** Step 5's green build is now stale: it was taken against a
branch whose `Education` columns had the old names.

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
rm -rf packages/db/src/generated && bun install && bun run check-types && bun run build
```

**If `bun run build` fails with `42703 column Education.startYearInt does not exist`, you skipped
21.3. Fix 21.3. DO NOT revert the `@map` lines to make the build green.** Reverting them ships v2
code reading `Education."startYear"` — the exact column Step 45 drops — and the result is a
site-wide 500 on `/`, which is **S1**, after CONTRACT has already run. This is the single most
plausible wrong instinct in the whole cutover, and it is available to you only for the next few
steps.

**Gate.** Four things:
1. **Do NOT backfill `Experience.logoAssetId`.** `Experience_logo_source_check` allows at most one
   logo source, so pointing `logoAssetId` at an adopted `MediaAsset` requires nulling `logoUrl` in
   the same UPDATE — and v1 renders `logoUrl` (`HEAD:apps/web/app/lib/data.ts:203`), so the company
   logos would **vanish from the live site**. That backfill is contract-side media work.
2. **Sub-steps 21.1 through 21.4 all ran, in order, and 21.4 exited 0.** The `@map` lines must land
   in the same commit as the v2 code (Step 29 verifies this explicitly).
3. `SET NOT NULL` on `startedOn` is safe **only** because the `BEFORE INSERT` trigger fills it and
   `NOT NULL` is evaluated *after* BEFORE-row triggers. Verify the trigger exists before trusting it.
4. `packages/db/v2-migration-draft/target-ddl.sql` still names `startYear`/`endYear`, so
   `bun run db:verify` will report those two columns as drift from here on. That is **expected** and
   is the third mandatory follow-up named in `experience-education-expand.sql:76-83`. Either
   regenerate `target-ddl.sql` now or write the two expected names into the run log so Step 24 and
   Step 50 do not read them as a surprise.

**Undo.** Drop both triggers and both trigger functions, the three `Experience` CHECKs and the FK,
`Experience_logoAssetId_idx`, `ExperienceBullet_experienceId_sortOrder_idx`, the three `Education`
CHECKs, then `DROP COLUMN startedOn, endedOn, logoAssetId, createdAt, updatedAt` on `Experience`
and `startYearInt, endYearInt, createdAt, updatedAt` on `Education`, then the three `v2_*` helpers.
**Any edit made during the window survives, because the trigger wrote both sides.** Revert the code
half too (drop the `@map` lines, re-run `db:generate`).

---

## Step 22 — EXPAND: hero (the enum flip). Run this close to the deploy.

**What it does.** T1: `createdAt`/`updatedAt` on `HeroContent`, `HeroTitle`, `SocialLink` — both
**keeping** `DEFAULT CURRENT_TIMESTAMP`. T2, its own short transaction: creates
`"public"."SiteVersion"`, drops the **four** `*_version_check` constraints, and retypes four
`version` columns.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: X1-X6. X2 and X4 must each return 0 rows.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/hero-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/22-hero-expand.log
```

**Expected output.** T1 commits, T2 commits, then V1–V9 print.

**Gate.** Four things:
1. **`SET TIME ZONE 'UTC'` is at the top of the file and must stay.** `CURRENT_TIMESTAMP` is
   `timestamptz` being assigned into `timestamp(3)`; the session zone decides what gets stored, and
   Prisma treats these columns as UTC.
2. **Do NOT run the draft's `ALTER COLUMN "updatedAt" DROP DEFAULT`** here
   (`v2-migration-draft/20-hero-enum.sql` step 7). This is the one place the draft is actively wrong
   for a production target. It moves to Step 41. If you run it now, the first v1 create in the
   window fails 23502 and takes the operator's whole staged batch: `HEAD:staging.ts:482` (hero
   title), `:493` (badge), `:561` (social link), and `HEAD:social-links.ts:21`.
3. **`"HeroContent_live_check"` must survive.** It is on a different column. V3 asserts it.
4. The type **must** be in schema `public` — the v2 client emits the schema-qualified
   `CAST($1::text AS "public"."SiteVersion")`.

Then **smoke the LIVE v1 site and one admin `/hero` save** before you deploy. (Second sanctioned
exception to the freeze; revert the edit.)

**Undo.** Two independent undos. T2 is reversible **only while v1 is the deployed code** — once v2
is live, reversing it breaks every hero read and write instantly with 42883/42804, so roll the
Vercel deployment back to v1 **first**. Then: drop the two defaults, cast all four columns back to
`TEXT`, restore the two defaults, re-add the four CHECKs. Last, **only if nothing else references
it**, `DROP TYPE "public"."SiteVersion"` — it will fail while Step 23's `SiteSettings.projectsVersion`
/`.backgroundVersion` are typed with it, so roll that back first. Check with:
```sql
select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
where a.atttypid = '"SiteVersion"'::regtype and not a.attisdropped;
```
T1 is separately reversible with `DROP COLUMN createdAt, DROP COLUMN updatedAt`, but there is almost
never a reason to.

---

## Step 23 — EXPAND: settings. STEP B is the last DDL before the push.

**What it does.** STEP A: the `SiteVersion` and `CatNapStyle` types (guarded), the `SiteSettings`
table, **all ten CHECKs added before the row**, the `site_settings_resync_v2()` function holding the
one copy of the 23 coercions, the singleton row minted on schema defaults with
`ON CONFLICT DO NOTHING`, the backfill, and two raising assertions.
STEP B, **its own short transaction, deliberately last and alone**: a statement-level `AFTER
INSERT OR UPDATE OR DELETE` trigger on `SiteConfig` that calls the resync.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: P1-P6. P3 is one UNION ALL that returns any value
                                      # that would not survive coercion -> must be 0 rows. P5
                                      # prints both sides of the heroVersion/intro/tagline question.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/settings-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/23-settings-expand.log
```

**Expected output.** P1 → `26 / t / t`. P2 → 0 rows. P3 → 0 rows. P4 →
`{/mine/avatar.png,/mine/avatar2.jpeg}`, 2 elements in order. A7
(`SELECT public.site_settings_resync_v2()`) → **1** on the first run, **0** on any re-run. STEP A
commits. STEP B commits.

**Gate.** Three:
1. **A6 is `INSERT ... ON CONFLICT DO NOTHING`, never `DO UPDATE`.** It mints the `id = 1` row on
   schema defaults so v2's first render cannot 500: `apps/docs/app/lib/actions/site-config.ts:61` is
   `prisma.siteSettings.update` — an **update**, not an upsert — and throws P2025 on a missing row.
2. **STEP B must be its own transaction.** `CREATE TRIGGER` takes `ACCESS EXCLUSIVE` on
   `SiteConfig`, which the root layout reads on **every public render**. The lock must be held for
   microseconds, not for the whole backfill.
3. The trigger **cannot raise inside a v1 save**: the resync clamps every integer into its CHECK
   range, regex-guards `heroDotColor` to `''`, coerces `catNapStyle` to one of the eight labels, and
   filters `heroPhotos` to non-blank newline-free elements. That is what stops a v1 admin save from
   becoming a P2010.

`catNapStyle`'s labels are **lowercase** because the enum is `@map`'d — `oneko.js` reads the label
off a data attribute, so `'moon'` stays `'moon'` in Postgres.

**Undo.** After STEP A only: `DROP TABLE IF EXISTS public."SiteSettings"; DROP TYPE IF EXISTS
"CatNapStyle";`. After STEP B, remove the machinery **first**, in this order: `DROP TRIGGER
"SiteConfig_resync_v2" ON public."SiteConfig"`, `DROP FUNCTION site_settings_resync_v2_trg()`,
`DROP FUNCTION site_settings_resync_v2()`, then the table and the type. **Do not drop
`"SiteVersion"` blindly** — it is shared with Step 22 (five columns across four tables); run the
`pg_attribute` query from Step 22 first. A genuine **zero-loss undo**: `SiteConfig` is never touched
and no R2 object or SMTP send is involved in this cluster.

---

# STAGE 2 — VERIFY EXPAND

## Step 24 — Drift check: you should now know exactly what is pending

**What it does.** Tells you what still differs between production and the v2 schema. After eleven
EXPANDs, the answer should be *only the CONTRACT work*, plus two permanent known-pendings.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:verify --from=PROD_DATABASE_URL 2>&1 | tee /tmp/v2/prod/log/24-drift-after-expand.log
```

This runs `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
--exit-code` with `DATABASE_URL` overridden. It is **read-only** — it connects, introspects and
prints; it never applies.

**Expected output.** A script of exactly the statements Stage 5 will run, and no others:
the `DROP COLUMN`s (`ContactMessage.read`, `FeatureFlag.label`/`description`, `Skill.show`,
`Blog.show`, `Project.images`, `HeroSkillBadge.name`/`iconKey`, `Experience.startDate`/`endDate`/
`isCurrent`, `Education.startYear`/`endYear`, `AnalyticsSession.lastSeenAt`, `AnalyticsEvent.meta`,
`DailyStat.id`), the `DROP TABLE`s (`_ExperienceToSkill`, `_ProjectToSkill`, `SiteConfig`,
`UtmTracker`), the `EventType`/`RevalidationTrigger` narrowings, the `HeroSkillBadge` constraints,
`GithubYear_handle_fkey`, and the `updatedAt` / `sortOrder` `DROP DEFAULT`s.

**Gate.** Two statements are **expected forever** and the script already whitelists them
(`scripts/verify-schema.ts:34` `OPCLASS_INDEXES`): `MediaAsset_key_prefix_idx` and
`NoteNode_path_prefix_idx`. Also expect a proposed `DROP INDEX "Skill_name_lower_key"` — Prisma has
no functional index, so it will always propose that. **Never apply it.**

Anything in the output you cannot name is **S12**. Stop.

**Undo.** N/A — read-only.

---

## Step 25 — The live v1 site must still be correct, and you must force it to prove it

**What it does.** A plain page load proves nothing: ISR will serve HTML baked before you started.
Force a real regeneration.

**Command.**

```bash
curl -s -o /dev/null -w 'home %{http_code}\n' https://www.yatindora.in/
curl -s -X POST https://www.yatindora.in/api/revalidate \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" \
  -H 'content-type: application/json' -d '{}'
sleep 5
curl -s -o /dev/null -w 'home-after-flush %{http_code}\n' https://www.yatindora.in/
curl -s -o /dev/null -w 'sitemap %{http_code}\n'          https://www.yatindora.in/sitemap.xml
curl -s -o /dev/null -w 'blog-index %{http_code}\n'       https://www.yatindora.in/blog
```

An empty body calls `revalidatePath("/", "layout")` — the widest flush available
(`HEAD:apps/web/app/api/revalidate/route.ts:37-39`).

**Expected output.** All 200. Then hard-reload in a browser and check, by eye: the name, navbar
logo, avatar, photo deck, availability pill, hero dot colour, background layer, the hero title
rotator, all 14 skill badge chips (the `Golang` chip still reads **Golang**), the skills grid, the
experience timeline (`Wiingy — July 2025 – Present` with a live pill; `Nykaa — January 2025 – July
2025`), the About terminal (`2021 — 2025`), all six project cards **each with a cover image**, the
thought-of-the-day quote, the contact purposes, and the GitHub tile.

**Gate.** Every one of those renders, and it renders **the same as it did before Step 13**. A 500
here is **S1** and means one of the eleven EXPANDs was not additive after all. Roll that cluster
back using the undo line in its step; EXPAND is a genuine zero-loss undo for all eleven.

**Undo.** N/A — read-only, apart from the cache flush.

---

## Step 26 — One v1 write must still succeed

**What it does.** Reads prove nothing about `NOT NULL` columns with no default, new CHECKs, and new
FKs. Only a write does.

**Command.** In the live v1 admin, do exactly this and nothing else:

1. `/site-config` — change the copyright name, Save, reload, change it back.
2. `/hero` — reorder two hero titles (a reorder path, not a create).
3. `/quotes` — add a quote, confirm it appears, delete it.
4. `/revalidation` — trigger one manual site revalidation.

**Expected output.** All four succeed with no error in the admin UI.

**Gate.** All four succeed **and** these confirm the new machinery kept up:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /dev/stdin <<'SQL'
select public.site_settings_resync_v2() as should_be_0;
select count(*) filter (where "scope" is null)  as null_scope  from "RevalidationLog";
select count(*) filter (where "sortOrder" is null) as null_sort from "Quote";
select count(*) filter (where "skillId" is null)   as null_skill from "HeroSkillBadge";
select count(*) from "Skill" where "show" <> "showInGrid";
SQL
```

`should_be_0` must be **0** — with STEP B installed, 0 proves the trigger mirrored your
`/site-config` save into `SiteSettings`. All four counts must be **0**. A non-zero
`null_skill` is a **public 500 waiting to happen** at DEPLOY.

**Undo.** Revert the four edits (you already did). Nothing structural changed.

---

## Step 27 — Decide, out loud, that you are going to deploy

**What it does.** The last cheap exit. Everything before this point is free to abandon: v1 runs
correctly against the expanded schema indefinitely, and every EXPAND has a lossless undo.

**Command.** Read your run log and confirm, in writing:

- All eleven EXPAND logs ended in `COMMIT` with no `RAISE`.
- Step 24's drift output contains nothing you cannot name.
- Step 25's forced regeneration rendered everything.
- Step 26's four writes succeeded and all five counters are 0.
- Step 20's **P7 icon-drift output** is pasted into the log. If it returned rows, decide *now*
  whether the drifting `iconKey` is one `skillIconMap` cannot resolve — that would render a blank
  chip after Step 43, and Step 43 is where `iconKey` stops existing.
- No `AuditEvent` row exists that you did not make.

**Gate.** All six. If any is in doubt, **stop here and sleep on it.** Sitting in the window costs
nothing.

**Undo.** Roll back all eleven EXPANDs in reverse order (Steps 23 → 13), each using its own undo
line. No deploy is needed, because v1 is still what is deployed.

---

# STAGE 3 — DEPLOY

## Step 28 — Final pre-push resyncs

**What it does.** Two clusters ask for a resync **immediately before** `git push`. If either
changes anything, a v1 write got past the triggers and you want that news **now**, not after.

**Command.**

```bash
# settings: the pre-deploy gate.
psql "$PGPROD" -v ON_ERROR_STOP=1 -c 'select public.site_settings_resync_v2() as rows_changed;'

# projects: STAGE E-FINAL, in its OWN transaction. See the foot of
# /tmp/v2/prod/projects-expand.sql -- a DO $$ guard that raises if any
# ProjectImage row has a non-NULL assetId, then DELETE + the same LATERAL
# unnest INSERT with the blank-element filter, then refresh the backup table.
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '\i /tmp/v2/prod/projects-expand.sql'   # E-FINAL section only
```

For the projects one, copy the **STAGE E-FINAL** block out of the file and run just that block —
do not re-run the whole file.

**Expected output.** `rows_changed = 0`. E-FINAL changes nothing (`DELETE 6`, `INSERT 0 6`, same
rows).

**Gate.** `rows_changed = 0`. **A non-zero answer is not a failure** — it is the value the window
nearly lost, now rescued. If you see one, note which setting it was, then **push immediately**.

**Undo.** Nothing was structurally changed.

---

## Step 29 — Commit the v2 code

**What it does.** Stages whatever v2 code is not yet committed, plus Step 4's edit 5, plus the two
`@map` lines from Step 21.

**Read this before you read the file counts below.** This step was drafted when `HEAD` was
`0050cc9` and the whole v2 change was uncommitted. It is not, any more: the v2 schema and both apps
(`dae8f41`), the JSON dump tooling (`6493c8f`), the build-graph wiring (`83743d2`) and the schema
reference (`f760425`) are already commits on `main`, and the working tree was clean when this
revision was made. So any file count in this step is a count for the *pre-commit* world. Run
`git status --porcelain | wc -l` and trust that, not the number written here.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
git checkout -b v2-cutover          # NOT main -- branch first, then merge when green
git add -A
git status --short | wc -l
git diff --cached --stat | tail -1
# Build-graph edits 1-4 are ALREADY in HEAD (6493c8f and 83743d2), so they will
# NOT show in --cached. Confirm they are present in the tree, not in the diff:
git log --oneline -1 --format='%h %s' 83743d2
jq -r '.scripts | {build, "check-types"}' packages/db/package.json
git diff --cached -- packages/db/package.json packages/db/tsconfig.check.json   # edit 5, the only new one
# Verify the two @map lines are in:
git diff --cached -- packages/db/prisma/schema.prisma | grep -n 'startYearInt\|endYearInt'
git commit
```

**Expected output.** `packages/db/tsconfig.check.json` appears as a **new file** (Step 4, edit 5).
`packages/db/turbo.json` does **not** appear — it was committed in `83743d2`. Both `@map` lines
appear.

**Gate.** Four:
- The commit message does **not** add a Claude co-author trailer, and authorship is yours alone.
- `git ls-files | grep -c generated/prisma` is still **0** — the generated client stays gitignored;
  Step 4 is what makes that safe.
- **Step 5 has been re-run in full since Step 21, not merely re-checked.** This is a hard gate, not
  a parenthetical, because Step 21 changed `schema.prisma` *after* Step 5 passed:
  ```bash
  cd /Users/yatindora/Developer/web-projects/portfolio
  rm -rf packages/db/src/generated && bun install && bun run check-types && bun run build
  ```
  All four exit 0, `db#build` and `db#check-types` both appear, and the `apps/web` build reaches
  `Generating static pages` without a `42703`. If it did not, sub-step **21.3** was skipped — fix
  21.3, and do **not** revert the `@map` lines (Step 21, 21.4).
- You are on a branch, not `main`.

**Undo.** `git reset --soft HEAD~1`. Nothing is deployed yet.

---

## Step 30 — Push. This is the code half of the cutover.

**What it does.** Vercel deploys from git, so this single command is the entire code half.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
git push -u origin v2-cutover
# Then, once you have confirmed both PREVIEW builds are green, fast-forward the
# production branch so both projects deploy it:
git checkout main && git merge --ff-only v2-cutover && git push origin main
```

**Expected output.** Two preview deployments, then two production deployments.

**Gate — three.**

1. Do **not** merge to `main` until **both** preview builds are green. A failed build after EXPAND is
   **S7**: you are stuck mid-window with no deadline. The preview build is a free rehearsal of the
   exact thing Step 31 gates on.
2. **A preview build is only a rehearsal of production if Preview env says so.** Read back the line
   you wrote in Step 6's gate: *which database does Preview `DATABASE_URL` point at?*
   - **Production** → the preview build is a true rehearsal, and it is also the only build in this
     runbook that reads post-EXPAND production before the production deploy. Good news, with a
     catch: see gate 3.
   - **The Neon child branch** → the preview build proves the code compiles and prerenders, but
     against a database that only has `startYearInt` because *you* renamed it at sub-step 21.3. It
     does **not** prove EXPAND landed on production. Treat Step 31 as the first real proof.
   - **Missing or a `REVALIDATE_SECRET` under 32 characters** → both preview builds will fail at
     module load in `packages/config/src/env.ts:37-43` with `Invalid environment variables`, and
     this gate can never be satisfied. Fix Preview env before pushing. That is not S7 and does not
     need a rollback — nothing is live — but it will read like S7 if you have not been told.
3. **The two preview URLs are a live v2 site and a live v2 admin.** If Preview `DATABASE_URL` is
   production, the Step 10 freeze **extends to them**: do not log into the preview admin, do not
   save anything there, and close the tabs when you are done reading the build log. A save on the
   preview admin is a production write made by v2 code before Stage 4 has verified anything, and
   Step 10's instruction to close every admin tab predates these URLs existing.

**Undo.** Before the `main` merge: nothing is live; delete the branch. After the merge: Vercel
**instant rollback** to the previous deployment on both projects. That rollback is **free and
complete** right now, because Stage 5 has not run and every v1 column still exists. It stays free
until Step 39.

---

## Step 31 — Watch both builds, and read the log for `prisma generate`

**What it does.** Confirms the build-graph fix actually fired on Vercel, not just locally.

**Command.** Not SQL. In both Vercel dashboards, open the running production deployment and read
the build log.

**Expected output.** In each log, a `db#build` task running `prisma generate` **before**
`web#build` / `docs#build`, and `Generated Prisma Client ... to ./src/generated/prisma`. In the
`web` log additionally: `Generating static pages (N/N)` and a route table marking `/` and
`/blog/[slug]` as prerendered.

**This build reads production.** Not `prisma generate` — that resolves `env("DATABASE_URL")` and
never connects — but `next build` itself. `apps/web`'s `/` is prerendered (`revalidate = 86400`,
no `force-dynamic`) and its prerender runs `getAboutData()` → `prisma.education.findMany`;
`app/sitemap.ts` and `generateStaticParams()` in `app/blog/[slug]/page.tsx` both call `getBlogs()`.
Whatever `DATABASE_URL` the Production build environment holds is the database those queries hit.
`apps/docs` issues no SQL at build (every dashboard page is dynamic via `cookies()`), but it does
evaluate `@repo/config/env`, so it fails on bad env without proving anything about the schema.

**Gate.** Five:
- Both projects reach **Ready** and are promoted to the **production alias**. One of two is **S8**.
- The `prisma generate` step came from the **turbo graph**, not only from the dashboard command.
  (Leave the dashboard command in place for this first deploy; it merely runs generate twice, which
  is idempotent. Step 55 removes it.)
- The log contains **no** `prisma db push` and no `prisma migrate deploy`. If it does, that is
  **S9** and the schema has just been mutated behind your back — stop and audit with Step 24
  immediately.
- **`Generating static pages (N/N)` is present in the `web` log and did not error.** A build that
  reports Ready without this line has not prerendered, which means a config change you did not
  intend. **Write `N` into the run log** — Step 55's deploy must produce the same `N`. Do not
  predict `N`: `generateStaticParams()` contributes **zero** slugs today, because all ten `Blog`
  rows are `status = 'DRAFT'` (`data-facts.txt:144`) and `getBlogs()` filters to published for the
  non-preview path (`apps/web/app/lib/data.ts:294-305`). `N` will jump the first time you publish a
  post. That is expected, not drift.
- **A build failure here is better news than it looks.** A missing `SiteSettings` row, a
  CHECK-failing `SiteSettings` row, or a leftover EXPAND gap makes the *prerender* throw, so it
  fails the build — **S7, recoverable, nothing aliased, no public impact** — rather than 500ing a
  live site at Step 33. Read the error, fix the data, re-deploy. Do not "fix" it by making `/`
  dynamic.
  - The one failure mode to read carefully: `42703 column Education.startYearInt does not exist`
    means the deploy is building against a database where EXPAND's section E did not run. If that
    is production, Step 21 did not complete. If Preview `DATABASE_URL` differs from Production's,
    check which one this log belongs to (Step 6).

**Undo for a red build.** Nothing is aliased yet if the build failed, so there is nothing to roll
back. Do **not** push again blindly (S7). EXPAND is safe to sit on indefinitely.

**Undo.** Vercel instant rollback, both projects.

---

## Step 32 — Drain

**What it does.** Vercel flips the production alias atomically, but a request **already executing**
on the previous deployment finishes there, and the previous deployment stays reachable at its own
URL. This wait is the difference between a clean cutover and a `42703` on the home page.

**Command.**

```bash
date -u +'DEPLOY READY %H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
sleep 300
date -u +'DRAIN DONE  %H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
```

**Expected output.** Five minutes pass.

**Gate.** At least a few minutes since both deployments reported Ready. Also: **do not run any
contract file from the same terminal session as the push** — the point is to force yourself to
re-read where you are.

**Undo.** N/A.

---

# STAGE 4 — VERIFY DEPLOY

## Step 33 — Public smoke, cold

**Command.**

```bash
for p in / /sitemap.xml /blog /robots.txt; do
  curl -s -o /dev/null -w "$p %{http_code} %{time_total}s\n" "https://www.yatindora.in$p"
done
```

**Expected output.** All 200.

**What "cold" actually means here — read this before you treat a 200 as evidence.** `/` is
prerendered at **build** time (Step 31), so this curl is serving HTML that Vercel's build already
produced from post-EXPAND production. It is a real proof of one thing — *the prerender succeeded* —
and no proof at all of the second thing it looks like it proves, that a fresh request can render the
page. **Step 34's forced regeneration is the only honest public proof.** Demote this step
accordingly: a green Step 33 is a pass, not a clearance.

**Gate.** All 200, read as "the build's prerender succeeded and the alias is serving it".

The runbook previously predicted that a bad `SiteSettings` row surfaces as a 500 here. **It does
not, and the real behaviour is better.** v2's first render hits
`prisma.siteSettings.findUniqueOrThrow` (`apps/web/app/lib/data.ts:64`), and `unstable_cache` cannot
reuse v1's persisted payload because it keys on the callback source (Step 12) — but that first render
happens in the **build**, not in this request. So a missing or CHECK-failing `SiteSettings` row
fails the Step 31 build (**S7**: recoverable, nothing aliased, no public impact) instead of 500ing a
live site (**S1**). If you reached Step 33 at all, `SiteSettings` rendered at least once.

A 500 *here*, with a green build behind it, therefore means something that is true at request time
and was not true at build time — most likely a runtime-only env var (Step 6, group C), a connection
limit on the Neon endpoint, or a middleware/edge failure. It is still **S1**. Rollback is still free
— `SiteConfig` is untouched.

**Undo.** Vercel instant rollback, both projects. Then re-run Step 23's STEP A assertions.

---

## Step 34 — Force a real regeneration and look at the page

**What it does.** A warm page proves nothing, and after Step 31 the "cold" page in Step 33 was warm
too — it was baked by the build. **This is the first and only time production renders `/` from a
live request.** Flush every tag, force the HTML to be rebuilt, prove it was rebuilt, then look.

**The tag list is complete, verified.** `packages/shared/src/tags.ts:18-23` `ALL_KNOWN_TAGS` is
exactly `["blogs", "projects", "site-config", "flags"]`, and that file is **byte-identical** in
`0050cc9` and the v2 tree — so there is no v2-only tag to miss. Only four readers are
`unstable_cache`d: `cachedSiteConfig` (`data.ts:104`), `cachedProjects` (`:258`), `cachedBlogs`
(`:298`), `cachedBlogBySlug` (`:347`), plus `readFlags` in `apps/web/app/lib/flags.ts:10`.
`getHeroData`, `getAboutData`, `getSkills`, `getExperiences`, `getQuotes` and `getContactData` are
**uncached** and hit the database on every regeneration, so there is no hidden stale-payload surface
for them at all.

**Command.**

```bash
# 1. flush all four tags (this is exactly ALL_KNOWN_TAGS)
curl -s -X POST https://www.yatindora.in/api/revalidate \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" -H 'content-type: application/json' \
  -d '{"tags":["site-config","projects","blogs","flags"]}'

# 2. flush the HTML itself. An EMPTY body takes the widest path available:
#    revalidatePath("/", "layout"), which drops every route under the root
#    layout, not just the four tagged data entries.
#    apps/web/app/api/revalidate/route.ts:37-39.
curl -s -X POST https://www.yatindora.in/api/revalidate \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" -H 'content-type: application/json' -d '{}'

sleep 5

# 3. PROVE the page regenerated rather than replaying build output. Two
#    consecutive requests: the first should MISS (or STALE) and the second HIT.
for i in 1 2; do
  curl -s -o /dev/null -D - https://www.yatindora.in/ \
    | grep -i -E '^(HTTP/|x-vercel-cache|x-nextjs-cache|age):' | tr -d '\r'
  echo '--'
  sleep 3
done
```

Then hard-reload in a browser and check the **full Step 25 list** again, item by item. The ones
most likely to be wrong, and what each means:

| Symptom | Cluster | Meaning |
|---|---|---|
| Whole site 500 | settings | `SiteSettings` row missing or failing a CHECK |
| Hero chips missing / 500 | hero-badges | a `skillId` is NULL — Step 26 should have caught it |
| A `Golang` chip reading `Go` | hero-badges | the `label` backfill did not run |
| A project card with **no** cover | projects | `ProjectImage` backfill or trigger gap |
| A card showing the **old** cover | projects | a window edit the trigger missed |
| An experience or project with **no** chips | skills-joins | forward mirror gap |
| A hidden skill visible, or vice versa | skills-joins | `show`/`showInGrid` divergence |
| No thought-of-the-day quote | about-quotes-notes | `Quote.sortOrder` — Step 16 |
| `NaN` months on a role | experience-education | date parse |
| No GitHub tile | media-flags-reval-github | the refresh is failing; check `GithubYear` |

**One symptom that will NOT appear here, and where to look instead.** A broken `FeatureFlag` read
renders as *nothing wrong*: `apps/web/app/lib/flags.ts:15-17` wraps the query in a `try/catch` that
logs and returns `defaultFlagMap()`. So a `42703` on `FeatureFlag` after Step 15 or Step 40 produces
a page that looks correct while silently serving registry defaults for all nine flags. Flushing the
`flags` tag cannot prove `FeatureFlag` is healthy. The only proofs are `/flags` in the admin
(Step 35) and the Vercel function log line `[flags] read failed`. Add that string to your log filter
for the Step 53 watch.

**Gate.** Three:
- Every item on the Step 25 list renders, and renders **correctly**, not merely without an error.
- Both revalidate calls returned `{"revalidated":true,...}`. A `401` means `REVALIDATE_SECRET` in
  your shell does not match Vercel Production's (Step 6); a `400` means the body was malformed.
- The header probe shows a **MISS or STALE followed by a HIT**, with `age` resetting. If both
  requests are `HIT` with a large, growing `age`, the flush did not take and you are still reading
  build output — **this step has proved nothing yet**. Re-run the empty-body POST and check the
  Vercel function log for the `/api/revalidate` invocation.

**Undo.** Vercel instant rollback. Note that after a rollback the v1 code reads `SiteConfig`, which
is **stale** with respect to anything v2 wrote — no reverse trigger is installed, deliberately. Also
note the asymmetry: a rollback does **not** un-flush these caches, so post-rollback v1 will
regenerate from the database rather than replay its old HTML. That is the correct behaviour and it
is also why the rollback is not instant in *appearance* — give it a minute.

---

## Step 35 — Admin smoke: every page must open

**Command.** **Start by logging OUT and logging back IN.** Step 35 used to open with "log into the
admin", which a surviving `admin_session` cookie satisfies without ever exercising the login path.
Step 14 adds `AdminUser.lockedUntil` and `AdminUser.otpAttempts`, and
`apps/docs/app/lib/actions/auth.ts` is **unmodified** by v2 — so if EXPAND broke login you would not
learn it until the cookie expired, by which time Steps 36, 51 and all of CONTRACT are blocked and
you cannot reach the admin to diagnose it.

```
1. /login  — log out, then log back in with the real password + OTP.
```

Then open every page, confirming a 200 and sane content. The full route list, from
`find apps/docs/app -name page.tsx`:

`/dashboard` `/site-config` `/hero` `/background` `/cat` `/about` `/skills` `/icons`
`/experiences` `/experiences/<id>` `/experiences/new` `/projects` `/projects/<id>` `/projects/new`
`/blogs` `/blogs/<id>` `/blogs/new` `/quotes` `/contact-purposes` `/messages` (open a detail pane)
`/media` `/flags` `/revalidation` `/tracker` `/tracked-links` `/tracked-links/<id>` `/terminal`
`/history` `/notes` `/notes/search` `/notes/trash` `/notes/revise` `/refer-emails` `/admin-users`
`/analytics`

Two notes on that list:
- `/links` and `/social-links` are one-line `redirect("/hero")` stubs kept for old bookmarks. Nothing
  to smoke. Same for `/about/education` and `/about/paragraphs`, which redirect to `/about`.
- **`/analytics` is a WRITE, not a read.** `apps/docs/app/(dashboard)/analytics/page.tsx:39` awaits
  `catchUpRollups()` **synchronously in the render** — not inside `after()` — which runs `rollupDay`
  for up to `MAX_DAYS_PER_REQUEST = 5` unsummarised past days and inserts `DailyStat` and
  `RollupRun` rows (`packages/db/src/rollup.ts:269-290`). Opening it during the freeze is a
  deliberate analytics write. That is safe — the analytics cluster's EXPAND is done and its CONTRACT
  is Step 48 — but know that you did it, and see Step 37 for why it is also useful.

**Expected output.** All render. `/login` accepts the password and the OTP and lands on `/dashboard`.

**Gate.** Six are specific proofs, not general checks:
- **Login worked from a cold session.** Not a cookie. This is the prerequisite for everything after
  it.
- `/blogs` prints **"no date yet"** for the ten drafts. That string is v2's null branch at
  `apps/docs/app/(dashboard)/blogs/page.tsx:199` and is proof the deployed bundle is the v2 one.
- `/flags` and `/revalidation` show a **name**, not a uuid, in the changed-by / actor columns.
  `/flags` rendering at all is also the **only** proof `FeatureFlag` survived Step 15 — the public
  read swallows its own errors (Step 34).
- `/revalidation` shows **scope** values, not blanks.
- `/tracker` renders — it is the only reader of `rawContent`/`rawTerm`/`messageId`, and a `42703`
  there means Step 13 did not land.
- `/notes` renders its tree, and `/notes/search`, `/notes/trash` and `/notes/revise` all render.
  `NoteNode` is 881 rows, the largest data set in the database, and Step 16 is flagged in the
  Appendix as **unrehearsed**. Four pages is the cheapest coverage available for it.

A 500 on `/tracker`, `/flags`, `/site-config` or `/terminal` is a missing EXPAND column. Find it in
Step 24's log. A 500 on `/analytics` is different in kind: `catchUpRollups()` is already wrapped in a
`try/catch` that renders the error into the page (`analytics/page.tsx:41-44`), so a 500 there is the
*read* path, and the error banner is the *write* path.

**Undo.** Vercel instant rollback.

---

## Step 36 — One v2 write per cluster. This is the only proof the write paths work.

**What it does.** v2 writes use different column lists, different tables and different upsert
shapes from v1. Several are `update`, not `upsert`, and throw P2025 on a missing row.

**Command.** In the v2 admin, do all of these, then undo each:

| Do | Proves |
|---|---|
| `/site-config`: change the copyright name, save, reload, change back | `apps/docs/.../site-config.ts:61` is `prisma.siteSettings.update({ where: { id: 1 } })` — an **update**, not an upsert |
| `/hero`: edit a badge, save | v2's badge write path, and the `SET DEFAULT ''` on `name`/`iconKey` |
| `/hero`: add a social link, then delete it | v2 supplies `updatedAt` explicitly (Step 41 depends on this) |
| `/quotes`: add a quote — **confirm it lands LAST** — then delete it | `nextSortOrder` is supplying `Quote.sortOrder` (Step 42 depends on this) |
| `/experiences`: open a role, save it **unchanged** | the only proof a v2 `Experience` write works |
| `/projects`: open a project, save it **unchanged** | v2 writes `ProjectSkill` and `ProjectImage` |
| `/skills`: toggle one skill's visibility twice | v2 writes `showInGrid` |
| `/blogs`: edit a draft's title, save, revert | v2's `image: ... || null` and nullable `publishedAt` |
| `/flags`: toggle a flag twice | `updatedByName` is written |
| `/revalidation`: trigger a manual revalidation | `scope` and `actorName` are written |
| Public: submit the **contact form** once | `POST /api/contact` writes `status`/`readAt`, not `read` |
| **`/about`: open the Education row's edit dialog, press *Update entry* without changing a field, then Save** | **`startYearInt`/`endYearInt`.** This is Step 45's prerequisite and nothing else in this runbook touches it. `education-table.tsx:33-49` builds the staged fields from the *whole* form, so an unchanged dialog still puts `startYear`/`endYear` in the `SET` list; `staging.ts:697-717` then issues the `tx.education.update`. Do **not** instead press the page-level Save with no dialog: `staging-provider.tsx:78` drops an empty field set, so that writes nothing and proves nothing. Watch for **"Couldn't save your changes. Nothing was applied."** — per Step 10 that string is the *only* user-visible symptom of an Education failure, and the reason is in the Postgres log |
| **`/messages`: pick a message that is currently UNREAD, mark it read, then unread, then star, then unstar** | **`status` + `readAt` with no `read`.** Step 39 drops `ContactMessage.read`. `messages.ts:23-47` — note these are `updateMany` with a status filter, so a row that is already READ silently matches nothing: if you pick the wrong message every click is a no-op that looks like a success. The SQL gate below is how you know it actually wrote |
| **`/notes`: create a folder, create a question inside it, set its confidence, then delete both** | All **three** CHECKs from Step 16: `NoteNode_depth_check` (`depth >= 0`, from `createNode`), `NoteNode_self_parent_check` (`parentId <> id`, from the move on create), `NoteAnswer_confidence_check` (`confidence BETWEEN 0 AND 4`, from `notes.ts:207` `setConfidence`). 881 rows, the largest data set, and the Appendix flags this cluster **unrehearsed** |
| **`/contact-purposes`: add one, then delete it** | `staging.ts:485-488` reads `_max: { sortOrder }` then creates — the same `nextSortOrder` shape as `/quotes`, on a different table |
| **`/tracked-links`: create a link, then delete it** (not `/tracker` — that page is read-only) | `tracked-links.ts:52` `createTrackedLink`, plus the `rawContent`/`rawTerm`/`messageId` columns Step 13 added |
| **`/refer-emails`: press Refresh once** | `refer-emails.ts:20` `syncReferEmails`, which also needs the four `GOOGLE_*` vars from Step 6 group C. A silent no-op here is an env miss, not a schema miss |
| **`/cat`: change the nap style, save, change it back** | The `CatNapStyle` enum minted in Step 23 and `SiteSettings.catNapStyle`/`.catNapSeconds` (`site-config.ts:43-44`). Step 10 calls this the **most deceptive** save in the app because `cat-console.tsx` previews locally and looks right regardless |

**Expected output.** Every one succeeds. Fifteen writes covering eleven clusters.

**What is deliberately NOT here, and where it is.** The first **R2 upload** and the first **SMTP
reply** are the two writes that cannot be rolled back (STOP-THE-LINE rule 2), so they stay out of the
freeze. They are the **first thing you do after Step 37**, not at Step 51 — see the note at the end of
Step 37. Until then, `media-references.ts`, `messages.ts`'s reply path and the new
`MediaAsset_folder_check` from Step 15 are **unproven**.

**Gate.** All of them, plus:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /dev/stdin <<'SQL'
select "id", "updatedAt" > now() - interval '1 hour' as written_by_v2_recently,
       "name" <> '' and "navbarLogo" <> '' and "contactEmail" <> '' as not_all_defaults
  from "SiteSettings";
select count(*) as quotes_with_sortorder from "Quote" where "sortOrder" is not null;
select count(*) as badges_resolved from "HeroSkillBadge" where "skillId" is not null;

-- the seven writes added above, each one proved by a column that only v2 writes
select "id", "startYearInt", "endYearInt", "updatedAt" > now() - interval '1 hour' as edu_touched
  from "Education";
select "id", "status", "readAt", "starred", "read" as legacy_read
  from "ContactMessage" order by "updatedAt" desc nulls last limit 3;
select count(*) as notes_now from "NoteNode";
select count(*) as answers_now from "NoteAnswer";
select "confidence", "lastRevisedAt" from "NoteAnswer"
  order by "lastRevisedAt" desc nulls last limit 1;
select "catNapStyle", "catNapSeconds" from "SiteSettings";
select count(*) as tracked_links from "TrackedLink";
SQL
```

`written_by_v2_recently = t`, `not_all_defaults = t`, and both original counts equal their table's
row count. Then:
- **`edu_touched = t` and `startYearInt` is 2021.** If `edu_touched` is `f`, the `/about` save did
  not reach the database — re-read the dialog instruction in the table above.
- **The `ContactMessage` row you clicked has `readAt` non-null and back to null as you toggled, and
  `legacy_read` did NOT move with it.** `legacy_read` frozen at its old value is the *point*: it
  proves v2 stopped writing the column Step 39 drops. If `legacy_read` moved, the deployed bundle is
  v1.
- **`notes_now` = 881 and `answers_now` back at its Step 12 value**, after you deleted both nodes.
  A number that stayed high means the delete did not purge; check `/notes/trash`.
- **`lastRevisedAt` is within the last hour**, which is the only observable proof `setConfidence`
  wrote through `NoteAnswer_confidence_check`.
- **`catNapStyle` is back to its original value** and is a valid `CatNapStyle` label.
- **`tracked_links` is back to its starting count.**

**Undo.** Vercel instant rollback. It is still free: Stage 5 has not run. Two of the fifteen writes
are *not* covered by that rollback and you should know which: the `/refer-emails` sync pushes to a
Google Sheet, and the contact-form submission sends a notification email. Both are external side
effects. Neither is destructive.

---

## Step 37 — End the admin freeze, and confirm the background jobs are running

**What it does.** Closes the window. From here the admin is yours again.

**Command.**

```bash
date -u +'FREEZE END %Y-%m-%dT%H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
# Generate a beacon so the after() jobs fire, then check they moved.
curl -s -o /dev/null https://www.yatindora.in/
sleep 60
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /dev/stdin <<'SQL'
select max("startedAt") as last_session from "AnalyticsSession";
select max("createdAt")  as last_event   from "AnalyticsEvent";
select "status", "triggeredBy", "createdAt" from "RollupRun" order by "createdAt" desc limit 5;
select "key", "lastRunAt", left(coalesce("lastResult",''),80) as result from "MaintenanceState";
SQL
```

**Expected output.** `last_session` and `last_event` have moved. A `RollupRun` row with
`status = 'ok'` and a `createdAt` **after** the deploy, eventually.

**Gate.** `last_session` and `last_event` moved. If they did not, v2's collect route is failing —
and it returns **204 on every error**, so silence is not success. Check the Vercel function logs.

**The `RollupRun 'ok'` row is Step 48's hard prerequisite.** It may take hours on a low-traffic
site. Do not wait for it here; note the requirement and come back.

**There is a faster, legitimate way to get that row than waiting for a visitor: open `/analytics`.**
`apps/docs/app/(dashboard)/analytics/page.tsx:39` awaits `catchUpRollups()` **in the render**, which
calls `rollupDay(day, "catch-up")` for up to five unsummarised past days and records a `RollupRun`
with `status = 'ok'` (`packages/db/src/rollup.ts:269`). Caveat, so you do not mistake silence for
failure: `catchUpRollups` only acts on **complete past days that have no `DailyStat` row yet**
(`rollup.ts:311-320`). If every past day is already summarised it does nothing and writes no
`RollupRun` at all — that is a legitimate "nothing to do", not an error. Check with:

```sql
select "status", "triggeredBy", "date", "createdAt" from "RollupRun"
  order by "createdAt" desc limit 5;
```

A row with `triggeredBy = 'catch-up'` and a `createdAt` after the deploy satisfies Step 48.

Also note: `lastRunAt` is bumped **before** the task body runs, so a task that throws is locked out
for its full interval — **24 hours for retention** — with the only evidence an `error:` prefix in
`lastResult`. Read that column.

**Undo.** N/A. The freeze is over.

---

## Step 37b — R2 and SMTP: the two write paths that could not go in the freeze

**What it does.** Proves the only two write paths in the app that no earlier step is allowed to
touch, at the first moment it becomes legal to touch them.

**Do this now, before Step 38's dump. Not at Step 51.** R2 uploads and SMTP replies are the two
writes STOP-THE-LINE rule 2 keeps out of a freeze, because the bytes land in the bucket before the
row is written (`media.ts:237`) and the email is delivered before the `MessageReply` insert
(`messages.ts:158` then `:162`). The freeze is now over, so a deliberate orphan is traceable and
cheap — which makes this the first moment they *can* be tested, and it is also the last moment at
which finding them broken is free. Leaving them at Step 51 puts them behind Step 39
(`ContactMessage.read` gone), Step 43 (**the point of no clean return**) and Step 49 (`SiteConfig`
moved to `legacy_v1`), i.e. past every threshold where Vercel instant rollback is still complete.
`MediaAsset_folder_check` is new in Step 15 and both `media-references.ts` and `messages.ts` are
modified, so neither path is proven by anything before this.

```
1. /media  — upload one small file (a <50 KB PNG). Confirm it appears in the
             grid and the thumbnail renders from the CDN host.
2. /media  — delete it. Confirm the row is gone AND the R2 object is gone
             (check the bucket view, not just the grid).
3. /messages — open any message and send ONE reply to your own address.
             Confirm the mail arrives and that a MessageReply row exists.
```

**Expected output.** The upload renders from the CDN host, the delete removes both the row and the
object, and the reply arrives in your inbox.

```sql
select count(*) as assets from "MediaAsset";
select "folder", count(*) from "MediaAsset" group by 1 order by 1;
select "id", "messageId", "createdAt" from "MessageReply" order by "createdAt" desc limit 3;
select "id", "status", "repliedAt" from "ContactMessage" where "repliedAt" is not null
  order by "repliedAt" desc limit 3;
```

**Gate.** `assets` is back to its starting count, every `folder` value satisfies
`MediaAsset_folder_check`, the newest `MessageReply` is yours, and the replied message has
`status = 'REPLIED'` with a `repliedAt`. **Both gates must pass before Step 38.** If you choose to
defer this anyway, write that decision into the run log verbatim: *"the media and reply write paths
are unverified until after Step 43"* — and re-read Stage 5's preamble knowing it.

**Undo.** Step 2 above *is* the undo for the upload — delete the asset and confirm the R2 object is
gone. The reply email cannot be unsent; that is the point of STOP-THE-LINE rule 2, and sending it to
your own address is what makes it harmless. Nothing here is a schema change, so there is nothing to
roll back in the database.

---

# STAGE 5 — CONTRACT

**Everything in this stage is destructive.** Nothing in it is urgent. The dropped columns are dead
weight, not a correctness problem — you can sit at the end of Stage 4 for a week. **The longer you
wait, the longer Vercel instant rollback stays available.**

**Start a second, shorter freeze** (Steps 38 → 49, ~30 minutes). It is not for correctness — v2
writes the new columns — but so a save does not land mid-transaction and trip a `lock_timeout`.

**Same two-pass procedure as Stage 1.** Every file opens with a human GATE and a preflight; read
both.

**The three thresholds in this stage, plainly:**

| Threshold | Step | What changes |
|---|---|---|
| Vercel instant rollback stops being **free** | **39** | `ContactMessage.read` is gone. Rollback now needs `ADD COLUMN "read" BOOLEAN NOT NULL DEFAULT false; UPDATE SET "read" = ("status" <> 'UNREAD');` run **before** the old deployment is re-aliased. Cleanly reconstructible. |
| **No clean way back except the dump** | **43** | `HeroSkillBadge.iconKey` is gone and v2 has no home for it. The only authoritative source is the Step 7 JSON dump plus Step 20's P7 output. |
| v1 becomes **unservable site-wide** | **49** | `SiteConfig` moves to `legacy_v1`. Every public route 500s under v1 because `HEAD:apps/web/app/lib/data.ts:72` raises `42P01` **inside the root layout**. Undo is one statement (`SET SCHEMA public`) until Step 56. |

---

## Step 38 — Fresh pre-contract dump, and start the second freeze

**What it does.** The Step 7 dump is now stale for two things that kept being written right up to
the deploy: `UtmTracker` rows (`HEAD:apps/web/app/api/track/utm/route.ts:103`, beaconed from
`HEAD:apps/web/app/layout.tsx:105` on **every page**) and the window's `MessageReply` /
`RevalidationLog` rows.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:dump --from=PROD_DATABASE_URL --out=backups/PRE-CONTRACT-$(date -u +%Y%m%dT%H%M%SZ).json
jq '.tables | length' backups/PRE-CONTRACT-*.json
jq '[.tables[] | select(.name=="UtmTracker") | .rows | length]' backups/PRE-CONTRACT-*.json
date -u +'FREEZE-2 START %H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
```

**Expected output.** 43 tables. `UtmTracker` row count **≥** the Step 7 count.

**Gate.** The new dump exists and is off this machine. `UtmTracker`'s count is **higher** than in
the Step 7 dump — that difference is exactly the rows that exist in no earlier dump, and Step 48
renames the table away. Close every admin tab again.

**Undo.** N/A — read-only.

---

## Step 39 — CONTRACT: contact-admin-audit

**What it does.** Three top-up backfills (`sentByName`, `actorName`, and `updatedByName` with
`IS DISTINCT FROM` so a **stale** name is repaired, not just a missing one), drops
`AuditChange_entity_rowId_idx`, and **drops `ContactMessage.read`** — the only destructive statement
in the cluster.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: P0 (does "read" still exist), P1 (the licence:
                                      # count(*) FILTER (WHERE "read" <> ("status" <> 'UNREAD'))
                                      # must be 0), P2, P3 (nothing in pg_depend depends on it)
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/contact-admin-audit-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/39-contact-admin-audit-contract.log
```

**Expected output.** One `COMMIT`, then V1–V6.

**Gate.** All four human gates at the top of the file: the v2 deployment id is Ready **and
aliased**; `POST https://yatindora.in/api/contact` accepts a real submission; `/messages` loads and
mark-read / mark-unread / bulk archive all work; `/flags` and `/revalidation` show a **name**.
Preflight **P1 must be 0** — that is the licence to drop the column. The drop is plain, **no
`CASCADE`**, on purpose: a stray dependency should raise `2BP01` and roll back.

**What you give up.** `AuditChange_entity_rowId_idx` is the only index that could answer "everything
that ever happened to this row". One `CREATE INDEX` brings it back.

**Undo.**
```sql
ALTER TABLE "ContactMessage" ADD COLUMN "read" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ContactMessage" SET "read" = ("status" <> 'UNREAD');
CREATE INDEX "AuditChange_entity_rowId_idx" ON "AuditChange" ("entity", "rowId");
```
That `UPDATE` is the **only** correct restore — not a restore from the dump. Between DEPLOY and here
v2 stopped writing `read` entirely, so every message created in that gap sits at the default `false`
regardless of status. **Run this before re-aliasing the v1 deployment, not after.**

---

## Step 40 — CONTRACT: media-flags-reval-github

**What it does.** Three top-up backfills, drops `FeatureFlag.label` and `.description`, drops two
unused indexes, rebuilds `RevalidationTrigger` without `SYSTEM`, and adds `GithubYear_handle_fkey`.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the human GATE at the top
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/media-flags-reval-github-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/40-media-flags-reval-github-contract.log
```

**Expected output.** One `BEGIN`, then one `COMMIT` — the file carries its own transaction, so
either all four sections landed or none did. A **WARN** (not an abort) if any `FeatureFlag` key is
outside `FLAG_DEFINITIONS`.

**Atomicity here is load-bearing, not cosmetic.** The `DROP COLUMN label, description` in section 1
is the one statement in this file whose only remaining source is the Step 15 P4 dump, and it sits
*before* two guards that `RAISE EXCEPTION`: section 3's SYSTEM-rows check and section 4's orphan
`GithubYear` check — and section 4's is the **last statement in the file** and the likeliest to fire.
If the file were applied without a transaction, that drop would already be committed when the guard
aborted, leaving a state the ROLLBACK block does not describe and for which **S3** and **S4**'s
"Nothing was applied — the transaction rolled back" would be false. Confirm the log shows `BEGIN` and
no `SET LOCAL can only be used in transaction blocks` warning; if it shows that warning you are on a
stale copy of the file, and section 1 and section 3 ran with **no** `lock_timeout`.

**Gate.** `/flags`, `/site-config` and `/terminal` all return 200 (they are the three pages that
select `FeatureFlag.label` under v1), `/revalidation` shows scope values, and the home page renders
the GitHub tile. Before the two `DROP INDEX` statements, **confirm `idx_scan = 0` on PRODUCTION**,
not on a Neon branch — a branch's `pg_stat_*` counters are a fresh compute's:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select indexrelname, idx_scan from pg_stat_user_indexes
where indexrelname in ($$MediaAsset_folder_createdAt_idx$$,$$RevalidationLog_entityType_entityId_idx$$);'
```

**The one thing in this cluster with no source in the database afterwards:** `label`/`description`
for a `FeatureFlag` key **outside** `FLAG_DEFINITIONS`. The **v1** seed at
`0050cc9:packages/db/scripts/seed-flags.ts:37-42` leaves such rows alone by design, so no seed
restores them. Their only record is the Step 15 P4 output in your run log **and** the `FeatureFlag`
rows in the Step 7 and Step 38 dumps — which, since Step 8b, you have an executable path back from.
Read the WARN.

**Undo — five steps, deliberately not one transaction.** Full text, with the reasoning, in the
ROLLBACK block of `media-flags-reval-github-contract.sql`. In outline:

1. **One transaction:** drop `GithubYear_handle_fkey`; `ALTER TYPE "RevalidationTrigger" ADD VALUE IF
   NOT EXISTS 'SYSTEM'` (appends last, exactly where `20260821130000` had it, so label order comes
   back byte-identical — legal inside a transaction on PG12+, but the restored label cannot be
   **used** until after COMMIT); recreate the two indexes; `ADD COLUMN IF NOT EXISTS "label" TEXT,
   ADD COLUMN IF NOT EXISTS "description" TEXT`. `label` comes back **nullable**, which is the
   post-EXPAND shape and is intentional.
2. **The text back for every key, off-registry included**, from the Step 38 dump via the Step 8b
   generator:
   ```bash
   cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
   jq -r -f v2-production/recover-from-dump.jq \
      --arg table FeatureFlag --arg key key --arg cols 'label,description' --arg mode update \
      backups/PRE-CONTRACT-<stamp>.json > /tmp/v2/prod/recover-flag-labels.sql
   less /tmp/v2/prod/recover-flag-labels.sql        # read it
   ```
   then apply that file exactly the way you applied this step's contract file.
3. **Belt and braces for the nine registry keys**, if the dump is unavailable. `flags:seed` reads
   `process.env.DATABASE_URL` through `packages/db/src/index.ts:1,5`, and local `DATABASE_URL` points
   at the **throwaway Neon child branch** — so the override is mandatory, and you need the v1 tree
   because only the v1 seed writes `label`/`description`:
   ```bash
   git stash && git checkout 0050cc9 -- packages/db packages/shared
   cd packages/db && DATABASE_URL="$PGPROD" bun run db:generate
   DATABASE_URL="$PGPROD" bun run flags:seed
   ```
   `db:generate` has to run again because `**/generated/prisma` is gitignored.
4. **Fail-safe:** `SELECT "key" FROM "FeatureFlag" WHERE "label" IS NULL;` — read it — then
   `UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL;`. This catches a flag created
   *after* the dump, which step 2 cannot know about.
5. **Only now:** `ALTER TABLE "FeatureFlag" ALTER COLUMN "label" SET NOT NULL;`

Putting step 5 in step 1's transaction is the specific mistake this ordering exists to prevent: one
NULL label raises `23502` and rolls back the FK drop and the enum re-widening along with it.
**Do not re-alias the v1 deployment until step 5 has committed** — the v1 datamodel declares `label
String`, non-nullable. Same ordering rule as Step 39.

---

## Step 41 — CONTRACT: hero

**What it does.** Exactly three statements: `ALTER COLUMN "updatedAt" DROP DEFAULT` on
`HeroContent`, `HeroTitle` and `SocialLink`. It drops **no** column and **no** table.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: C0 (all four version columns report
                                      # udt_name = SiteVersion, and curl / returns 200) and
                                      # C1 (the three updatedAt columns still carry
                                      # column_default = CURRENT_TIMESTAMP)
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/hero-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/41-hero-contract.log
```

**Expected output.** Three `ALTER TABLE`, one `COMMIT`.

**Gate.** Safe now **and only now**, because the v2 client always supplies the value:
`INSERT INTO "public"."HeroTitle" ("id","version","title","sortOrder","createdAt","updatedAt")
VALUES (...)` and `UPDATE ... SET "title" = $1, "updatedAt" = $2`. Step 36's "add a social link"
is the proof. **Not here:** `HeroSkillBadge."updatedAt" DROP DEFAULT` — that table's timestamps
belong to Step 43.

If you never run this file, the only consequence is that `migrate diff` reports drift on three
columns. Nothing functional depends on it.

**Undo.** `ALTER TABLE "HeroContent"/"HeroTitle"/"SocialLink" ALTER COLUMN "updatedAt" SET DEFAULT
CURRENT_TIMESTAMP;` — safe at any time with either code version deployed. **Do exactly that** if you
ever need to run the v1 code, `packages/db/seed.ts` or
`packages/db/scripts/install-hero-v2.ts` against this database again.

---

## Step 42 — CONTRACT: about-quotes-notes

**What it does.** Drops the three temporary defaults EXPAND left behind:
`Quote.sortOrder DROP DEFAULT` and `updatedAt DROP DEFAULT` on `AboutParagraph` and `Quote`.
Drops no column and no table.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: C0, C1, C2
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/about-quotes-notes-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/42-about-quotes-notes-contract.log
```

**Expected output.** Three `ALTER TABLE`, one `COMMIT`.

**Gate.** Step 36's quote round-trip landed **last**, which is the proof `nextSortOrder` supplies
the value. Preflight **C1** lists any quote created by v1 in the window sitting at `sortOrder 0`;
this is the last moment that evidence is legible, so reorder it in the v2 admin now if you care.
**`ContactPurpose.updatedAt` keeps its default permanently** — `schema.prisma` declares
`@default(now()) @updatedAt` on that model alone, to match `ContactMessage`. It is absent from the
file on purpose. **Do not add it.**

**Undo.** `ALTER TABLE "Quote" ALTER COLUMN "sortOrder" SET DEFAULT 0;` plus
`SET DEFAULT CURRENT_TIMESTAMP` on the two `updatedAt` columns. Nothing here needs the dump.

---

## Step 43 — CONTRACT: hero-badges. **THIS IS THE POINT OF NO CLEAN RETURN.**

**What it does.** Drops the bridge trigger **first**, re-runs the three backfills to heal the
window, hard-aborts on any unresolved row, then `SET NOT NULL` on `skillId`, adds
`HeroSkillBadge_skillId_fkey`, creates `HeroSkillBadge_version_skillId_key`, and
**`DROP COLUMN "name", DROP COLUMN "iconKey"`**.

> **`iconKey` has no home in v2.** The chip icon comes from `Skill.iconKey`. After this commits, the
> only authoritative record of a per-badge icon is the **Step 7 JSON dump** plus **Step 20's P7
> output**. This is the first step in the entire runbook whose undo is not a SQL statement **written
> by hand** — it is a SQL statement *generated from the dump*, by the Step 8b generator, which is why
> Step 8b is not optional. **Re-read Step 20's P7 output now, before you run this, and confirm you
> have run Step 8b.**

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: confirm the human STOP at the top of the file
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/hero-badges-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/43-hero-badges-contract.log
```

**Expected output.** Three healing `UPDATE`s (likely 0 rows each), then `ALTER TABLE` ×4,
`CREATE INDEX` ×2, `COMMIT`, then W1–W8.

**Gate.** All of:
- The v2 deploy is **loaded and confirmed**: the live home page chips render (the `Golang` chip
  still reads **Golang**), `/hero` and `/icons` open, and one badge edit saved. Not "the build went
  green".
- **GUARD C3** must not raise. If it does, it names the row: create the missing `Skill` through the
  v2 admin's skill picker, or delete the badge, then re-run. **Aborting drops nothing.**
- **GUARD C4** must not raise (duplicate `(version, skillId)` pairs).
- The trigger drop is **first and inside this transaction**, not for tidiness: plpgsql is
  late-bound, so `DROP COLUMN "name"` would **succeed** with the trigger installed and then every
  subsequent badge `INSERT` would die with `record "new" has no field "name"`. W-block asserts it.

**Undo — two passes.** The FK, the `NOT NULL` and the unique index drop cleanly.

1. **Shape and the approximate values**, in one transaction: the `REVERSE OF CONTRACT` block at the
   foot of `hero-badges-contract.sql`, verbatim. It re-adds both columns, fills `name` as
   `COALESCE(label, skill.name)` — which is **exact**, because `label` carried every override — and
   fills `iconKey` from `Skill."iconKey"`, which is **not**. Filling both is what lets the same
   transaction restore their `NOT NULL`.
2. **The true per-badge `iconKey`**, out of the Step 7 dump. This is the executable form of what used
   to read "for the real values, read the Step 7 dump", and Step 8b rehearses it on this exact table:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
jq -r -f v2-production/recover-from-dump.jq \
   --arg table HeroSkillBadge --arg key id --arg cols 'iconKey' --arg mode update \
   backups/PRE-CUTOVER-<stamp>.json > /tmp/v2/prod/recover-badge-iconkey.sql
less /tmp/v2/prod/recover-badge-iconkey.sql      # read it, then apply it like any contract file
```

Pass 2 is an `UPDATE` of an already-`NOT NULL` column, so it cannot reintroduce a `23502` and needs no
special ordering. Run it anyway even when Step 20's P7 reported no drift — it costs one transaction
and removes the only remaining guess. A badge **created after the Step 7 dump** is absent from the
generated file; the guard names it and aborts, and for those rows pass 1's skill-icon value is all
there is. Full text and caveats: the ROLLBACK and `REVERSE OF CONTRACT` blocks of
`hero-badges-contract.sql`.

---

## Step 44 — CONTRACT: skills-joins

**What it does.** Drops the four mirror triggers **in the right order**, drops
`_ExperienceToSkill` and `_ProjectToSkill`, drops the mirror functions, drops the
`skill_show_sync` trigger **before** its column, and drops `Skill.show`.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the human STOP at the top
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/skills-joins-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/44-skills-joins-contract.log
```

**Expected output.** Triggers dropped, two `DROP TABLE`, four `DROP FUNCTION`, one `DROP COLUMN`,
`COMMIT`, then C1–C8.

**Gate.** **Order is load-bearing twice, and both are runtime failures, not errors here:**
1. The **reverse** mirror triggers must be dropped **before** the tables. Their plpgsql bodies name
   `_ExperienceToSkill`/`_ProjectToSkill`, and plpgsql bodies are **not** dependency-tracked, so
   `DROP TABLE` would succeed and leave them live — after which every v2 write
   (`apps/docs/.../experiences.ts:87` `tx.experienceSkill.createMany`, `projects.ts:99`) fails
   `42P01` and rolls back the operator's save.
2. `skill_show_sync` must be dropped **before** `Skill.show`. `DROP COLUMN` does **not** drop a
   `BEFORE ROW` trigger with no column list, so dropping the column first leaves a trigger
   referencing `NEW."show"` and makes **every** v2 INSERT/UPDATE on `Skill` fail with
   `record "new" has no field "show"` — taking out the entire staged-save batch.

**C6/C7 must return 0 rows.** A leftover trigger or function there means a v2 write is about to
fail. Also confirm, before running: you have saved one experience **and** one project through the
v2 admin (Step 36) and forced a regeneration (Step 34).

**Undo.** Section **R2** of the same file: recreate `show` and backfill from `showInGrid`, recreate
both implicit tables with the exact DDL from
`packages/db/prisma/migrations/20260307195336_init/migration.sql:192-201` (two AB primary keys, two
`_B_index` indexes, four CASCADE FKs), refill by `INSERT ... SELECT` from the explicit tables, keep
the explicit tables, re-create the EXPAND triggers, then redeploy the v1 commit. R2 deliberately
does **not** drop the two unique indexes — v1 tolerates them, the data satisfies them, and keeping
them makes a retry smaller.

---

## Step 45 — CONTRACT: experience-education

**What it does.** Drops both sync triggers and their functions **first**, then
`Experience.startDate`/`endDate`/`isCurrent`, then — **guarded** — `Education.startYear`/`endYear`,
then the two `updatedAt` defaults, then the three `v2_*` helper functions.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: gate on all six by hand, then preflight C1
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/experience-education-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/45-experience-education-contract.log
```

**Expected output.** Triggers dropped, `DROP COLUMN` ×3 on `Experience`, a `DO $$` block that
either drops the two `Education` text columns or `RAISE NOTICE`s that option B was used, two
`DROP DEFAULT`, three `DROP FUNCTION`, `COMMIT`.

**Gate.** Six human gates, all of them: both apps Ready on the new commit; the public timeline shows
`Wiingy — July 2025 – Present` and `Nykaa — January 2025 – July 2025` with a **7-month** tenure; the
About terminal shows `2021 — 2025`; admin `/experiences` and `/about` both load; **one unchanged
save through the admin experience form** (the only proof a v2 write works); and a fresh dump — you
have that from Step 38.

**Preflight C1 is the important one:** 0 disagreements between old and new on **both** tables. If it
is not 0, something wrote around the trigger and dropping the columns destroys the only correct copy.

The triggers must go **first**: PL/pgSQL resolves record fields at execution time, so a trigger that
outlives its columns raises `record "new" has no field "startDate"` on the next admin save. The
`Education` guard makes it **impossible** to delete the data if EXPAND option B was taken.

**This step is what ends Vercel instant-rollback for the timeline** — v1 reads the dropped columns
(`HEAD:apps/web/app/lib/data.ts:199-201` and `:173-174`) and a rolled-back v1 throws `P2022` on the
landing page and the admin. Nothing here is urgent; wait as long as you want the escape hatch.

**Undo.** Re-creation, not undo:
```sql
ALTER TABLE "Experience" ADD COLUMN "startDate" TEXT, ADD COLUMN "endDate" TEXT,
                         ADD COLUMN "isCurrent" BOOLEAN;
UPDATE "Experience" SET "startDate" = to_char("startedOn",'FMMonth YYYY'),
       "endDate" = COALESCE(to_char("endedOn",'FMMonth YYYY'),'Present'),
       "isCurrent" = ("endedOn" IS NULL);
-- then SET NOT NULL on the two strings; the same shape for Education's two text
-- years; restore DEFAULT CURRENT_TIMESTAMP on both updatedAt; re-create the
-- helpers and both triggers if v1 and v2 must coexist again.
```
Honest caveats: strings come back **canonically spelled**, so a hand-typed `Jan 2025` returns as
`January 2025` (production holds only canonical strings today, so it is exact right now), and it
reinstates `isCurrent = true` for a role whose end was merely unknown. The Step 38 dump is the real
undo for row data.

---

## Step 46 — CONTRACT: projects

**What it does.** Drops both gallery triggers and the function, then
**`ALTER TABLE "Project" DROP COLUMN "images"`** — the only column this cluster removes and the only
statement in it no v1 process can survive.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the step-0 GATE
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/projects-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/46-projects-contract.log
```

**Expected output.** Two `DROP TRIGGER`, one `DROP FUNCTION`, one `DROP COLUMN`, `COMMIT`, then
C1–C5. After this, `Project` matches `target-ddl.sql` exactly: **13 columns, no `images`**.

**Gate.** The step-0 gate raises unless `ProjectImage` exists, `_v2_backup_project_images` exists
(**otherwise the drop is irreversible**), no project has a non-empty array with no backup row, and
no project has a non-empty array with **zero** `ProjectImage` rows. That last one cannot distinguish
"never migrated" from "a v2 admin emptied it on purpose", so it stops and makes you look; the
override is to set that project's backup row to `'{}'` and re-run.

Both triggers must be dropped **explicitly**, and for two different reasons. The UPDATE trigger
names `images` in its `UPDATE OF` list, which Postgres tracks as a `DEPENDENCY_AUTO` edge, so
`DROP COLUMN` would **silently take it**. The INSERT trigger names `images` only in its `WHEN`
clause and inside the plpgsql body, and **plpgsql bodies are not dependency-tracked at all** — if
it survives the drop, the next v2 `createProject` aborts at runtime on the missing field and the
admin cannot create a project. **C2 asserts both are gone.**

**This is the one place ISR hurts rather than helps.** `readProjects` asks for `Project`'s full
scalar list and its `unstable_cache` entry lives 86400s under tag `projects`. If this `DROP COLUMN`
lands while **any** v1 render can still regenerate that entry — an in-flight request on the old
bundle, or `apps/web` deployed while `apps/docs` is not — that regeneration fails `42703` and the
home page 500s. Step 32's drain and Step 31's both-projects gate are what prevent it. Confirm again
that all six cards render a cover before you run this.

**Undo.** Re-add the column and repopulate, preferring the live gallery and falling back to the
backup, resolving any v2-authored `assetId` row through `MediaAsset.url` — the commented block at
the end of `projects-contract.sql`. Then assert **zero NULL elements** (v1's required `String[]`
cannot represent one) and re-arm the EXPAND step 10 shim before letting a v1 admin write again.
Be honest that a v1 rollback after any v2 admin save is lossy for reasons outside this cluster: v2
writes skills to `ProjectSkill`, which the v1 client cannot read at all.

---

## Step 47 — CONTRACT: blogs

**What it does.** A `LEAST()` preservation step, the status-based `publishedAt` null-out,
`publishedAt DROP DEFAULT`, the empty-string `image` normalisation, and **`DROP COLUMN "show"`**
as the **last** statement.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: C0 + C1. C1 RAISE NOTICEs every stamp about to be
                                      # discarded, including any post created during the window.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/blogs-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/47-blogs-contract.log
```

**Expected output.** `UPDATE 0` on the `LEAST()` step, `UPDATE 10` on the null-out (plus one per
post created in the window), `UPDATE 0` on the image normalisation, one `DROP COLUMN`, `COMMIT`.

**Gate.** All of:
- Public `/` and `/sitemap.xml` return 200; admin `/blogs` `/dashboard` `/site-config` `/terminal`
  `/media` all return 200; and the admin blogs list prints **"no date yet"** for the ten drafts.
- The null-out predicate is **status-based** (`WHERE "status" IN ('DRAFT','SCHEDULED') AND
  "publishedAt" IS NOT NULL`), **not** the draft's `WHERE "publishedAt" = "createdAt"`. A post
  created by v1 in the window has two stamps from two different clocks — Prisma's engine clock and
  the database's `CURRENT_TIMESTAMP` — milliseconds apart and never equal, so the draft's predicate
  would leave it a spurious publish date **forever**.
- In-transaction assertions: zero DRAFT/SCHEDULED rows still carrying a stamp, zero PUBLISHED rows
  that lost one, `createdAt` still NOT NULL, zero empty-string images, zero rows with both cover
  sources, the 5/3/2 orientation split unmoved, the ten seed `createdAt` values still inside
  `2026-03-08 07:24:25.397..981`, `show` gone, 15 columns, `publishedAt` with **no** default.

**`DROP COLUMN "show"` is last on purpose** so an abort anywhere above leaves the rollback door
open. **If you want to keep Vercel instant rollback for a day, run everything above it and hold
this one statement back.** It costs nothing but schema drift.

No cache flush is needed: all ten posts are DRAFT, so none is in any public ISR entry or data-cache
payload. If you **did** publish during the window, `revalidateTag('blogs')` and
`revalidateTag('blog:<slug>')`.

**Undo.** Two passes, same shape as Step 43. First the blanket restore, in one transaction:
`ADD COLUMN "show" BOOLEAN NOT NULL DEFAULT true; UPDATE "Blog" SET "show" = false;` — faithful
**today** because all ten rows held `false`, and the `DEFAULT true` means the column is `NOT NULL`
from the start so nothing can raise `23502`. Then the per-row values, which are in the dump and now
have a command:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
jq -r -f v2-production/recover-from-dump.jq \
   --arg table Blog --arg key id --arg cols 'show' --arg mode update \
   backups/PRE-CONTRACT-<stamp>.json > /tmp/v2/prod/recover-blog-show.sql
less /tmp/v2/prod/recover-blog-show.sql           # read it, then apply it like any contract file
```

Use the **Step 38 PRE-CONTRACT** dump, not Step 7's: a post created during the window exists only in
the later one, and that is exactly the row whose `show` the blanket `UPDATE` would get wrong.
`publishedAt` comes back from `createdAt` (identical for the ten seed rows). A post published
**after** this step is restored by neither.

---

## Step 48 — CONTRACT: analytics

**What it does.** Three stages. Stage 1 drops `AnalyticsSession.lastSeenAt`, `AnalyticsEvent.meta`,
`DailyStat.id` and six unused indexes. Stage 2 rebuilds `EventType` down to two labels — **the only
table rewrite in the cluster**. Stage 3 **renames** `UtmTracker` rather than dropping it.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: STAGE 0, reads only. Re-assert ZERO AnalyticsEvent
                                      # rows outside ('PAGEVIEW','SECTION_DWELL') -- /api/collect is
                                      # UNAUTHENTICATED and the v1 build in the window WOULD have
                                      # written a posted CLICK. Do not trust the dump for this.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/analytics-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/48-analytics-contract.log
```

**Expected output.** Three `COMMIT`s.

**Gate.** Four:
- **A `RollupRun` row with `status = 'ok'` and `createdAt` after the deploy.** Per Step 37 this may
  take hours. **Do not confuse "nothing has failed" with "nothing has run".** v2 collect returns
  204 on every error, so silence is not success.
- The admin analytics dashboard renders (`readAnalytics` is the widest single reader here, touching
  five of these tables in one `Promise.all`), and `/tracker` renders.
- `max(AnalyticsSession.startedAt)` and `max(AnalyticsEvent.createdAt)` both move after a real visit.
- The zero-row `EventType` gate. If a stray row appears: nothing reads an individual
  `AnalyticsEvent` row and the rollup counts only `PAGEVIEW` and `SECTION_DWELL`, so `DELETE` it,
  then re-summarise that day from the admin (the upsert is idempotent).

**Optional and worth it:** flip the `analytics.enabled` flag **off** before stage 2 and back on
after. While it is off, `collect/route.ts:110` returns before touching Postgres, so the
`ACCESS EXCLUSIVE` window on the rewrite is **provably empty** and the public site only loses a
beacon.

`DROP TYPE "EventType_old"` has **no `CASCADE`** — on a type, `CASCADE` drops the dependent
**columns**. If it errors, the message names the straggler. **Not dropped anywhere:**
`AnalyticsEvent.label` — v2 still writes it, so dropping it now would fail every collect
transaction inside the catch that returns 204.

**Undo.** Restores the shape but not three values. `UtmTracker` comes back **exactly** (rename
back) — which is why stage 3 is a rename: `analytics-read.ts:258`'s `utmTracker.count()` sits inside
`readAnalytics`'s `Promise.all`, so its absence takes down the whole admin dashboard, and
`track/utm/route.ts:95,:103` would 500 on the **public origin** for every pageview. `EventType`
widens with `ALTER TYPE ADD VALUE IF NOT EXISTS`. `meta` comes back empty (lossless — it was
non-null on zero rows). `DailyStat.id` comes back with **fresh uuids** (nothing ever referenced the
old ones). `lastSeenAt` comes back reading `CURRENT_TIMESTAMP`, then the real values come back **from
the Step 38 dump**, same shape as Steps 43 and 47:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
jq -r -f v2-production/recover-from-dump.jq \
   --arg table AnalyticsSession --arg key id --arg cols 'lastSeenAt' --arg mode update \
   backups/PRE-CONTRACT-<stamp>.json > /tmp/v2/prod/recover-lastseenat.sql
```

It is **not unrecoverable** — it is in the Step 38 dump like everything else, and it is cosmetic
besides, since neither version reads it. Sessions created *after* that dump are the only rows the
generator cannot cover, and the guard names them rather than silently skipping them. Keep
"unrecoverable" for the case that genuinely is: the `AdminRole` `ALTER TYPE ADD VALUE` at
contact-admin-audit T0.

`AnalyticsSession` is the **largest** table anything in this runbook points the generator at — check
`jq '[.tables[]|select(.name=="AnalyticsSession").rows|length]'` on the dump first. One `UPDATE` per
session means the generated file stops being something you can read end to end somewhere in the low
thousands, and "read it before you apply it" is the whole safety model. For a cosmetic column, the
honest answer at that size is to not bother.

---

## Step 49 — CONTRACT: settings. After C4, v1 cannot serve any route.

**What it does.** C1 drops the resync trigger **and both functions**. C2–C4, one transaction:
a guard, `CREATE SCHEMA legacy_v1`, and `ALTER TABLE public."SiteConfig" SET SCHEMA legacy_v1`.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: GATES 1-5 at the top of the file
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/settings-contract.sql \
  2>&1 | tee /tmp/v2/prod/log/49-settings-contract.log
```

**Expected output.** C1 commits. GATE 4 returns 1 row, `id = 1`, `not_all_defaults = t`,
`written_by_v2_recently = t`. GATE 5 returns 26 `SiteConfig` rows. C2–C4 commit.

**Gate.** All five gates in the file:
1. Both Vercel projects Ready and promoted, and a few minutes of drain.
2. Force `revalidateTag('site-config')`, hard-reload, and confirm name, navbar logo, avatar, photo
   deck, availability pill, dot colour and background layer. **A 500 here means v2 cannot read
   `SiteSettings`: STOP.** Rollback is still free at that point — `SiteConfig` is untouched.
3. `/site-config`, `/background`, `/hero`, `/cat`, `/contact-purposes` and `/projects` all render,
   and one save round-trips. That save is the proof the v2 **write** path works, because
   `apps/docs/.../site-config.ts:61` is an **update**, not an upsert.
4. GATE 4's SQL.
5. GATE 5: eyeball the 26 rows. **This is the last time they exist in `public`.** From DEPLOY onward
   the two tables are *allowed* to disagree — nothing in v2 writes `SiteConfig`.

**C1's function drop is not tidiness.** A plpgsql body is not dependency-checked, so after C4
`site_settings_resync_v2()` would survive as a **callable, broken** function — and while
`SiteConfig` still exists it is **one `SELECT` away from reverting every setting v2 has written.**
C1 is the only statement in this file that v1 survives.

**The price of that drop is that C1's undo is two blocks, not one, and the undo note used to name
only one of them.** C1 drops **three** objects — the trigger `SiteConfig_resync_v2`, the trigger
function `site_settings_resync_v2_trg()` and the worker `site_settings_resync_v2()`
(`settings-contract.sql:128-130`). STEP B of `settings-expand.sql` recreates only the first two, and
the trigger function's whole body is `PERFORM public.site_settings_resync_v2()`
(`settings-expand.sql:583`). plpgsql resolves that call **at execution time, not at creation time**,
so re-running STEP B alone *succeeds* and looks like a clean undo — and then the next
`INSERT`/`UPDATE`/`DELETE` on `SiteConfig` raises `42883 function
public.site_settings_resync_v2() does not exist` inside the statement-level trigger. On a v1
rollback that is **every admin settings save**: Prisma surfaces it as `P2010` and aborts the whole
23-upsert transaction, so the admin cannot change any setting at all. The worker function has to
come back first. That is what the undo below does.

**C4 is fatal to v1 from that instant.** Every public route 500s (`42P01` inside the root layout),
the nine v1 admin read sites 500 the same way, and both v1 writers fail `P2021`. v2 is unaffected:
`git grep prisma.siteConfig` on the working tree returns nothing; the only surviving `siteConfig`
identifiers are the cache tag at `packages/shared/src/tags.ts:6` and a local variable in
`apps/web/app/page.tsx`.

**Undo.** Two cases. **Neither of them is "re-run STEP B".**

**Between C1 and C4** nothing has moved, so the undo is to put the dual write back — all three
objects, worker function first, in **one** transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
-- 1. the worker, verbatim from settings-expand.sql A5 (lines 379-502): the whole
--    CREATE OR REPLACE FUNCTION public.site_settings_resync_v2() ... $fn$; block.
--    Copy it; do NOT re-run the rest of STEP A, which also creates types and a
--    table and runs a backfill.
-- 2. then STEP B's body (settings-expand.sql:580-593) WITHOUT its own BEGIN/COMMIT:
--    CREATE OR REPLACE FUNCTION public.site_settings_resync_v2_trg() ...
--    DROP TRIGGER IF EXISTS "SiteConfig_resync_v2" ON public."SiteConfig";
--    CREATE TRIGGER "SiteConfig_resync_v2" AFTER INSERT OR UPDATE OR DELETE
--      ON public."SiteConfig" FOR EACH STATEMENT
--      EXECUTE FUNCTION public.site_settings_resync_v2_trg();
COMMIT;
```

Then **prove it**, because a trigger that raises `42883` looks identical to a working one until
something writes. **Do not "test" it by calling the worker for real.** Between C1 and C4, `SiteConfig`
is frozen at the last v1 save while `SiteSettings` holds everything v2 has written since, and the
worker copies `SiteConfig` **→** `SiteSettings`. A bare `SELECT site_settings_resync_v2();` there is
the exact "one `SELECT` away from reverting every v2 setting" that C1 exists to prevent. Probe it
inside a transaction you throw away:

```sql
SELECT proname FROM pg_proc WHERE proname LIKE 'site_settings_resync_v2%' ORDER BY 1;
-- expect BOTH rows: site_settings_resync_v2, site_settings_resync_v2_trg.
-- One row is the 42883 trap, restored.

SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'public."SiteConfig"'::regclass AND NOT tgisinternal;
-- expect: SiteConfig_resync_v2 / O

BEGIN;
  SELECT public.site_settings_resync_v2() AS rows_would_change;   -- a number, not 42883
ROLLBACK;                                                          -- MANDATORY
```

The `ROLLBACK` is what makes that probe legal. A non-zero `rows_would_change` is not an error — it is
the size of the divergence you are about to have to reconcile by hand, and it is worth writing into
the run log before you throw it away.

One transaction, worker first, is the point: the two functions and the trigger are a unit, and the
only failure mode this step has is putting back two of the three. `CREATE OR REPLACE` on both makes
the block re-runnable, and the `DROP TRIGGER IF EXISTS` in front of the `CREATE TRIGGER` is what
keeps a retry from failing with `42710`. Zero data risk either way — no column, type or row changes.

**After C4 and before Step 56**, the schema move comes first, then the same block:

```sql
BEGIN; ALTER TABLE legacy_v1."SiteConfig" SET SCHEMA public; COMMIT;
```

which makes v1 servable again **with the original uuid ids intact**. That order is not optional: the
worker's body reads unqualified `"SiteConfig"`, so recreating it while the table is still in
`legacy_v1` gives you a function that creates fine and then raises `42P01` on first call — the same
trap as above, one table further down. Re-install the dual write only if you are also reverting the
code deploy. Either way `SiteConfig` is then **STALE** with respect to anything the admin saved while
v2 was live, because no reverse trigger is installed (deliberately). **Reconcile from `SiteSettings`
by hand before trusting the v1 site** — and note that the resync runs in the *wrong* direction for
that job: it copies `SiteConfig` → `SiteSettings`, so installing it before you reconcile would
overwrite v2's values with v1's stale ones. Reconcile first, install second.

---

# STAGE 6 — VERIFY CONTRACT

## Step 50 — Drift check: this should now be empty

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:verify --from=PROD_DATABASE_URL 2>&1 | tee /tmp/v2/prod/log/50-drift-after-contract.log
date -u +'FREEZE-2 END %H:%M:%SZ' | tee -a /tmp/v2/prod/log/00-timeline.log
```

**Expected output.** Clean, apart from:
- The two whitelisted opclass indexes (`MediaAsset_key_prefix_idx`, `NoteNode_path_prefix_idx`) —
  `scripts/verify-schema.ts:34` already filters these.
- A proposed `DROP INDEX "Skill_name_lower_key"` — **never apply it.**
- `DROP TABLE "_v2_backup_project_images"` — deliberately not a Prisma model; Step 56 removes it.
- `DROP SCHEMA legacy_v1` should **not** appear: the datasource declares no `schemas` list, so
  Prisma introspects `public` only and nothing parked there is visible to `migrate diff`.
- `Skill.showInGrid` may report a **column-order** difference (last instead of fourth). Prisma does
  not compare ordinal position; if your diff tool does, ignore it.

**Gate.** Nothing in the output you cannot name. Anything else is **S12**.

**Undo.** N/A — read-only.

---

## Step 51 — Full smoke, public and admin

**Command.**

```bash
curl -s -X POST https://www.yatindora.in/api/revalidate \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" -H 'content-type: application/json' -d '{}'
sleep 10
for p in / /sitemap.xml /blog /robots.txt; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "https://www.yatindora.in$p"
done
```

Then repeat, in full and in this order:
- **Step 35's page list**, including the log-out / log-back-in that opens it. `AdminUser` lost
  nothing in CONTRACT, but this is the last chance to find out cheaply.
- **Step 36's fifteen writes.** Every row, not a sample. The three that matter most *after* CONTRACT
  are the ones whose v1 column is now gone: `/about` (Education, `startYear` dropped at Step 45),
  `/messages` mark-read (`ContactMessage.read` dropped at Step 39) and `/hero` badges
  (`iconKey` dropped at Step 43).
- **Step 37b's two irreversible writes, again.** They were proved before CONTRACT; this proves
  CONTRACT did not break them. `MediaAsset` and `MessageReply` are both touched by contract files.
- Submit the public contact form once and confirm the message appears in `/messages`.
- **Step 34's render checklist**, last, so the page you look at reflects every write above.

**Expected output.** All 200, everything renders, every write succeeds.

**Gate.** Everything. This is the acceptance test for the whole cutover. If you deferred Step 37b —
against its instruction — then this is the **first** exercise of the R2 and SMTP paths, it is
happening past Step 43, and a failure here has no free rollback. Note that in the run log before you
start, so the next reader knows which of the two situations they are in.

**Undo.** There is no clean undo at this point. If something is wrong, fix it forward; the Step 38
dump is the floor.

---

## Step 52 — Post-cutover dump

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:dump --from=PROD_DATABASE_URL --out=backups/POST-CUTOVER-$(date -u +%Y%m%dT%H%M%SZ).json
jq '.tables | length' backups/POST-CUTOVER-*.json
jq '[.tables[].rows | length] | add' backups/POST-CUTOVER-*.json
```

**Expected output.** 43 base tables in `public` (the dump reads
`table_schema = 'public'`, so `legacy_v1."SiteConfig"` is **correctly absent**). Row totals in line
with Step 38 minus the retired tables.

**Gate.** The dump completes and is stored off-machine. **This dump is the prerequisite for the soak
drops in Step 56.** Verify it restores into a scratch branch exactly as in Step 8.

**Undo.** N/A.

---

# STAGE 7 — POST-CUTOVER

## Step 53 — What to watch, and for how long

**What it does.** Defines "stable" so you know when you are allowed to delete things.

**Watch for 7 days:**

| Watch | How | Why |
|---|---|---|
| Public 500s | Vercel function logs on `apps/web`, filtered to 5xx | The ISR window is 86400s. **A page can serve stale HTML for a full day**, so a schema mismatch may not surface until tomorrow's regeneration. **Do not call this stable before 24 hours have passed.** |
| The rollup is advancing | `select "status","triggeredBy","createdAt" from "RollupRun" order by "createdAt" desc limit 20;` | `rollupDay`'s `catch` turns a failure into a row with `status='error'` and a **204** from `/api/collect`. The dashboard quietly stops advancing **and** `summarisedThrough` pins the retention floor, freezing the 90-day event prune. No alert exists. |
| Retention is running | `select * from "MaintenanceState";` | `lastRunAt` is bumped **before** the body runs, so a throwing task is locked out for its full interval — **24 hours for retention** — with the only evidence an `error:` prefix in `lastResult`. |
| Scheduled publishing | `select "status","publishAt","publishedAt" from "Blog" where "status"='SCHEDULED';` | Rides the same visitor beacon. No cron. |
| The GitHub tile | Load the home page | The refresh fires inside `after()` on an ISR regeneration. A failing `GithubYear` FK would retry forever, costing an outbound fetch each time, with the tile never appearing. |
| `SiteSettings` has not drifted | `select "updatedAt" from "SiteSettings";` | It should move only when you save. |
| The audit trail | `/history` | Confirms v2 writes all five retyped `AuditEvent` columns. |
| R2 orphans | `/media` bucket view | Any upload that failed mid-flight during either freeze left bytes in the bucket. Re-adopt or delete them. |
| **Silent flag failure** | Vercel function logs on `apps/web`, filtered to the literal string **`[flags] read failed`** | This is the one schema failure that produces **no** visible symptom. `apps/web/app/lib/flags.ts:15-17` catches its own error and returns `defaultFlagMap()`, so a broken `FeatureFlag` read serves registry defaults on a page that looks perfect. No 5xx, no missing section. The log line is the only evidence. |
| **The build still prerenders** | The `Generating static pages (N/N)` line in every `apps/web` deployment log | `next build` reads the database (Step 4). Every future deploy is therefore also a schema test — and the first one to fail will fail *at build*, before it can reach the public. Treat a red build here as good news, and check `N` against the value from Step 31 / Step 55. |

**Gate for "stable".** 7 days with: no public 5xx attributable to schema, **zero `[flags] read
failed` lines**, at least three `RollupRun` rows with `status='ok'`, `MaintenanceState.lastResult`
with no `error:` prefix on any key, and one successful scheduled publish or a deliberate manual one.

**Undo.** N/A.

---

## Step 54 — Reconcile `_prisma_migrations`

**What it does.** Every file in this runbook was **hand-run**, so `_prisma_migrations` knows about
none of it. The next `prisma migrate dev` will try to create `SiteSettings` again.

**HARD PREREQUISITE — read before you type anything.** Do not run this step until **both** Vercel
dashboard build commands are known to be free of `prisma migrate deploy`. That is Step 3's run-log
entry, and Step 55 is what actually strips them. The reason is an ordering hazard in the original
draft of this step, which said "committing the files you actually ran, then mark each applied":

> Committing `prisma/migrations/<ts>_<cluster>_v2_contract/migration.sql` triggers a deploy. If
> either dashboard build command runs `prisma migrate deploy`, that deploy **executes the contract
> files against an already-contracted production**. The EXPAND files are largely `IF NOT EXISTS`- and
> `DO $$`-guarded and would mostly no-op. The CONTRACT `DROP COLUMN`s are **not guarded** — they
> would run a second time, and `DROP COLUMN` without `IF EXISTS` raises, which fails the build, while
> any that *do* carry `IF EXISTS` silently succeed on columns that were re-created by a rollback.
> Step 31's gate explicitly tolerates a `migrate deploy` in the dashboard command for the first
> deploy. This step is where that tolerance turns into a weapon.

So: **resolve first, commit second.** The migration directories exist on disk, uncommitted, for the
whole of the resolve pass.

**Command — in this order.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db

# 1. Create the directories WITHOUT committing them. One pair per cluster,
#    holding the exact bytes you ran from /tmp/v2/prod/:
#      prisma/migrations/<timestamp>_<cluster>_v2_expand/migration.sql
#      prisma/migrations/<timestamp>_<cluster>_v2_contract/migration.sql
#    Timestamps must sort AFTER 20260822130000_add_links_rollup_media, the
#    newest of the 24 existing migrations.
git status --porcelain prisma/migrations        # they must all show as ?? untracked

# 2. Record them as applied WITHOUT running them. `resolve --applied` only
#    inserts a _prisma_migrations row; it never executes the file.
for name in $(ls prisma/migrations | grep '_v2_\(expand\|contract\)$'); do
  echo "resolving $name"
  DATABASE_URL="$PGPROD" bunx prisma migrate resolve --applied "$name" || break
done

# 3. Verify the table, BEFORE the commit. (see the read-only probe below)

# 4. ONLY NOW commit the directories.
git add prisma/migrations && git commit
```

**Step 3's read, explicitly.** `psql` is not installed, and the probe in Step 21.3 deliberately
**refuses the production host** — do not delete that line to get past this. Reading
`_prisma_migrations` on production is a legitimate need, so use a *different*, narrower tool: a probe
that accepts production but can only ever read. It admits a single statement beginning with `select`,
and it sets `default_transaction_read_only = on` before issuing it, so the server itself rejects a
write even if the regex were wrong.

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
TARGET=PROD_DATABASE_URL Q='select "migration_name", "finished_at", "applied_steps_count"
  from "_prisma_migrations" order by "started_at" desc limit 30' bun -e '
import "dotenv/config";
import { Client } from "pg";
const q = process.env.Q!.trim();
if (!/^select\b/i.test(q) || /;/.test(q.slice(0, -1))) {
  console.error("refusing: this probe accepts one SELECT and nothing else");
  process.exit(1);
}
const u = process.env[process.env.TARGET!]!;
const h = (x: string) => new URL(x.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
console.log("READ-ONLY probe against", h(u));
const c = new Client({ connectionString: u });
await c.connect();
await c.query("set default_transaction_read_only = on");
console.table((await c.query(q)).rows);
await c.end();
'
```

**Expected output.** 24 pre-existing migrations (`ls prisma/migrations | wc -l` is 25 today: 24
directories plus `migration_lock.toml`) plus one row per new directory, every row with a
`finished_at` and `applied_steps_count = 0`. A `0` there is correct and is the signature of
`resolve --applied` rather than a real run.

**Gate.** Three:
- `bun run db:verify --from=PROD_DATABASE_URL` is still clean (Step 50's known-pendings only).
- No deploy was triggered between step 1 and step 3. If one was — someone pushed, or a preview
  branch merged — check its build log for `migrate deploy` before touching anything else.
- **The recorded history actually reproduces the live schema.** This is the check that catches a
  migration directory whose bytes differ from what you ran. The reviewer-suggested form of this
  command **does not work**; verified:
  ```
  $ bunx prisma migrate diff --from-migrations ./prisma/migrations \
      --to-schema ./prisma/schema.prisma --exit-code
  Error: You must set `datasource.shadowDatabaseUrl` in your `prisma.config.ts`
         if you want to diff a migrations directory.
  ```
  `--from-migrations` replays the whole history into a shadow database, so it needs one.
  Do it deliberately and on something disposable:
  1. Cut a **fresh, empty** Neon branch. Put its URL in `.env` as `SHADOW_DATABASE_URL`.
  2. Temporarily add to `prisma.config.ts`'s `datasource` block:
     `shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),`
  3. `bunx prisma migrate diff --from-migrations ./prisma/migrations --to-schema
     ./prisma/schema.prisma --exit-code` → **exit 0 / "No difference detected"**. Exit 2 means the
     files you committed do not add up to `schema.prisma`; read the diff and fix the *files*, never
     the database.
  4. Revert the `prisma.config.ts` edit and delete the shadow branch. **Never point
     `shadowDatabaseUrl` at production or at the staging branch — Prisma drops and recreates
     everything in a shadow database.**

  Two known-acceptable entries in that diff, the same two `db:verify` always reports:
  `MediaAsset_key_prefix_idx` and `NoteNode_path_prefix_idx` (`scripts/verify-schema.ts:37` —
  `prisma db pull` cannot see a btree operator class). Anything else is real.

**Nothing at runtime consults `_prisma_migrations`** — this is bookkeeping, off the critical path,
and safe to defer. Deferring it is *safer* than doing it early, for the reason in the prerequisite.

**Leave the repo in a state where nobody can run `prisma db push`.** It would silently remove
**every CHECK constraint** and **drop `Skill_name_lower_key`**. Prefer `migrate deploy`. Consider a
guard in the `db:push` script.

**Undo.** `DATABASE_URL="$PGPROD" bunx prisma migrate resolve --rolled-back <name>` for each, and
`git reset --soft HEAD~1` if you had already committed. Deleting the directories after resolving
leaves orphan `_prisma_migrations` rows, which is harmless but confusing — roll back first, then
delete.

---

## Step 55 — Strip the Vercel dashboard build command

**What it does.** Makes the build fully reproducible from git, which was the whole point of Step 4.

**Command.** Not SQL. In both Vercel dashboards, set the Build Command back to the repo default (or
explicitly `turbo run build --filter=web` / `--filter=docs`) and clear the custom Install Command,
**then trigger one deploy and read the log.**

**Expected output.** The build log shows `db#build` running `prisma generate` from the **turbo
graph**, with no dashboard command involved, and both apps build. The `web` log again shows
`Generating static pages (N/N)`.

**Gate.** Five:
- Both projects reach Ready and Step 51's smoke still passes.
- `DATABASE_URL` is still present in the Production **build** environment. `prisma.config.ts`
  resolves `env("DATABASE_URL")` at config load and fails without it even though generate never
  connects — **and separately, `next build` does connect and read** (Step 4, gate 2), so this
  variable is load-bearing twice over, for two different reasons.
- `REVALIDATE_SECRET` is still ≥ 32 characters in the Production build environment. It is validated
  at module load in `packages/config/src/env.ts:13`, during the prerender, so a build that lost it
  fails here with `Invalid environment variables` and nothing about the message says "Vercel
  setting".
- **`N` in `Generating static pages (N/N)` equals the `N` you wrote down at Step 31**, unless you
  published a blog post in between. A different `N` with no publish behind it means the dashboard
  command you just removed was doing something to the build you did not know about — read the whole
  log before promoting.
- This is the **first deploy that runs without the dashboard command**, so it is also the first that
  cannot have silently re-run a `migrate deploy`. Re-run Step 50's drift check and, if you have
  reached Step 54, the `_prisma_migrations` read from Step 54 step 3: both must be unchanged.

**Undo.** Restore the original commands from your Step 3 run-log entry.

---

## Step 56 — The soak drops. Only after Step 53's "stable" gate and Step 52's verified dump.

**What it does.** Destroys the last copies. **Do these as three separate, deliberate acts on
different days, not in one session.**

**Command.**

```bash
# 56a. SiteConfig. Keep for at least one full 86400s cache lifetime
#      (apps/web/app/lib/data.ts:8). It is 26 rows and the ONLY remaining copy
#      of heroVersion, intro and tagline as v1 stored them. RESTRICT on both,
#      no CASCADE: if something depends on it, the error is the information,
#      and a plain DROP SCHEMA refuses if another cluster parked a table there.
psql "$PGPROD" -v ON_ERROR_STOP=1 -c 'BEGIN; DROP TABLE legacy_v1."SiteConfig"; DROP SCHEMA legacy_v1; COMMIT;'

# 56b. UtmTracker, once a revert to v1 is genuinely off the table.
psql "$PGPROD" -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS "UtmTracker__retired_v2";'

# 56c. The projects array-rollback path. This is what finally makes
#      migrate diff come back completely empty.
psql "$PGPROD" -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS "_v2_backup_project_images";'
```

**Expected output.** Three `DROP`s.

**Gate.** Before each: Step 53's stable gate met, and the Step 52 dump **verified by restoring it**
into a scratch branch (Step 8's procedure). After 56a, `git grep prisma.siteConfig` on the working
tree must still return nothing.

**Undo.** All three are "recreate the shape, then reload the rows from a dump", and **`bun run
db:restore` is not the tool for any of them** — it refuses a production target
(`scripts/restore.ts:37-40`) and has no per-table mode, so it would `TRUNCATE` and reload all 43
tables (`:144-147`, `:150-216`) and destroy everything written since the dump. Use the Step 8b
generator, which is why Step 8b exists.

**56a.** Shape first, in one transaction:

```sql
BEGIN;
CREATE TABLE "SiteConfig" ("id" TEXT NOT NULL, "key" TEXT NOT NULL, "value" TEXT NOT NULL,
  CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "SiteConfig_key_key" ON "SiteConfig"("key");
COMMIT;
```

then the 26 rows, with their **original uuid ids**:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
jq -r -f v2-production/recover-from-dump.jq \
   --arg table SiteConfig --arg key id --arg cols '*' --arg mode insert \
   backups/PRE-CONTRACT-<stamp>.json > /tmp/v2/prod/recover-siteconfig.sql
less /tmp/v2/prod/recover-siteconfig.sql          # read it, then apply it like any contract file
```

**It must be the Step 38 or Step 7 dump, not Step 52's.** `scripts/dump.ts:31-33` selects
`table_schema = 'public'` only, and Step 49's C4 moved `SiteConfig` to `legacy_v1` — so **no
post-cutover dump contains this table at all**, and the generator will refuse with `no table named
"SiteConfig" in this dump` rather than produce a wrong file. That refusal is the check; do not work
around it by hand-writing the inserts.

**56b.** `UtmTracker` comes back the same way, and the **table name in the dump changes with the
dump**: Step 48 renamed it, so it is `UtmTracker` in the Step 7 and Step 38 dumps and
`UtmTracker__retired_v2` in Step 52's. Pass whichever name that dump actually holds to `--arg table`,
recreate the table under the name you want, and remember the generator writes `INSERT INTO <the
--arg table name>` — so if you recover the renamed rows into a table called `UtmTracker`, generate
from a dump where it is called `UtmTracker`. Because Step 48 is a **rename** and not a drop, the Step
52 dump is the only one holding rows beaconed after Step 38, which is exactly the window the public
`track/utm` beacon kept writing through.

**56c.** `_v2_backup_project_images` is scaffolding `projects-expand.sql:569-578` created, and it is
**not** simply derivable from `ProjectImage`. `projects-contract.sql:240-251` restores
`Project."images"` as `COALESCE(<array_agg from ProjectImage>, <the backup row>, '{}')` — so for a
project whose gallery is populated the live `ProjectImage` rows are the source and the backup is
redundant, but for a project with **no** gallery rows the backup is the only copy of what v1 stored.
Before dropping it, check that case is empty:

```sql
SELECT b."projectId", b."images"
  FROM "_v2_backup_project_images" b
 WHERE array_length(b."images", 1) > 0
   AND NOT EXISTS (SELECT 1 FROM "ProjectImage" g WHERE g."projectId" = b."projectId");
-- 0 rows: the drop loses nothing. Any rows: those arrays exist ONLY here and in
-- the dump, and the dump is a `Project."images"` column that Step 46 has dropped
-- — so read them into the run log first.
```

To recreate it, re-run `projects-expand.sql`'s `CREATE TABLE` plus its `INSERT ... SELECT "id",
"images" FROM "Project"` — which only works while `Project."images"` still exists, i.e. only before
Step 46. After Step 46 the generator over a pre-Step-46 dump is the path, against `Project`:
`--arg table Project --arg key id --arg cols 'images' --arg mode update`, after re-adding the column.

**After Step 56 the dump is the only copy — and since Step 8b, "the dump" means a command you have
run.**

---

## Step 57 — Delete the scaffolding

**What it does.** Removes the things that will confuse the next person, including you in a month.

**Command.**

```bash
# The Neon child branch and every rehearsal/scratch branch: delete in the Neon
# console. Confirm first that NOTHING still points at them:
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
grep -n 'DATABASE_URL\|SCRATCH_DATABASE_URL' .env ../../apps/web/.env ../../apps/docs/.env \
  | sed 's/=.*/=<redacted>/'

# The drafts. They assumed a throwaway target and are now actively misleading --
# 20-hero-enum.sql step 7 and 55-blogs.sql step 3 are both WRONG for production.
# Delete the directory, or add a README pointing at /tmp/v2/prod/.
git rm -r packages/db/v2-migration-draft/
#   ... but KEEP target-ddl.sql and data-facts.txt if you want the reference;
#   regenerate target-ddl.sql from the current schema if you keep it, because
#   Step 21's @map changed it.

# The dumps. Keep PRE-CUTOVER, PRE-CONTRACT and POST-CUTOVER off this machine
# for 90 days. Delete the intermediate ones and the transformed JSON:
rm -f backups/transformed-v2.json
rm -f backups/neondb-ep-*-pooler-*.json     # the two pre-migration branch dumps

# The run log: keep it. It is the only record of what the preflights answered.
tar czf ~/yatindora-v2-cutover-log-$(date -u +%Y%m%d).tar.gz /tmp/v2/prod/log
```

**Expected output.** Clean.

**Gate.** Do **not** delete the Neon child branch until local dev has been repointed (Step 58) and
you have confirmed nothing in either `.env` references it. Do **not** delete the three named dumps
for 90 days.

**Undo.** A deleted Neon branch cannot be recovered. The drafts are in git history.

---

## Step 58 — Repoint local dev, and accept the one standing hazard

**What it does.** Local `DATABASE_URL` points at a branch you are about to delete.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
# Cut a NEW long-lived "staging" Neon branch from the now-v2 production, and
# point local DATABASE_URL at it in all three .env files. Do NOT point local
# DATABASE_URL at production.
grep -n 'DATABASE_URL' packages/db/.env apps/web/.env apps/docs/.env | sed 's/=.*/=<redacted>/'
bun run --cwd packages/db db:generate
bun run check-types
bun run dev
```

**Expected output.** Local dev runs against the new staging branch.

**Gate.** Three standing hazards you are now living with, permanently:

1. **`localhost:3000`/`3001` write to whatever `DATABASE_URL` points at.** If that is ever
   production, a local write test is a production write. Keep it pointed at staging, and ask before
   any write test.
2. **`prisma db push` is now dangerous in a new way.** It silently removes **every CHECK constraint**
   in `schema-v2.md:825-846` — Prisma cannot express them — and it **drops
   `Skill_name_lower_key`**, the functional unique index enforcing case-insensitive skill identity.
   After any push, re-run `CREATE UNIQUE INDEX "Skill_name_lower_key" ON "Skill" (lower("name"));`
   and re-apply the CHECKs. Prefer `migrate deploy`.
3. **`packages/db/seed.ts` has nineteen `deleteMany` calls, not sixteen** — counted:
   `seed.ts:7-25`, one per table, in FK order. **The nineteenth is
   `prisma.adminUser.deleteMany()` (`seed.ts:25`), which deletes the only login.** A stray
   `bun run seed` against production does not merely lose content, it locks you out of the admin
   that would let you notice. `scripts/install-hero-v2.ts` additionally does a
   `deleteMany({version:'v2'})`.

   Neither has a `DATABASE_URL` host guard, while `scripts/apply-sql.ts:31-38` and
   `scripts/restore.ts:32-39` both do — so the two *safe* scripts are guarded and the two
   *destructive* ones are not. `schema-v2.md:913` ("Disarm the tooling") is the highest-leverage
   hour of follow-up work in the whole plan and it is still undone. Do it before you next run a seed,
   and copy the guard from `apply-sql.ts` rather than inventing one.

   The good news, verified: `seed.ts` is fully v2 — it writes `siteSettings`, `projectImage`,
   `projectSkill` and `experienceSkill`, and names no `SiteConfig`, no `Blog.show`, no `Skill.show`
   and no `Project.images`. `bunx tsc --noEmit -p tsconfig.check.json` passes on it, which is what
   Step 4's edit 5 exists to keep true. Three other writers, all harmless:
   `scripts/seed-flags.ts` (create-only, leaves off-registry rows alone),
   `apps/docs/scripts/update-about-copy.ts` (two idempotent `update`s) and `/analytics`'s
   `catchUpRollups()` (Step 35).

**Undo.** N/A. You are done.

---

## Appendix — file map

| Step | File |
|---|---|
| 13 / 48 | `/tmp/v2/prod/analytics-expand.sql` · `analytics-contract.sql` |
| 14 / 39 | `contact-admin-audit-expand.sql` · `contact-admin-audit-contract.sql` |
| 15 / 40 | `media-flags-reval-github-expand.sql` · `media-flags-reval-github-contract.sql` |
| 16 / 42 | `about-quotes-notes-expand.sql` · `about-quotes-notes-contract.sql` ← **written for this runbook; unrehearsed** |
| 17 / 47 | `blogs-expand.sql` · `blogs-contract.sql` |
| 18 / 46 | `projects-expand.sql` · `projects-contract.sql` |
| 19 / 44 | `skills-joins-expand.sql` · `skills-joins-contract.sql` |
| 20 / 43 | `hero-badges-expand.sql` · `hero-badges-contract.sql` |
| 21 / 45 | `experience-education-expand.sql` · `experience-education-contract.sql` |
| 22 / 41 | `hero-expand.sql` · `hero-contract.sql` |
| 23 / 49 | `settings-expand.sql` · `settings-contract.sql` |

Reference, in the repo: `packages/db/schema-v2.md` (accurate and current),
`packages/db/v2-migration-draft/data-facts.txt`, `packages/db/v2-migration-draft/target-ddl.sql`.
The 14 draft SQL files assumed a throwaway target — **two of them are actively wrong for
production** (`20-hero-enum.sql` step 7, `55-blogs.sql` step 3). Use `/tmp/v2/prod/` only.
