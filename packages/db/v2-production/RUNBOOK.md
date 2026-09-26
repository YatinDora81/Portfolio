# yatindora.in — v1 → v2 PRODUCTION CUTOVER RUNBOOK

**58 numbered steps. One operator. Live site. Read the whole STOP-THE-LINE block before Step 1.**

```
STAGE 0  PRE-FLIGHT        Steps  1 – 12
STAGE 1  EXPAND            Steps 13 – 23    (11 SQL files, additive only)
STAGE 2  VERIFY EXPAND     Steps 24 – 27    (v1 must still be correct)
STAGE 3  DEPLOY            Steps 28 – 32    (git push, two Vercel builds)
STAGE 4  VERIFY DEPLOY     Steps 33 – 37    (v2 must be correct; freeze ends)
STAGE 5  CONTRACT          Steps 38 – 49    (11 SQL files, destructive)
STAGE 6  VERIFY CONTRACT   Steps 50 – 52
STAGE 7  POST-CUTOVER      Steps 53 – 58    (soak, then delete things)
```

**Admin freeze:** starts at Step 10, ends at Step 37. Budget **120 minutes**, hard stop at 180.
A second, shorter freeze covers Steps 38 – 49 (~30 minutes).

**Public downtime target: zero.** Nothing in EXPAND or CONTRACT drops a column the *currently
deployed* code reads, and every `ALTER` runs under `lock_timeout = '3s'` so a blocked statement
fails instead of queueing the site behind it.

**Point of no clean return: Step 43.** Before Step 43 every undo is a SQL statement. From Step 43
the only undo for `HeroSkillBadge.iconKey` is the JSON dump from Step 7.

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
| S7 | A Vercel build **fails** after EXPAND has run | You are stuck mid-window with no deadline. | Do not push again blindly. Fix the build locally (Step 5 exists to prevent this). EXPAND is safe to sit on indefinitely — v1 runs correctly against it. |
| S8 | Only **one** of the two Vercel projects went Ready | Half-deployed is the one state CONTRACT cannot survive. | Do not run any contract file. Fix or roll back the failed project first. |
| S9 | The Vercel build log shows **`prisma db push`** or **`prisma migrate deploy`** | The deploy is mutating the schema behind your back. It will silently drop the CHECK constraints and may drop columns while v1 lambdas drain. | **Stop before Step 13.** Fix the dashboard command. This is Step 3. |
| S10 | Vercel production `DATABASE_URL` points at the **Neon child branch** | The live site is serving from a throwaway clone. | Stop. Repoint it to production. This is Step 6. |
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

## Step 4 — Make the build self-sufficient (code change, four edits)

**What it does.** Moves `prisma generate` into the turbo build graph so the deploy is reproducible
from git. Every one of the eleven clusters names this as a required step, because a failed build
after EXPAND leaves you mid-window with **no deadline** (S7).

**Command.** Four edits, in the same commit as the v2 code:

1. `packages/db/package.json` — add to `scripts` (it currently ends at `"db:verify"`):
   ```json
   "build": "prisma generate",
   ```
2. **New file** `packages/db/turbo.json`:
   ```json
   {
     "extends": ["//"],
     "tasks": {
       "build": {
         "inputs": ["prisma/schema.prisma", "prisma.config.ts", "package.json"],
         "outputs": ["src/generated/prisma/**"]
       }
     }
   }
   ```
   A package-level override is **required**: the root `build` task declares `outputs: [".next/**"]`
   (`turbo.json:28-32`), which is wrong for `packages/db` and would cache nothing.
3. `turbo.json` — add `"^build"` to `tasks["check-types"].dependsOn`, because `apps/*/check-types`
   runs `tsc --noEmit` against the generated client.
4. Root `package.json` — add a belt so a bare clone works:
   ```json
   "postinstall": "bun run --cwd packages/db db:generate",
   ```

Nothing else is needed: `apps/web/package.json` and `apps/docs/package.json` already depend on the
`db` workspace, and the root `build` task already has `dependsOn: ["^build"]`.

**Expected output.** `bun run build` generates the client before either `next build`.

**Gate.** One gotcha, confirmed: `prisma generate` **fails** with
`PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` if `DATABASE_URL` is
unset, because `packages/db/prisma.config.ts` resolves `env("DATABASE_URL")` at config load. It
never opens a connection. So `DATABASE_URL` must be **present** in the Vercel *build* environment.
It already is in `turbo.json` `globalEnv` (line 5), so Turbo passes it through. Confirm it is set
for the Production environment in both Vercel projects.

**Undo.** `git checkout -- turbo.json package.json packages/db/package.json && rm -f
packages/db/turbo.json`.

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
`apps/web` and `apps/docs` build. `check-types` is clean.

**Gate.** All three commands exit 0, **and** the build log shows the `db#build` task running before
`web#build` and `docs#build`. If `db#build` does not appear, edit 1 or 2 of Step 4 is wrong.

**Undo.** `bun install` restores the generated client. Nothing in the database was touched.

---

## Step 6 — Confirm Vercel environment variables. Production must point at PRODUCTION.

**What it does.** Local `.env` files now point `DATABASE_URL` at the **Neon child branch**.
Vercel's own variables were not touched. Verify that, because a mistake here means the live site
serves from a throwaway clone (S10) or, worse, that EXPAND lands on the branch while production
goes untouched and you spend the night confused.

**Command.** Not SQL. In both Vercel dashboards, Settings → Environment Variables, for the
**Production** environment, read `DATABASE_URL` and compare its host to:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
for v in DATABASE_URL PROD_DATABASE_URL NEW_DATABASE_URL; do
  printf '%-18s %s\n' "$v" \
    "$(grep "^$v=" .env | cut -d= -f2- | tr -d '"'"'"'" | sed -E 's#^postgres(ql)?://[^@]*@##; s#/.*##')"
done
```

**Expected output.** Three different hosts. `PROD_DATABASE_URL`'s host is the one that must match
Vercel Production. `DATABASE_URL` (local) is the branch and must **not** appear anywhere in Vercel
Production.

**Gate.**
- Vercel Production `DATABASE_URL` host **==** local `PROD_DATABASE_URL` host, in both projects.
- `REVALIDATE_SECRET`, `JWT_SECRET`, `R2_*`, `SMTP_*` are unchanged. This cutover changes none of
  them, and a missing one turns into a runtime 500 that looks like a schema problem.
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
`FLAG_DEFINITIONS` (Step 40), and `Blog.show`'s per-row values (Step 47).

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
`packages/db/.env` as `NEW_DATABASE_URL`, then:

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
bun run db:restore --file=backups/PRE-CUTOVER-<stamp>.json --to=NEW_DATABASE_URL          # dry run
bun run db:restore --file=backups/PRE-CUTOVER-<stamp>.json --to=NEW_DATABASE_URL --apply=true
```

**Expected output.** The dry run prints source, target and per-table counts and says
`re-run with --apply=true`. The apply run truncates and reloads every table and reports the same
row counts as the dump.

**Gate.** Row counts after restore match the dump for all 43 tables. If `db:restore` prints
`refusing: ... which PROD_DATABASE_URL protects`, you pointed `NEW_DATABASE_URL` at production —
fix it, do not work around the guard.

**Undo.** Delete the scratch Neon branch. Production was never a target.

---

## Step 9 — Rehearse the ordered run on a fresh Neon branch. Do not skip this.

**What it does.** Converts the static reasoning in eleven SQL files into an observed result at zero
production risk. The hero cluster asks for this explicitly, because its safety argument rests on
how `@prisma/adapter-pg` serialises parameters (`addInt16(0)`, no parameter type OIDs) — analysis
that is correct but worth confirming empirically.

**Command.**

```bash
# Cut a NEW Neon branch from production in the console. Put its URL in
# packages/db/.env as NEW_DATABASE_URL. Then, for the EXPAND files in the
# Step 13-23 order:
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
export PGREHEARSE="$(grep '^NEW_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"'")"
for f in analytics contact-admin-audit media-flags-reval-github about-quotes-notes \
         blogs projects skills-joins hero-badges experience-education hero settings; do
  echo "=== $f ==="
  psql "$PGREHEARSE" -v ON_ERROR_STOP=1 -f "/tmp/v2/prod/$f-expand.sql" \
    2>&1 | tee "/tmp/v2/prod/log/rehearse-expand-$f.log" || break
done
```

Then, **with the v1 code** — `git stash && bun install && bun run db:generate` — point a local dev
server at `NEW_DATABASE_URL` and load the public home page and the admin `/hero`, `/site-config`,
`/quotes`, `/projects`. Then `git stash pop`.

Then run the CONTRACT files in the Step 39–49 order against the same branch, with the v2 code.

**Expected output.** Every EXPAND file commits. The v1 site renders correctly against the expanded
schema. Every CONTRACT file commits. `bun run db:verify --from=NEW_DATABASE_URL` comes back clean
except the two known-pending opclass indexes.

**Gate.** All of the above. Any `RAISE EXCEPTION` you see here you would have seen on production at
2 a.m. instead. Fix the cause, re-cut the branch, rehearse again.

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
  public collect beacon (`HEAD:apps/web/app/api/collect/route.ts:99-100`):
  scheduled publishing (`packages/db/src/publish-due.ts`), the analytics rollup
  (`packages/db/src/rollup.ts`) and retention (`packages/db/src/maintenance.ts`).
- The GitHub refresh rides the *home page's own ISR regeneration*:
  `HEAD:apps/web/app/page.tsx:120-134` POSTs `/api/github/refresh` inside `after()` whenever
  `!github || github.stale`. **An ISR regeneration is itself a write trigger**, not a shield.
- Consequence: on a low-traffic site, "the next rollup" can be **hours** away. Step 48 (analytics
  CONTRACT) requires at least one `RollupRun` row with `status = 'ok'` and a `createdAt` **after**
  the deploy. Plan for that wait; do not fake it.

**Gate.** You have accepted that Step 48 may need to happen the next day.

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

**Do not pass `--single-transaction`.** Several files manage their own multiple transactions, and
`analytics-expand.sql` STAGE 3 has a `CREATE INDEX CONCURRENTLY` that *must* run outside one.

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

**Expected output.** T1 commits, T2 commits.

**Gate.** Two preflights decide the shape:
- **P3** — the distinct stored values of the five columns about to become enums. Any value outside
  the label set is **S5**. Do not coerce it.
- **P6** — the label set of the pre-existing `"AdminRole"` type. **If a label is missing**, run T0
  first, in its **own transaction** (a label added by `ALTER TYPE` cannot be used by a `USING` cast
  in the same transaction). **T0 is NOT reversible** — Postgres has no `ALTER TYPE ... DROP VALUE`
  and `AdminUser.role` depends on the type. If P6 surprises you, prefer *leaving `actorRole` as
  text and writing the drift down* over widening a type irreversibly mid-cutover.

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
`FeatureFlag.updatedByName` (+ the `IS DISTINCT FROM` backfill that supersedes Step 14's),
`FeatureFlag.label DROP NOT NULL`, the `RevalidationScope` type, and
`RevalidationLog.scope` + `.actorName` with their backfills.

**Command.**

```bash
psql "$PGPROD"                        # PASS 1: the folder gate must return 0, and RUN THE
                                      # PREFLIGHT DUMP of FeatureFlag key/label/description --
                                      # it is the ONLY paper record of what Step 40 destroys.
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /tmp/v2/prod/media-flags-reval-github-expand.sql \
  2>&1 | tee /tmp/v2/prod/log/15-media-flags-reval-github-expand.log
```

**Expected output.** One `COMMIT`. `FeatureFlag.updatedByName` and `RevalidationLog.actorName`
report `ALTER TABLE` with no change (Step 14 already added them) — **expected**. The `scope`
backfill updates every existing row.

**Gate.** The folder preflight returns **0**. The `FeatureFlag` dump is in your run log. `scope`
is `NULLABLE with no default` — verify that, because a `NOT NULL` `scope` makes the v1 log INSERT
fail 23502 inside a `catch` that merely logs (`HEAD:apps/docs/app/lib/revalidation.ts:109-111`),
silently losing both the log row **and** the `TagState` upsert loop that follows it — the
cache-staleness detector's substrate.

**Note the row set is not frozen.** `HEAD:packages/db/src/maintenance.ts:163-177` batch-deletes
`RevalidationLog` rows older than 30 days, fired from a **visitor beacon**. So the preflight count
is an upper bound, not an invariant. Verify "no NULL scope", never "count equals N".

**Undo.** One transaction, in this order: `DROP COLUMN scope, actorName`; then
`DROP TYPE IF EXISTS "RevalidationScope"` (must follow the drop); `DROP COLUMN updatedByName`;
`UPDATE "FeatureFlag" SET "label" = "key" WHERE "label" IS NULL` (a guard — expect 0 rows);
`ALTER COLUMN "label" SET NOT NULL`; drop `MediaAsset_folder_check`; drop
`MediaAsset_key_prefix_idx`. Nothing in this EXPAND destroys anything, so its rollback needs no
dump. Full text: ROLLBACK block of the file.

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

**Gate.** Three things:
1. **Do NOT backfill `Experience.logoAssetId`.** `Experience_logo_source_check` allows at most one
   logo source, so pointing `logoAssetId` at an adopted `MediaAsset` requires nulling `logoUrl` in
   the same UPDATE — and v1 renders `logoUrl` (`HEAD:apps/web/app/lib/data.ts:203`), so the company
   logos would **vanish from the live site**. That backfill is contract-side media work.
2. **The code half must land in the same commit**: `packages/db/prisma/schema.prisma` →
   `startYear Int @map("startYearInt")` and `endYear Int? @map("endYearInt")`, then
   `cd packages/db && bun run db:generate`. Field names are unchanged, so **zero TypeScript churn**.
   Validated: `bunx prisma validate` passed in Step 2. Also apply the same two renames to the Neon
   child branch, or local dev stops matching the schema.
3. `SET NOT NULL` on `startedOn` is safe **only** because the `BEFORE INSERT` trigger fills it and
   `NOT NULL` is evaluated *after* BEFORE-row triggers. Verify the trigger exists before trusting it.

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

**What it does.** Stages the 79 changed files plus the four build-graph edits from Step 4 plus the
two `@map` lines from Step 21.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio
git checkout -b v2-cutover          # NOT main -- branch first, then merge when green
git add -A
git status --short | wc -l
git diff --cached --stat | tail -1
# Verify the four build-graph edits are in:
git diff --cached -- turbo.json package.json packages/db/package.json packages/db/turbo.json
# Verify the two @map lines are in:
git diff --cached -- packages/db/prisma/schema.prisma | grep -n 'startYearInt\|endYearInt'
git commit
```

**Expected output.** ~84 files staged. `packages/db/turbo.json` appears as a **new file**. Both
`@map` lines appear.

**Gate.** Four:
- The commit message does **not** add a Claude co-author trailer, and authorship is yours alone.
- `git ls-files | grep -c generated/prisma` is still **0** — the generated client stays gitignored;
  Step 4 is what makes that safe.
- `bun run check-types` and `bun run build` still pass on the staged tree (re-run if you touched
  anything since Step 5).
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

**Gate.** Do **not** merge to `main` until **both** preview builds are green. A failed build after
EXPAND is **S7**: you are stuck mid-window with no deadline. The preview build is a free rehearsal
of the exact thing Step 31 gates on.

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
`web#build` / `docs#build`, and `Generated Prisma Client ... to ./src/generated/prisma`.

**Gate.** Three:
- Both projects reach **Ready** and are promoted to the **production alias**. One of two is **S8**.
- The `prisma generate` step came from the **turbo graph**, not only from the dashboard command.
  (Leave the dashboard command in place for this first deploy; it merely runs generate twice, which
  is idempotent. Step 55 removes it.)
- The log contains **no** `prisma db push` and no `prisma migrate deploy`. If it does, that is
  **S9** and the schema has just been mutated behind your back — stop and audit with Step 24
  immediately.

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

**Gate.** All 200. A 500 here is **S1** and it is almost certainly `SiteSettings`: v2's first render
hits `prisma.siteSettings.findUniqueOrThrow` at `apps/web/app/lib/data.ts:64`, and
`unstable_cache` **cannot** reuse v1's persisted payload because it keys on the callback source
(Step 12). So a missing or wrong `SiteSettings` row is an **instant whole-site 500**, not a
day-delayed one. Rollback is still free — `SiteConfig` is untouched.

**Undo.** Vercel instant rollback, both projects. Then re-run Step 23's STEP A assertions.

---

## Step 34 — Force a real regeneration and look at the page

**What it does.** A warm page proves nothing. Flush every tag and look.

**Command.**

```bash
curl -s -X POST https://www.yatindora.in/api/revalidate \
  -H "x-revalidate-secret: $REVALIDATE_SECRET" -H 'content-type: application/json' \
  -d '{"tags":["site-config","projects","blogs","flags"]}'
sleep 5
curl -s -o /dev/null -w 'home %{http_code}\n' https://www.yatindora.in/
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

**Gate.** Every item on the Step 25 list renders, and renders **correctly**, not merely without an
error.

**Undo.** Vercel instant rollback. Note that after a rollback the v1 code reads `SiteConfig`, which
is **stale** with respect to anything v2 wrote — no reverse trigger is installed, deliberately.

---

## Step 35 — Admin smoke: every page must open

**Command.** Log into the admin and open every page, confirming a 200 and sane content:

`/dashboard` `/site-config` `/hero` `/background` `/cat` `/about` `/skills` `/icons`
`/experiences` `/experiences/<id>` `/projects` `/projects/<id>` `/blogs` `/quotes`
`/contact-purposes` `/messages` (open a detail pane) `/media` `/flags` `/revalidation` `/tracker`
`/terminal` `/history` `/notes` `/refer-emails`

**Expected output.** All render.

**Gate.** Four are specific proofs, not general checks:
- `/blogs` prints **"no date yet"** for the ten drafts. That string is v2's null branch at
  `apps/docs/app/(dashboard)/blogs/page.tsx:199` and is proof the deployed bundle is the v2 one.
- `/flags` and `/revalidation` show a **name**, not a uuid, in the changed-by / actor columns.
- `/revalidation` shows **scope** values, not blanks.
- `/tracker` renders — it is the only reader of `rawContent`/`rawTerm`/`messageId`, and a `42703`
  there means Step 13 did not land.

A 500 on `/tracker`, `/flags`, `/site-config` or `/terminal` is a missing EXPAND column. Find it in
Step 24's log.

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

**Expected output.** Every one succeeds.

**Gate.** All of them, plus:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -f /dev/stdin <<'SQL'
select "id", "updatedAt" > now() - interval '1 hour' as written_by_v2_recently,
       "name" <> '' and "navbarLogo" <> '' and "contactEmail" <> '' as not_all_defaults
  from "SiteSettings";
select count(*) as quotes_with_sortorder from "Quote" where "sortOrder" is not null;
select count(*) as badges_resolved from "HeroSkillBadge" where "skillId" is not null;
SQL
```

`written_by_v2_recently = t`, `not_all_defaults = t`, and both counts equal their table's row count.

**Undo.** Vercel instant rollback. It is still free: Stage 5 has not run.

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

Also note: `lastRunAt` is bumped **before** the task body runs, so a task that throws is locked out
for its full interval — **24 hours for retention** — with the only evidence an `error:` prefix in
`lastResult`. Read that column.

**Undo.** N/A. The freeze is over.

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

**Expected output.** One `COMMIT`. A **WARN** (not an abort) if any `FeatureFlag` key is outside
`FLAG_DEFINITIONS`.

**Gate.** `/flags`, `/site-config` and `/terminal` all return 200 (they are the three pages that
select `FeatureFlag.label` under v1), `/revalidation` shows scope values, and the home page renders
the GitHub tile. Before the two `DROP INDEX` statements, **confirm `idx_scan = 0` on PRODUCTION**,
not on a Neon branch — a branch's `pg_stat_*` counters are a fresh compute's:

```bash
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select indexrelname, idx_scan from pg_stat_user_indexes
where indexrelname in ($$MediaAsset_folder_createdAt_idx$$,$$RevalidationLog_entityType_entityId_idx$$);'
```

**The one irreversible thing in this whole cluster:** `label`/`description` for a `FeatureFlag` key
**outside** `FLAG_DEFINITIONS`. `HEAD:packages/db/scripts/seed-flags.ts:37-42` leaves such rows
alone by design, so no automated means restores them. Step 15's preflight dump is the only record.
Read the WARN.

**Undo.** One transaction, in this order: drop `GithubYear_handle_fkey`;
`ALTER TYPE "RevalidationTrigger" ADD VALUE IF NOT EXISTS 'SYSTEM'` (appends last, exactly where
`20260821130000` had it, so label order comes back byte-identical — legal inside a transaction on
PG12+, but the restored label cannot be **used** until after COMMIT); recreate the two indexes;
`ADD COLUMN "label" TEXT, ADD COLUMN "description" TEXT`; then **on the v1 code**
`cd packages/db && bun run flags:seed` (HEAD's seed writes label + description; the v2 seed writes
neither); then `ALTER COLUMN "label" SET NOT NULL`.

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
> output**. This is the first step in the entire runbook whose undo is not a SQL statement.
> **Re-read Step 20's P7 output now, before you run this.**

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

**Undo.** Lossy and partial. `name` reconstructs as `COALESCE(label, skill.name)`. `iconKey` comes
back **only** as the skill's icon — correct only for the rows P7 reported as non-drifting. For the
real values, read the Step 7 dump. The FK, the `NOT NULL` and the unique index drop cleanly.

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

**Undo.** `show` comes back only as a blanket `ADD COLUMN "show" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Blog" SET "show" = false;` — faithful today because all ten rows held `false`, and the
per-row values also live in the dump. `publishedAt` comes back from `createdAt` (identical for the
ten seed rows). A post published **after** this step is restored by neither.

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
after. While it is off, `collect/route.ts:103` returns before touching Postgres, so the
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
old ones). `lastSeenAt` comes back reading `CURRENT_TIMESTAMP` — **unrecoverable**, and cosmetic,
since v1 has no reader for it either.

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

**C4 is fatal to v1 from that instant.** Every public route 500s (`42P01` inside the root layout),
the nine v1 admin read sites 500 the same way, and both v1 writers fail `P2021`. v2 is unaffected:
`git grep prisma.siteConfig` on the working tree returns nothing; the only surviving `siteConfig`
identifiers are the cache tag at `packages/shared/src/tags.ts:6` and a local variable in
`apps/web/app/page.tsx`.

**Undo.** Between C1 and C4 nothing has moved — re-run **STEP B** of `settings-expand.sql` to
restore the dual write at zero data risk. After C4 and before Step 56 the undo is **one statement**:
```sql
BEGIN; ALTER TABLE legacy_v1."SiteConfig" SET SCHEMA public; COMMIT;
```
which makes v1 servable again **with the original uuid ids intact** — but `SiteConfig` is then
**STALE** with respect to anything the admin saved while v2 was live, because no reverse trigger is
installed (deliberately). **Reconcile from `SiteSettings` by hand before trusting the v1 site.**

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

Then repeat **Step 34's full render checklist** and **Step 36's full write checklist**, plus:
- Submit the public contact form once and confirm the message appears in `/messages`.
- Upload one small file to `/media`, confirm it appears, then delete it — and confirm the R2 object
  is gone. This is the first time since Step 10 that an R2 write is safe.
- Send one reply from `/messages` to your own address. First safe SMTP write since Step 10.

**Expected output.** All 200, everything renders, every write succeeds.

**Gate.** Everything. This is the acceptance test for the whole cutover.

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

**Gate for "stable".** 7 days with: no public 5xx attributable to schema, at least three `RollupRun`
rows with `status='ok'`, `MaintenanceState.lastResult` with no `error:` prefix on any key, and one
successful scheduled publish or a deliberate manual one.

**Undo.** N/A.

---

## Step 54 — Reconcile `_prisma_migrations`

**What it does.** Every file in this runbook was **hand-run**, so `_prisma_migrations` knows about
none of it. The next `prisma migrate dev` will try to create `SiteSettings` again.

**Command.**

```bash
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
# For each cluster, stage the equivalent migration directory:
#   prisma/migrations/<timestamp>_<cluster>_v2_expand/migration.sql
#   prisma/migrations/<timestamp>_<cluster>_v2_contract/migration.sql
# committing the files you actually ran, then mark each applied WITHOUT running it:
DATABASE_URL="$PGPROD" bunx prisma migrate resolve --applied <timestamp>_<cluster>_v2_expand
DATABASE_URL="$PGPROD" bunx prisma migrate resolve --applied <timestamp>_<cluster>_v2_contract
# Verify:
psql "$PGPROD" -v ON_ERROR_STOP=1 -c '
select "migration_name","finished_at" from "_prisma_migrations" order by "started_at" desc limit 25;'
```

**Expected output.** 24 pre-existing migrations plus your new ones, all with a `finished_at`.

**Gate.** `bun run db:verify --from=PROD_DATABASE_URL` is still clean (Step 50's known-pendings
only). **Nothing at runtime consults `_prisma_migrations`** — this is bookkeeping, off the critical
path, and safe to defer.

**Leave the repo in a state where nobody can run `prisma db push`.** It would silently remove
**every CHECK constraint** and **drop `Skill_name_lower_key`**. Prefer `migrate deploy`. Consider a
guard in the `db:push` script.

**Undo.** `prisma migrate resolve --rolled-back <name>`.

---

## Step 55 — Strip the Vercel dashboard build command

**What it does.** Makes the build fully reproducible from git, which was the whole point of Step 4.

**Command.** Not SQL. In both Vercel dashboards, set the Build Command back to the repo default (or
explicitly `turbo run build --filter=web` / `--filter=docs`) and clear the custom Install Command,
**then trigger one deploy and read the log.**

**Expected output.** The build log shows `db#build` running `prisma generate` from the **turbo
graph**, with no dashboard command involved, and both apps build.

**Gate.** Both projects reach Ready, Step 51's smoke still passes, and `DATABASE_URL` is still
present in the Production **build** environment (`prisma.config.ts` resolves `env("DATABASE_URL")`
at config load and fails without it, even though generate never connects).

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

**Undo.** For 56a: `CREATE TABLE "SiteConfig" ("id" TEXT NOT NULL, "key" TEXT NOT NULL, "value"
TEXT NOT NULL, CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")); CREATE UNIQUE INDEX
"SiteConfig_key_key" ON "SiteConfig"("key");` then `bun run db:restore` for that one table with the
original ids. For 56b and 56c: restore from the dump. **After Step 56 the dump is the only copy.**

---

## Step 57 — Delete the scaffolding

**What it does.** Removes the things that will confuse the next person, including you in a month.

**Command.**

```bash
# The Neon child branch and every rehearsal/scratch branch: delete in the Neon
# console. Confirm first that NOTHING still points at them:
cd /Users/yatindora/Developer/web-projects/portfolio/packages/db
grep -n 'DATABASE_URL\|NEW_DATABASE_URL' .env ../../apps/web/.env ../../apps/docs/.env \
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
3. **`packages/db/seed.ts` has sixteen `deleteMany` calls** and `scripts/install-hero-v2.ts` does a
   `deleteMany({version:'v2'})`. Neither has a `DATABASE_URL` host guard. `schema-v2.md:913`
   ("Disarm the tooling") is the highest-leverage hour of follow-up work in the whole plan and it is
   still undone. Do it before you next run a seed.

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
