# The v2 schema

What `prisma/schema.prisma` now describes, what every table is for, and what changed from the schema
that is still running in production.

Written 2026-09-26 against commit `0050cc9`, as the schema half of the plan in `/optimize.md` (phases
P2 through P7). It was checked against the live code by 23 verifiers, one per change cluster, and the
five most severe "this breaks a live feature" claims were each challenged twice. No database was read
or written; every row count below is inferred from the seed, from a migration header that recorded
one, or marked as unverified.

`db.md` describes the pre-v2 schema and covers only 15 of its 40 models. It is superseded by this
file and several of its statements are now wrong (a scalar `Project.image`, a masonry blog grid the
public site abandoned, a `SiteConfig` table missing 17 of its keys). Delete it when you are ready.

---

## The shape of the change

40 models become 43, 9 enums become 17, and about fifteen tables are touched. Nothing is rewritten.
Every change is an additive migration, or a column drop that lands after the code which stopped
reading it has already shipped.

Six things drive almost all of it:

1. **`SiteConfig` becomes `SiteSettings`.** A table of 26 `{ key, value }` string rows becomes one row
   with 24 typed columns. Four hand-copied parser and clamp sets collapse into the schema.
2. **`UtmTracker` is deleted.** A second, older tracking pipeline that stored raw user agents and full
   referrer URLs with no bot filter, no rate limit and no retention. Its three useful fields fold into
   `AnalyticsSession`, which already recorded the same hit.
3. **Media stops being referenced by URL string.** Four single-path columns become real foreign keys to
   `MediaAsset`, so "is this file still in use" stops being a substring scan over every blog body.
4. **The two implicit skill many-to-many tables become explicit join models** carrying `sortOrder`, so
   the tech chips under a role or a project have a declared order instead of whatever Postgres returns.
5. **Free text becomes real types.** `Experience` gets dates, `Education` gets integers, eleven
   pseudo-enum string columns get a closed set, and eleven tables get timestamps.
6. **Two rollback columns die.** `Blog.show` and `ContactMessage.read`, both left over from before the
   status enums replaced them, both still read by admin surfaces that consequently report wrong counts.

### New

| Model | Why it exists |
|---|---|
| `SiteSettings` | the typed replacement for the `SiteConfig` key/value bag |
| `ExperienceSkill` | explicit join, owns the chip order under a role |
| `ProjectSkill` | explicit join, owns the chip order under a project |
| `ProjectImage` | replaces `Project.images String[]`, one row per gallery slot |
| `ProjectHealth` | the live-URL probe result, kept off `Project` on purpose |

New enums: `SiteVersion`, `CatNapStyle`, `LiveProbeStatus`, `AuditAction`, `AuditSurface`,
`PublishState`, `AuditChangeKind`, `RevalidationScope`.

### Gone

| Dropped | Why |
|---|---|
| `SiteConfig` | replaced by `SiteSettings` |
| `UtmTracker` | replaced by three columns on `AnalyticsSession` |
| `Blog.show` | never written, never read, and four admin counts filter on it |
| `ContactMessage.read` | seven writers, zero readers |
| `Experience.isCurrent` | `endedOn IS NULL` says the same thing and cannot contradict it |
| `Project.images` | replaced by `ProjectImage` |
| `AnalyticsSession.lastSeenAt` | one writer on the hottest public path, no readers |
| `AnalyticsEvent.meta` | no reference anywhere in the repo |
| `FeatureFlag.label`, `.description` | duplicates of the `packages/shared` registry |
| `EventType.CLICK`, `.RESUME_OPEN`, `.OUTBOUND` | no emitter has ever existed |
| `RevalidationTrigger.SYSTEM` | no writer emits it |
| 6 indexes | `AuditChange[entity, rowId]`, `RevalidationLog[entityType, entityId]`, `MediaAsset[folder, createdAt]`, `AnalyticsEvent[section, createdAt]`, `AnalyticsSession[channel, startedAt]` and `[visitorHash, startedAt]`, `JobLock[expiresAt]`, `DailyStat[date]` |

---

## Seven places this departs from the audit's draft

`/optimize.md` sketched a target schema and said to treat it as a menu. Verification against the code
rejected or reshaped seven of its steps. Each one is a case where following the draft would have broken
something that works today.

**`Blog.imageOrientation` stays.** The draft dropped it and the enum as unused. It is used: the admin's
blog preview sizes every card from it (`apps/docs/app/components/preview/blogs.tsx:29`) and the blog
list prints it as a thumbnail tooltip. Worse, `apps/web` still selects the column
(`data.ts:282`, `:323`), so a `DROP COLUMN` returns 42703 for the public homepage, every blog page,
the sitemap, the OG image route and the public JSON endpoint. The real defect underneath is that the
admin preview still draws the masonry grid the public site replaced with an index list; fixing that is
a code change, not a migration.

**Five string columns stay strings, with a CHECK instead of an enum.** `AnalyticsSession.channel`,
`TrackedLink.channel`, `DailyStat.dimension`, `RollupRun.status` and `.triggeredBy`. A Postgres enum
whose labels are lowercase or hyphenated needs `@map`, and a `@map`'d enum hands the client the member
**name** while the database, the raw SQL and every rendered label keep the **label**. Both are strings,
so TypeScript reports nothing. The consequences were concrete: the Channels panel would show every
channel twice with partial numbers, every row in the rollup table would render as an amber warning
badge whose text read `OK`, and outreach links would start going out as `?utm_source=LINKEDIN`. A CHECK
constraint buys the closed set with none of that, and it is the convention the repo already chose and
wrote down (`20260728120000/migration.sql:26-28`).

**The live-hero pointer stays on `HeroContent`.** The draft moved it to `SiteSettings.heroVersion` with
a foreign key. `HeroContent` exists specifically so that flipping the live version commits inside the
same staged transaction as the titles and badges that version depends on, and site settings cannot be
written through the staging layer at all. Moving the pointer means either inventing a new staged entity
kind or making the flip unstaged and unaudited.

**`HeroContent.id` stays.** The draft made `version` the primary key. The staging layer identifies
every row by a column literally named `id`; without one, `snapshotPlan` keys both hero rows to
`"undefined"` and the save writes an `AuditEvent` with zero children, silently.

**New foreign keys sit beside the old string columns, not on top of them.** `Project.logoUrl`,
`Experience.logoUrl`, `Blog.image` and `MediaAsset.url` all survive, each paired with a CHECK saying at
most one of the two is set. `cdnUrl` passes any absolute `http(s)` URL straight through and both forms
advertise that in their placeholder, so an off-bucket logo has nowhere else to live; and a column rename
inside the FK cutover is the same 42703 outage as the orientation drop.

**The probe result lives in `ProjectHealth`, not on `Project`.** Three nullable columns on `Project`
would have a background probe stamping `Project.updatedAt` every time it ran, which permanently poisons
stale-content detection.

**`Quote.active` is dropped and `AuditSurface` gains a third member.** `active` had no possible writer,
so it would have shipped as a permanently-true write-only column, which is exactly the `Blog.show`
shape this schema removes. `AuditSurface` needs `SCRIPT`: `update-about-copy.ts` writes
`surface = 'script'` and is a wired command, so a two-member enum fails the cast and stops that script
compiling. The `'messages'` value that both the draft and the old schema comment worried about has
never been written by any revision of the code.

---

## Five things that are true across the whole schema

Worth reading before the per-table reference, because no single table entry explains them.

**Publishing is `status` plus a timestamp, and `PUBLISHED` alone does not mean visible.**
`publicContentWhere` requires `status = PUBLISHED AND publishedAt <= now`
(`packages/db/src/visibility.ts:5-10`). Draft mode widens that to `DRAFT | SCHEDULED | PUBLISHED`, so
`ARCHIVED` cannot be previewed at all. v2 adds the two CHECKs that make a published-but-unstamped row
impossible, which is what the admin currently ships a warning banner for.

**Ten entities are staged, audited and atomic. The rest are not.** Hero content, titles, badges, social
links, about paragraphs, education, skills, quotes, contact purposes and admin users go through
`staging.ts`: edits accumulate in the browser, then one transaction writes the rows and one
`AuditEvent` with its `AuditChange` children. `Project`, `Blog`, `Experience`, media, flags and messages
are plain server actions that write immediately and record no history, even though the history screen
tells the operator it covers everything.

**A `@map`'d enum is a trap and there are exactly two.** `CatNapStyle` and `AuditSurface`. Everything
else either has no `@map` (so the client value is the stored value) or stays `String` with a CHECK.
`SiteVersion` and `LiveProbeStatus` declare **lowercase** members for this reason: their values are
compared against `"v1"`/`"v2"`, printed, and in `LiveProbeStatus`'s case used directly as a CSS class,
so an uppercase member name would print wrong and paint a healthy project red.

**Media has two reference mechanisms after v2, and both are load-bearing.** The four foreign keys cover
project logos, experience logos, blog covers and gallery slots. They do not cover `Blog.content`, whose
inline markdown images have no column to be, or `SiteSettings.avatarUrl`, `heroPhotos` and `resumeUrl`,
which stay plain strings. The substring scan in `media-references.ts` must survive for those five; the
FKs narrow it, they do not replace it.

**Every admin id is a nullable FK plus a denormalised name.** Admin accounts are hard-deleted, and
`onDelete: SetNull` then erases who did what. `AuditEvent` already solved this by storing
`actorName`/`actorEmail` beside the FK; v2 copies that to `MessageReply.sentByName`,
`FeatureFlag.updatedByName` and `RevalidationLog.actorName`. One caveat that applies to all five FKs:
sessions are stateless 7-day JWTs with no server-side record, so a deleted admin's cookie keeps working
for up to a week. Today its writes store an orphan uuid and succeed. After the FK the insert raises
P2003 and the whole action fails, and for media that happens *after* the bytes are already in R2.

---

## The tables

### Site settings

**`SiteSettings`** — one row, `id = 1`, forever. Every site-wide dial the admin exposes, one column
each, 23 of them: the owner's name and avatar, the hero photo list, the resume URL, the two layout pickers, the hero
dot colour and pulse, navbar logo, copyright name, contact email and availability copy, eight terrain
dials, and the two cat-nap settings. Today these are 26 `SiteConfig` rows read as a `Map<string,string>`
and re-coerced at every read site, with the ranges, defaults and boolean encodings hand-copied into four
files. A freshly seeded database has only 14 of those 26 rows, because the rest are served from a defaults
table at read time, which is why every reader needs a fallback.
- `heroPhotos` becomes a real `String[]`. It is a comma-joined string today, and the photo editor writes
  a lone space as its encoding for a blank row, so the backfill has to trim and drop empties or the live
  hero renders a broken `<img>`. The write path has to trim too, not just the backfill: the settings
  validator has no branch for this key and returns the posted value untouched, so the editor's "add photo"
  button on an empty deck produces exactly the value the new CHECK forbids, and the read-side repair that
  currently hides it is deleted in the same step.
- Three registry keys were legacy (`heroVersion`, `intro`, `tagline`) and stop existing, along with the
  write path for unregistered keys.
- The terrain dials and `catNapSeconds` get range CHECKs. These do **not** replace the server-side clamp:
  a CHECK with no clamp turns today's silent coercion into a raw P2010 on save.
- `projectsVersion` and `backgroundVersion` keep their registry names. Renaming them cost twelve
  hard-coded key strings and bought no structure.

**`SiteVersion`** *(new enum)* — `v1 | v2`. Types five columns across four tables and retires four CHECK
constraints and four hand-written TypeScript unions. Members are lowercase deliberately: eleven files
compare or emit `"v1"`/`"v2"`, including two admin `<Select>` controls that silently fall back to their
first option when the stored value does not match, which would show the wrong layout as selected.

**`CatNapStyle`** *(new enum)* — the eight nap indicators, `@map`'d to lowercase because `oneko.js` reads
the label off a data attribute. Only six of the eight name something the cat draws; `random` and `off`
are branches. Replaces two copies of the same eight-string allowlist and two fallbacks to `ticks`.

### Hero

**`HeroContent`** — exactly two rows, one per hero layout, holding that layout's intro and tagline plus
the sentinel that says which one visitors get. The hero exists in two versions: v1 draws the skill
badges inline inside the bio sentence, v2 draws them as a pill row ending in a `+N more` chip. Each
needs its own copy, which is why this is a table and not two settings rows. `live` holds the string
`'live'` on the serving row and NULL on the other; `@unique` on a nullable column is how Postgres spells
"at most one", chosen over a boolean because Prisma cannot declare a partial index.
- `version` becomes `SiteVersion`, so a third version is impossible without a migration.
- Gains timestamps. Keeps `id` and `live`, for the reasons in the departures section above.

**`HeroTitle`** — one row per role title in the rotating line under the name. Two or more rows in the
live version cycle with a blur transition; one row holds still. v1 ships five, v2 ships one. Single
digits, operator-authored through the `/hero` save bar.
- `version` becomes `SiteVersion`, gains timestamps. Both existing indexes stay.
- Trap that v2 does not fix: `sortOrder` is **not** dense per version, despite what `db.md` says.
  `maxSortOrder` aggregates across the whole table with no version filter, which is why the seed starts
  v2 at 100, but reordering renumbers that version from 0 and the ranges collide again. Harmless, because
  every hero read filters by version.

**`HeroSkillBadge`** — one row per skill chip in the hero, scoped to a version. Today each row carries a
free-text `name` and an `iconKey` with no connection to the `Skill` table, which is the historical
accident v2 closes.
- `name` and `iconKey` become `skillId`, a `Restrict` foreign key to `Skill`. One source of truth for a
  skill's label and icon, and the `+N more` count becomes a set difference on ids.
- Gains `label String?`, which is the correction the draft needed. One live badge deliberately differs
  from its skill: the seed creates a badge named `Golang` with `iconKey` `Go` while the skill is named
  `Go`. Without an override column the migration has to mint a second, hidden `Skill` called `Golang`,
  polluting the admin list and the hidden-skill count forever.
- `@@unique([version, skillId])` forbids a duplicate badge in one version, which nothing prevents today.
- `Restrict` needs a guard the schema cannot supply: the staged delete path calls a plain
  `tx.skill.deleteMany`, so removing a badged skill would throw a raw FK error and roll back the
  operator's whole batch of unrelated edits. The count has to happen in `deleteRow`'s skill branch.
- The draft's stated reason was wrong, and the real one is better: there is no name matching in the
  `+N more` count. It is a plain cardinality subtraction, `totalSkills - badges.length`, so the
  off-by-one comes from a badge whose skill is not in the grid and the FK alone does not fix it.

**`SocialLink`** — one row per social profile link. Nullable `version` here, required on the two tables
above, because the same links appear in the hero, the contact section and the footer: NULL means "every
hero". Only one row is ever scoped in practice, a second LeetCode profile tagged v1. `iconKey` doubles
as a functional key: the contribution graph gets its GitHub handle by finding the row whose `iconKey` is
`github` and regexing the handle out of its `href`.
- `version` becomes `SiteVersion?`, gains timestamps. Nothing else.
- The draft's comment claiming every read must carry the version filter is wrong and dangerous. Only the
  hero read filters; the contact section reads unfiltered, and the admin says so in as many words.
  Anyone who "fixes" that drops a link the product intends to show.

### About, skills, quotes

**`AboutParagraph`** — one row per paragraph of prose the About section's fake zsh terminal prints when
it runs `whoami`. Two rows today. A table rather than one text column so each paragraph can be
reordered, staged, audited and typed out with its own animation delay. Text between `**` renders bold,
and if the bold text matches an `Experience.company`, that company's logo is inlined next to it, matched
on a lowercased string join. Renaming a company silently kills the logo.
- Timestamps only. The stamps get no reader in v2: stale detection is extended to `Project`, not here.

**`Education`** — one row per degree in the timeline under the About terminal. One row today. The row
count gates the whole block, including its `#education` anchor. `score`, `scoreTotal` and `scoreType`
are three loosely coupled optional columns feeding one SVG ring: the ring only draws when `score` is
set, `scoreTotal` is only read when `scoreType` is `CGPA`, and `PERCENTAGE` hardcodes 100.
- `startYear` becomes `Int`, `endYear` becomes `Int?` where NULL means still enrolled.
- That nullability is a public regression unless several places move in the same deploy. Two renders
  print `{startYear} — {endYear}` with no null branch and would ship `2021 — `. Four interfaces declare
  the fields as `string`. The admin form submits raw text with no numeric parse. And one preview pipes
  the values through a `str()` helper that turns `null` into `""`, so `?? "Present"` never fires and
  nothing errors.
- Gains CHECKs for both years and their ordering. The second one matters: both inputs are free text with
  no min or max, so `endYear = 99999` on a 2021 start passes the other two checks and renders.

**`Skill`** — one row per technology. Three jobs after v2: it fills the `#skills` grid, which reads only
visible rows; it is the chip list on every experience and project, which ignores visibility entirely;
and it is now the source of the hero badge's label and icon, which means renaming a skill also renames
the hero chip. 47 rows seeded, 44 visible. Three of the hidden ones are naming variants (`React.js`,
`Drizzle ORM`, `WebSocket`) that exist only so a project can be tagged with the variant spelling, with a
hand-maintained alias table folding them back together for the grid. That duplication is an accident,
not a design.
- `show` becomes `showInGrid`. The name was the whole defect, though it is still not the whole truth:
  the flag is also the denominator of the hero's `+N more` chip.
- Gains `name @unique`, plus a raw case-insensitive unique index recorded below. Nothing prevents
  duplicate names today, so the migration needs a dedupe pre-check and the staging layer needs a
  readable error, or an operator retyping an existing name gets a raw P2002 that rolls back their batch.
- The two implicit many-to-many relations become `ExperienceSkill` and `ProjectSkill`.

**`Quote`** — the pool behind the "thought of the day" line. Ten rows. The landing page computes a UTC
day-of-year and returns `quotes[dayOfYear % quotes.length]`, so the pool is the point, not the row.
- Gains `sortOrder` and timestamps. `active` is deliberately **not** added: nothing can write it.
- The draft's justification was wrong. `sortOrder` does not make the day-to-quote mapping stable,
  because the modulus is the row count: adding one quote reshuffles every day regardless of order. What
  it does buy is a deterministic, operator-visible sequence in place of uuid order, and agreement between
  the public site and the admin.
- `sortOrder` is required with no default, which is the one column here that breaks a live write path if
  it ships early. `quote` is explicitly excluded from the sortable-entity machinery, so the create branch
  writes no `sortOrder` at all and the reorder function has no arm for it, silently no-opping while
  still writing a REORDER audit row.

**`ContactPurpose`** — the chips a visitor picks from in the contact form, label plus emoji, ordered.
Five rows. Also a server-side validator: the contact route does not trust the submitted purpose, it looks
the string up here and stores only a label it found. That label is then snapshotted into
`ContactMessage.purpose` as free text, deliberately not a foreign key, so renaming a purpose never
rewrites the inbox history.
- Timestamps only. `updatedAt` carries `@default(now())` to match `ContactMessage`, so the migration must
  not emit `DROP DEFAULT` for this one column.
- `label` is deliberately **not** `@unique`, which reverses the draft. Prisma's immediate constraint
  fails two legitimate staged edits (replacing a purpose, swapping two labels) and rolls the whole batch
  back behind the wrong message. Uniqueness moves to staging preflight, which is also the only form that
  can be case-insensitive. The draft's stated failure mode did not exist either: the route selects only
  the label it already matched on, so which duplicate wins is unobservable. The real symptom is two
  identical chips in the form.

**`ScoreType`** — `CGPA | PERCENTAGE`, unchanged. No `@map`, so no boundary to convert.

### Experience

**`Experience`** — one row per job on the public timeline. Two rows. `company` is load-bearing beyond
display: the section anchor is `#xp-<slug(company)>` and the About terminal's inline logo lookup joins on
it. Not a staged entity, so edits write no audit row.
- `startDate`/`endDate`/`isCurrent` become `startedOn DateTime @db.Date` and `endedOn DateTime?`, where
  NULL is the current role. The strings are parsed at render today by a month-name heuristic that
  silently yields January or NaN.
- This is the change with the largest code half, and the draft named one file. The live parser is in the
  public `Experience.tsx`, not the admin preview it cited, and it feeds six call sites including a React
  key. Both admin write paths still send all three fields from two free-text inputs and a switch.
- Two backfill rules the draft missed. `isCurrent = true` with a parseable `endDate` is representable
  today and renders the end date plus a live pill, so the rule must be
  `CASE WHEN isCurrent THEN NULL ELSE parse(endDate) END`. And tenure is inclusive (`to - from + 1`), so
  an `Intl`-based rewrite that just subtracts dates shortens every role by a month.
- `logoUrl` gains `logoAssetId` beside it with a `SetNull` FK, and an at-most-one CHECK.
- Gains timestamps. No `[sortOrder]` index, matching the other small ordered lists: this is a two-row
  table and Postgres will seq-scan it either way. `sortOrder` is append-only with no reorder UI.

**`ExperienceBullet`** — one achievement line under a role, ordered; the parent's `visibleBullets`
indexes into this list to decide what shows before the `+N more` fold. Eight rows. `content` is
`**bold** rest` markdown parsed by four independent copies of the same regex. Contrary to `db.md`, it
does **not** support inline HTML; HTML renders as literal text.
- One new index, `[experienceId, sortOrder]`. Deliberately no timestamps: the parent's stamp already
  moves, because the update path always writes the parent first.

**`ExperienceSkill`** *(new)* — the role-to-skill join, made explicit to own `sortOrder`. The physical
table already exists as Prisma's implicit `_ExperienceToSkill`; what is new is the ordering column. 17
rows. No read passes an `orderBy` today, so the chip order on a live card is whatever the planner
returns, and an unrelated save re-inserts every row and changes it.
- `sortOrder` is required with no default, so every write site changes. The create paths have no parent
  id yet and must use a nested `create`, not a top-level `createMany`. Every read needs an explicit
  `orderBy`.
- Half the draft's justification was false: the reverse `[skillId]` index already exists, and no query
  looks experiences up by skill. The index is carried over for the cascade delete, not for a reader.
- The order is not operator-curated. The skill picker is a toggle grid that appends on click, so the
  first save after migration freezes whatever `row_number()` produced.

### Projects

**`Project`** — one row per case study. Six rows. One of only two tables carrying the publish lifecycle.
Not staged, so saves are immediate and unaudited. `images` exists only in the datamodel: no migration
ever added it, so a database rebuilt from the migration history has no such column.
- `images String[]` becomes the `gallery ProjectImage[]` relation. The relation field is renamed on
  purpose, so the four readers that take index 0 as the cover each have to be opened and given an
  explicit `orderBy`.
- `logoUrl` gains `logoAssetId` beside it, `SetNull`, with an at-most-one CHECK.
- The three live-probe columns go to `ProjectHealth` instead of here.
- Gains `createdAt`, which is what lets stale detection cover projects. `updatedAt` already exists,
  despite a helper still asserting it does not.
- Gains the two lifecycle CHECKs, which make the admin's "published with no publish date" banner
  unreachable. The migration needs a repair pass first: the only backfill that stamped published
  projects ran a month of writes ago, so `ADD CONSTRAINT` can fail outright.

**`ProjectBullet`** — the ordered highlight lines under a card, ~3 per project, 18 rows. `content`
follows the same `**lead** rest` convention, and a bullet without the bold prefix renders entirely bold.
- One new index, `[projectId, sortOrder]`, which is this table's first index of any kind. At 18 rows
  treat it as intent-recording, not a performance fix.

**`ProjectSkill`** *(new)* — the project-to-skill join. 38 rows. Same reasoning as `ExperienceSkill`,
same required `sortOrder`, same correction about the reverse index. Project chips are not filtered by
`showInGrid`, so a skill hidden from the grid still prints on a card, which is the behaviour the rename
documents.

**`ProjectImage`** *(new)* — one row per gallery slot, replacing `Project.images String[]`. ~6 rows.
- Keeps a surrogate `id` rather than the draft's `@@id([projectId, assetId])`. The composite cannot
  represent a duplicate slot, an empty slot, an off-bucket URL, or a row identity for reordering, all
  four of which the current editor supports. Dedupe stays in the form instead of becoming a migration
  blocker.
- `assetId` is a nullable FK with `Cascade`, paired with `externalUrl` and an exactly-one-of CHECK. The
  form's placeholder invites an absolute URL and `cdnUrl` passes one through, so the escape hatch is
  needed; in practice such a value cannot render anyway, because the image host allowlist and the CSP
  only permit the CDN.
- It is not a gallery. Every consumer reads index 0, and the form says "the first image becomes the card
  cover", so `sortOrder`'s entire observable effect is which asset is the cover.

**`ProjectHealth`** *(new)* — one row per probed project: `status`, `latencyMs`, `checkedAt`, keyed on
`projectId`. This exists because the live-URL probe currently runs *inside* the cached homepage render,
so every regeneration and every draft-mode request fans out an HTTP HEAD with a 5s timeout to each
admin-supplied URL. Splitting it into its own table, rather than three columns on `Project`, keeps a
probe tick from stamping `Project.updatedAt`.
- Nothing writes it yet. The table, the enum and their writer do not exist anywhere in the repo; the
  probe still runs inline in the render until the scheduled task lands.
- Three pairing CHECKs, because the columns are only meaningful as a set. No index on `status` or
  `checkedAt`: the probe's scan over a handful of rows is a deliberate seq scan.
- Two integration requirements the draft missed: nothing clears the row when `Project.live` is edited, so
  a card could print `up · 120 ms` for a URL that was never probed; and the only periodic runner in the
  repo is triggered by a visitor beacon, so probe freshness tracks traffic until a real cron exists.

**`LiveProbeStatus`** *(new enum)* — `up | down`, lowercase members. The value is printed *and* used as a
CSS class, so an uppercase member name would print wrong and paint a healthy project red; `@map` would
not help, because the client returns the name either way. `unknown` is deliberately not a member: it is
`checkedAt IS NULL`. A third `timeout` member has to land in the same commit if the probe timeout is ever
lowered, along with the matching CSS class.

**`ContentStatus`** — `DRAFT | SCHEDULED | PUBLISHED | ARCHIVED`, unchanged, shared by `Project` and
`Blog`. Labels equal member names, so no boundary. `ARCHIVED` cannot be previewed even in draft mode.

### Blogs

**`Blog`** — one row per article: the markdown body, its slug, its cover, and its publish lifecycle. Ten
rows seeded. The only content type that is a route rather than a card, and the only one outside the
staging layer that also has a lifecycle. `color` is a pair of Tailwind gradient classes used as the cover
when there is no image.
- `show` is dropped. Nothing writes it, and production tells the more interesting version of the story:
  all ten rows hold `false`, not the schema default of `true`, because the migration that added the
  column back-filled it that way. So `count({ where: { show: true } })` is **0** in production, which
  means the dashboard's "live posts" tile reads 0 while ten posts exist, and its hidden-posts figure
  reads ten. The audit predicted the opposite symptom (drafts counted as live) from the schema default;
  the data says otherwise. Either way all four surfaces have to be repointed at the shared visibility
  predicate, or the counts stay wrong once the column goes.
- `publishedAt` becomes nullable with no default. Stamping at creation back-dates scheduled posts and
  forces a second lifecycle path; one nullable column collapses the two publish-stamp helpers into one.
  This only works as a bundle: create and update must stamp it, the form needs a control, and
  `reviveBlogDates` must preserve null, because `new Date(null)` is a truthy 1970 date that defeats every
  guard downstream.
- The draft's break-site list was wrong in both directions. Two of the `apps/web` sites it named already
  have null branches; four real ones in the admin do not, all non-null dereferences.
- `image` gains `coverAssetId` beside it, `SetNull`, with an at-most-one CHECK. The backfill has to map
  the seed's ten empty strings to NULL first.
- `imageOrientation` stays. See the departures section.
- Gains `createdAt`, which matters here: `publishedAt @default(now())` is the de-facto creation stamp
  today, and separating the two meanings is what makes the nullability safe.
- `[status, publishedAt]` becomes `Desc`, matching the only sort on the column. Note that sort puts NULLs
  first until the published CHECK is validated.
- Worth knowing: the "editorial date" the admin advertises has no UI. Nothing in the admin writes
  `publishedAt` except the publish stamp, which can only pull a future date back to now.

**`ImageOrientation`** — `LANDSCAPE | PORTRAIT | SQUARE`, retained. Maps to a pixel height per card in
the admin's masonry preview. The labels are interpolated raw into a user-visible tooltip and the form
carries a second hand-maintained copy of the set.

### Contact

**`ContactMessage`** — one row per contact-form submission, plus the inbox workflow state on top of it.
There is no separate inbox table: the message row *is* the inbox item. Seven rows at the time the
workflow migration ran. Spam is stored with `status = SPAM` rather than refused, so a false positive is
one click from the inbox. `notificationMessageId` holds the SMTP Message-ID of the owner's notification
mail, purely so a reply can set `In-Reply-To` and land in the same Gmail thread.
- `read` is dropped. Seven writers, zero readers; every badge and count already uses `status`, despite a
  comment in the contact route claiming otherwise. The plan's step named only the route and missed the
  six writes in the admin's own message actions, which would break every inbox action the moment the
  column goes.
- The plan's backfill (`readAt := COALESCE(readAt, updatedAt) WHERE status <> 'UNREAD'`) invents
  opened-times: spam rows are created with `status = SPAM` and `readAt = NULL`, and bulk archive never
  sets `readAt`, so the detail pane would print an "opened" timestamp for messages nobody opened.
- `referrer` stays a full URL, reversing the draft's rename to `referrerHost`. The privacy concern is
  real but a host is the wrong fix: the form is a same-origin fetch, so the stored value is the site's
  own page URL and a host would be a constant. The fix belongs in the route, storing
  `origin + pathname` without the query string.

**`MessageReply`** — one row per reply sent from the inbox, *including* replies whose SMTP send failed.
This is the sent-mail log; the conversation itself continues in Gmail. Created unconditionally with
`deliveryOk`/`deliveryError` carrying the outcome, so a failed attempt shows as a red entry instead of
vanishing.
- `sentById` becomes a real `SetNull` FK, and gains `sentByName` beside it.
- The FK introduces a genuine hazard here, worse than the review claimed: the email is sent *before* the
  row is inserted, and the insert is not wrapped. A ghost session's reply therefore reaches the visitor,
  the insert raises P2003, the message is never marked replied, nothing records the send, and the obvious
  operator response is to press Send again and mail the visitor twice. Re-validate the actor before the
  insert, or move the insert ahead of the send.
- `bodyHtml` stores the entire rendered email document, doctype and inline styles included, roughly 2-3 KB
  per reply that no reader ever touches.

**`ReplyTemplate`** — canned replies for the composer, with `{{name}}` and `{{purpose}}` placeholders.
Zero to ten rows, and zero is a normal state with its own empty state in the UI. `useCount` increments
only on a successful send, so it means "replies sent with this template", and it is the composer's sort
key. Unchanged in v2. Three things the draft missed: `bodyHtml` is misnamed and holds escaped plaintext
that both readers immediately convert back, lossily; `name` is not unique although it is the only label
in the picker; and `updatedAt` cannot mean "last edited" because there is no edit path, so it means
"last successfully used" and nothing reads it.

**`MessageStatus`** — `UNREAD | READ | REPLIED | ARCHIVED | SPAM`, unchanged. Simultaneously the
lifecycle and the inbox's tab router. The guarded transitions live in WHERE clauses, not in the type:
mark-read only matches `UNREAD`, so it cannot walk a replied row back. Adding a sixth member breaks three
exhaustive maps, which is the compiler doing its job.

### GitHub

**`GithubProfile`** — one row per GitHub handle, holding the trailing-year contribution total and the
timestamp of the last successful poll. One row. The handle comes from the `SocialLink` whose `iconKey` is
`github`. `fetchedAt` does double duty: the human "as of" label, and the cutoff past which stored zeros
mean "never fetched" rather than "shipped nothing".
- Gains only the `years` back-relation. `total` is taken verbatim from upstream and is deliberately not
  the sum of the daily archive; the windows differ by a day or two. Do not reconcile them.

**`GithubYear`** — one row per (handle, calendar year), holding that year's daily counts as one character
per day, index 0 = Jan 1 UTC, with an overflow list for days above 63. Two rows. This is the permanent
archive: the upstream feed serves only a trailing ~365 days, so a day not captured before it scrolls out
is unrecoverable, and nothing can rebuild it. Keyed to the calendar year rather than the fetch window
because a trailing window slides daily while Jan 1 never moves, which reduces every merge to "overwrite
the character at this day-of-year".
- Gains a real FK to `GithubProfile.handle`, with **`Restrict`, not the draft's `Cascade`**. Nothing in
  the repo ever deletes a profile, so `Cascade` protects nothing and arms a single DELETE against a
  one-row table to destroy an irreplaceable archive.
- For the same reason, the orphan repair is to INSERT the missing profile, never to DELETE the year, which
  reverses the plan's sweep. And the plan's acceptance test (truncate the profile table and re-run) either
  errors or, retried with CASCADE, empties the archive. Branch-only, and not that test.
- The FK does create a real ordering hazard: the refresh transaction currently upserts every year
  *before* the profile, so the first refresh for a new handle would violate it, and the writer swallows
  the error with a bare catch, so the graph would simply never populate.
- The draft's performance claim should be struck. Neither reader changes, both already run their two
  queries concurrently, and without the `relationJoins` preview feature a Prisma `include` of a to-many
  relation compiles to two sequential queries, which is slower.

### Admin and audit

**`AdminUser`** — one row per admin operator. Single digits. This is the entire identity model; the
public site has no accounts. Sessions are not stored here: login signs a stateless 7-day JWT and the
middleware only verifies its signature.
- Gains `lockedUntil` and `otpAttempts`. Both close real holes. A wrong OTP currently increments nothing,
  so a 6-digit code can be brute-forced for its full 5-minute life; and the lockout is permanent once
  three passwords fail, with the only release being a successful OTP login or a password reset, both of
  which need working SMTP.
- Gains five back-relations so the two admin pages that hand-roll an id-to-name join can stop.
- This table is the clearest case of schema/migration drift: `username`, `failedAttempts`, `otp`,
  `otpExpiresAt` and the `SUB_ADMIN` role exist in the datamodel and in production but in no migration. A
  fresh `migrate deploy` produces a table login cannot query and an enum that rejects `SUB_ADMIN`.

**`AuditEvent`** — one row per admin *gesture*: a Save, a Save & Publish, or a bare Publish. The grain is
deliberately the gesture, not the row or the field, which is what lets one entry read "saved · publish
pending". Publishing is an HTTP call that happens after the save transaction commits and is allowed to
fail without rolling it back, so the three publish columns are mutable on an otherwise append-only row.
The actor is stored four times over, because accounts are hard-deleted and the history must outlive them.
- Four string columns become enums: `AuditAction`, `AuditSurface`, `PublishState`, and `AdminRole` for
  `actorRole`. Only three of them have a CHECK today, so `surface` and `actorRole` both need a value
  assertion before the cast; the plan asks for one only on `surface`.
- `actorRole` is a JWT claim and can be up to 7 days stale by design. As an enum column it must be
  narrowed by a guard at the session boundary, because it currently arrives from an unvalidated cast, and
  one odd value would turn a tolerated oddity into a failed insert that rolls back a whole staged batch.
- Two silent-no-row cases to know: a Save that changed nothing writes no history row at all, and the
  publish-stamp path swallows every error on the principle that bookkeeping must not fail a publish that
  already landed.

**`AuditChange`** — one row per field that actually changed inside one gesture, with before and after as
normalised text. A separate table because the list page renders 200 events from `changeCount` alone and
fetches children only on click. A REORDER emits exactly **one** row for the whole gesture, not one per
item, so dragging 200 things is one row.
- `kind` becomes `AuditChangeKind`. The existing CHECK already guarantees the cast.
- `[entity, rowId]` is dropped. It is verifiably dead, but it is also the only index that could ever
  answer "everything that happened to this row", which is the obvious next feature for a change log.
  Cheap to re-add; know that is the trade.
- `before`/`after` are lossy by design in two ways: values over 2000 characters become a window around
  the first divergence, and the UI renders both the empty string and NULL as the word "empty".

**`AdminRole`** — `OWNER | ADMIN | SUB_ADMIN`, unchanged, and already a real enum. Not decoration: the
numeric ladder built from it is what stops an ADMIN from re-roling an OWNER. The ladder is duplicated in
two files with different shapes; they agree today and nothing tests that they keep agreeing.

**`AuditAction`** *(new enum)* — `SAVE | SAVE_AND_PUBLISH | PUBLISH`. Also gates whether an empty gesture
is recorded: a change-free draft is discarded unless the action is PUBLISH. No `@map`, and the existing
CHECK means the cast cannot fail on data.

**`AuditSurface`** *(new enum)* — `staging | publish | script`, `@map`'d, three members rather than the
draft's two. One writer each: the staged save bar writes `staging`, the bare publish path writes
`publish`, and the `about:copy` script writes `script`. The `@map` is what makes the cast a zero-data-move
operation on the existing lowercase rows. Nothing renders the column, so if the label boundary is not
worth the three call sites, leaving it as `String` is the honest alternative.

**`PublishState`** *(new enum)* — `NONE | OK | FAILED`, and the reason audit rows are mutable at all.
`NONE` is not "unknown": on a plain Save it is the terminal, correct state. Typing it also type-checks the
`publishState: "NONE"` guard that makes the stamp idempotent, where a typo today would silently match
nothing and lose the publish result.

**`AuditChangeKind`** *(new enum)* — `CREATE | UPDATE | DELETE | REORDER`. Drives which diff pane is
hidden. The four members are not four grains: REORDER rows carry a NULL `rowId` and the literal field
name `order`.

### Notes

The notes vault is the largest feature in the admin, lives only in `apps/docs`, and has zero portfolio
relevance. It is also the only tested code in the repo. v2 changes two lines in it.

**`NoteNode`** — one self-referencing tree holding both folders and questions. `parentId` is the source of
truth for nesting; `path` and `depth` are denormalised copies rewritten for the whole subtree on every
create, rename, move, trash, restore, duplicate and import, so "is this folder inside itself" and the
search language's `in:` scope are string comparisons instead of recursive queries. `path @unique` is
load-bearing beyond deduplication: it is the only guard against two root folders sharing a name, because
a unique on `(parentId, slug)` cannot work when every root has a NULL parent. Deletion is soft, and
trashing has to *move* rows out of the live path namespace (`~trash/<rootId>/...`) precisely because
`path` is unique.
- One change: the `text_pattern_ops` prefix index is declared in Prisma instead of living only in raw
  SQL, so `db push`, which the README documents as the setup path, can no longer drop it. The `map:` is
  load-bearing; Prisma's default name would drop the production index and create a differently-named one.
- The migration's justification for that index is wrong for today's code: the `in:` scope compiles to
  ILIKE, which a `text_pattern_ops` btree cannot serve. The real consumer is the case-sensitive folder
  export. Declare it anyway, because `db push` would drop it.
- Two new CHECKs (`parentId <> id`, `depth >= 0`) that no writer can violate today, so they record an
  invariant rather than fixing a bug. They do **not** make the cycle guards dead code: a two-row cycle is
  still legal.

**`NoteAnswer`** — the body, tags and 0-4 self-rating for one question. Shares its primary key with its
node, so it is a strict 1:0..1 extension, and the *presence* of the row is the folder/question
distinction at the data level, which the search language uses as a first-class "unanswered" clause.
- One change: the GIN tags index is declared in Prisma, written bare to match the production DDL.
- The draft names the wrong operator: `tag:` compiles to `hasSome`, which emits `&&`, not `@>`. GIN
  indexes both, but every tag predicate sits inside a relation filter that Prisma compiles to an EXISTS
  correlated on the primary key, so at a few hundred rows the planner will take the PK. Reasoned, not
  measured.
- `confidence` 0 is overloaded: it means "unrated", and the search language relies on that to make
  `conf:0` also match nodes with no answer row at all.
- It is the only model here with `updatedAt` and no `createdAt`, deliberately: the row is born with its
  node, so the node's `createdAt` is the answer's creation time.

**`NoteKind`** — `FOLDER | QUESTION`, unchanged. The rules it implies are enforced in application code,
not the database. The application never actually uses the generated enum: every consumer imports a
hand-rolled union instead, and the zod validators repeat the literals a third time.

### Media

**`MediaAsset`** — one row per R2 object the admin has claimed into its library. R2 is the source of
truth for the bytes; this is the metadata sidecar for the facts an S3-compatible object cannot hold: alt
text, intrinsic dimensions, a ~10px blur placeholder, a display filename, and who uploaded it. The public
site never reads this table. The bucket can contain objects with no row, and rows whose object is gone,
and the admin has a screen for each case.
- Four back-relations arrive with the new foreign keys.
- `uploadedById` becomes a real `SetNull` FK. This is the worst of the five FK additions: the column has
  no reader at all, so it buys integrity only, and it is the one place where the failing insert has
  already had an external side effect, because the bytes are in R2 by then.
- `[folder, createdAt]` is dropped and a `text_pattern_ops` prefix index on `key` replaces it. The folder
  index serves no query, while the browser's prefix scan compiles to `LIKE 'prefix%'`, which the
  default-collation unique index cannot serve. Two honest limits: it does nothing for the empty-prefix
  landing view, and it cannot satisfy the `orderBy key asc`.
- `url` **stays**, and is dropped later by a contract-only migration after the code deploy. It is a stored
  copy of a deterministic function of `key`, so a CDN base change strands every row, but the DTO declares
  it non-optional, three upserts write it and nine UI sites read it. Coupling that to the FK cutover stops
  the admin compiling in a deploy that already changes four tables.
- The `folder` CHECK keeps the denormalised prefix in step with `key`. The draft's reason for the
  `'uploads'` fallback was wrong (no writer can produce a slash-free key, since three guards and a regex
  all refuse bucket-root objects) but `'uploads'` is still right, because it keeps the expression a literal
  transcription of the function that computes the value and of the column's own default.
- The delete-guard design changes, and this is the part the draft got backwards. All four new references
  are **`SetNull`**, or `Cascade` for a gallery slot, **not `Restrict`**. The media browser's "delete
  anyway" override is a real product rule, and `Restrict` turns a confirmed delete into a raw P2003, i.e.
  it silently converts the override into an error path. All three delete paths must also be reordered to
  delete the row first and the object second: a failed object delete leaves a re-adoptable orphan, while
  the current order leaves a dangling row, and the code has a comment recording that preference.

### Flags and delivery

**`FeatureFlag`** — nine section-level kill switches, one row per key in the `packages/shared` registry.
A state store, not a definition store: the label, description, group and default all live in code, and the
row only answers "what is it set to right now". Reads fail open, so a missing row is the code default and
never "off". The admin cannot create rows, only update them, and the seed's update branch deliberately
never names `enabled` so re-seeding cannot un-kill a switch.
- `label` and `description` are dropped; the only writer was the seed script and the only reader was that
  script's own read-back, while the page renders labels from the registry.
- `updatedById` becomes a `SetNull` FK, plus `updatedByName` beside it, which lets the page drop its
  second query outright instead of trading it for an include.
- Caution on the re-seed rewrite: if it starts naming `enabled`, re-seeding silently re-enables every
  switch an operator turned off. Create-if-absent is the correct form.

**`RevalidationLog`** — one row per attempt to flush the public site's cache, with what it cost and what it
said when it failed. Append-only; two attempts are two rows. It is the substrate for a 7-day health panel,
a newest-100 table, and the stale detector's fallback. Pruned at 30 days.
- Gains `scope`, **nullable**, not the draft's required column. The writer sits inside a catch that
  swallows everything, so a required column with no default would silently lose both the log row and the
  `TagState` upsert loop that follows it.
- `scope` gains a fourth member, `MIXED`, because the admin accepts paths and tags in one call and the web
  route honours both, which the draft's three-member enum cannot represent. `PATHS` is dead on arrival:
  no caller in the repo passes paths at all.
- The draft's justification was wrong. A whole-site flush is *not* indistinguishable from a no-op, because
  the only caller that could write a no-op row returns early instead. The column buys legibility, and the
  thing that actually lets the stale detector drop its second query is the `TagState` sentinel, not this.
- `actorId` becomes a `SetNull` FK plus `actorName`. Unlike the flags page, a ghost session here does not
  throw visibly, it just stops recording.
- `[entityType, entityId]` is dropped: both columns are written at six call sites and read by nothing. If
  the index is worth dropping, the columns are worth dropping too.

**`TagState`** — the current flush state of one cache tag, keyed on the tag itself: `lastSuccessAt`,
`lastAttemptAt` and `consecutiveFails`. The success stamp is what the stale detector compares against;
the *pair* is what detects a failure, because an attempt newer than the last success, or a non-zero fail
count, is a tag that is no longer reaching visitors. The derived companion to the log's history. It exists
separately because the stale detector needs a per-tag high-water mark it can compare against
`Blog.updatedAt` in one read, and because the log is pruned at 30 days while the mark must outlive that.
Unchanged in v2, though the plan changes what a row *means* by adding rows whose tag is not a cache tag.
- `lastSuccessAt` is NOT NULL and the failure branch fakes "never succeeded" with epoch, which two readers
  interpret differently. A latent trap documented in the implementation notes still applies: flushing a
  tag that no public read carries returns 200 and stamps a success that invalidated nothing, and
  `tags.project(id)` is exactly such a tag today.

**`RevalidationTrigger`** — `MANUAL | CONTENT_SAVE | SCHEDULED_PUBLISH | FLAG_CHANGE`. `SYSTEM` is
dropped; no writer emits it and the cron the plan adds records `SCHEDULED_PUBLISH`. Postgres has no
`ALTER TYPE ... DROP VALUE`, so this is a type recreation, and it needs a zero-row assertion first.

**`RevalidationStatus`** — `SUCCESS | FAILED | TIMEOUT`, unchanged. Three members rather than a boolean
because a timeout and an HTTP error are operationally different: on a timeout the flush may still have
landed. Only `SUCCESS` stamps `TagState`.

**`RevalidationScope`** *(new enum)* — `SITE | TAGS | PATHS | MIXED`. See `RevalidationLog`.

### Analytics

**`AnalyticsSalt`** — one random salt per UTC day, deleted after 48 hours. This is the privacy mechanism,
not a cache: the salt turns an IP and user-agent into a pseudonymous visitor hash, and once it is gone the
hashes still sitting in other tables can no longer be brute-forced back to an IP. Not even by the owner.
Two to four rows, ever. Unchanged. The 48-hour TTL is deliberately longer than a day so a request in
flight at midnight can still read yesterday's salt. Note the short-link redirect depends on it too, so a
failure here also stops click recording.

**`AnalyticsSession`** — one row per visitor per 30-minute window, holding the attribution and coarse
geo/device facts resolved once, at first contact. Every attribution column is written at create and never
updated, and the original migration says why: re-resolving attribution on a later event lets an internal
click overwrite the source the visitor actually arrived from.
- Gains `rawContent`, `rawTerm` and `messageId`, absorbing `UtmTracker`.
- Drops `lastSeenAt`: one writer, on the hottest public path, zero readers. The write site needs
  restructuring, not just deleting, because with `lastSeenAt` gone the update's data object is literally
  `{}` for any dwell-only batch, which is the normal case.
- `channel` stays `String` with a CHECK. See the departures section.
- Two indexes dropped, two added for the inherited outreach reads. The `[rawContent, startedAt]` composite
  is deliberate: Prisma cannot declare a partial index, and a raw-SQL-only one is exactly what `db push`
  drops.
- What the merge costs, stated plainly. `rawContent` inherits the 90-day retention that `UtmTracker` never
  had, so the "did this recipient visit" match becomes a rolling 90-day window rather than a permanent
  ledger, and it starts from an empty history. The full referrer and the raw user agent are dropped with no
  equivalent, which is the privacy win and also two columns the tracker screen can no longer fill. And the
  capture rule changes: the old route recorded a hit whenever source, medium and campaign were all present,
  while session attribution is written only at session create, so an outreach link opened inside an
  existing 30-minute session records no `rawContent` at all.

**`AnalyticsEvent`** — append-only rows for the two things the beacon reports: a pageview, and a
per-section dwell duration. The raw fact table the rollup reduces into `DailyStat`, after which the rows
are deleted at 90 days. The integer autoincrement key was chosen over BigInt deliberately, because BigInt
does not serialise to JSON and retention keeps the range unreachable.
- `meta` is dropped. `label` is **kept**, reversing the draft: the collector *does* write it and the zod
  schema accepts it, so dropping the column while that code ships fails every collect transaction inside
  a catch that returns 204, i.e. total silent loss of analytics. It goes in the commit that deletes the
  three code sites.
- `[section, createdAt]` is dropped; both section reads are `createdAt` ranges.
- Retention has a floor: deletion stops at the first un-summarised day, so if the rollup starts failing,
  this table grows without bound.

**`EventType`** — narrowed to `PAGEVIEW | SECTION_DWELL`. The other three have never had an emitter. Note
this enum *is* the public beacon contract, because the collect route validates the payload with
`z.nativeEnum`, so narrowing it also narrows the endpoint: a batch containing a `CLICK` stops being one
ignored event and becomes a rejected batch of up to 20. The migration must assert no surviving row carries
a dropped label, because the unauthenticated endpoint has accepted them for a month.

**`TrackedLink`** — the operator's registry of `/r/<slug>` short links, one row per place a link was handed
out. Order of ten rows. The redirect re-validates the stored destination on every hit, because the column
is operator-supplied and would otherwise be an open redirect. `clickCount` and `lastClickAt` are
denormalised so the list can sort by popularity without aggregating.
- `channel` stays `String` with the same CHECK. This column feeds `utm_source` in the URL the operator
  copies into emails, so an uppercase client value would escape into artifacts that cannot be recalled.
- `createdById` becomes a `SetNull` FK. No reader today, so integrity only.
- Two unused indexes dropped; the list page loads every row and filters in JavaScript.
- Only the short `/r` form increments the counter. The full URL attributes the visit but adds nothing here.

**`LinkClick`** — one row per counted open of a short link, with coarse geo, device and referrer host, no
IP and no user agent. Written inside `after()` so the redirect is never delayed, and skipped for bots and
prefetches. A separate table from `AnalyticsEvent` because a click happens before any page exists: there is
no session yet and the visitor may never arrive. Unchanged, correctly: both its indexes serve real queries.
- It has **no retention task**, which v2 does not fix. So "this removes the repo's only unpruned collector"
  is true only of directly identifying data.

**`DailyStat`** — the finished summary of one completed UTC day along one axis: `dimension` says which axis,
`key` is the value on it, and six integer columns carry the measures, of which only a subset is filled per
dimension. It exists so the dashboard never scans the event table for historical windows, and so events can
be deleted at 90 days without losing history. A second, load-bearing job: the existence of a `total` row
for a day is what licenses retention to delete that day's raw events.
- The surrogate `id` is dropped and the natural triple becomes the primary key, which also retires the
  redundant unique and the standalone date index. Prisma derives the same compound input name from `@@id`
  as from `@@unique`, so the existing `findUnique` needs no edit, but the raw upsert must drop `id` from
  its column list and its tuple.
- `dimension` stays `String` with a CHECK. See the departures section.
- Two data traps for a new reader: the key of a `total` row is an em dash, not the word "total"; and
  `unknown` and `(other)` are synthesised keys, never values seen in a session.
- Nothing prunes this table, and nothing in v2 changes that.

**`RollupRun`** — an append-only log of rollup attempts: which day, how it ended, rows written, duration,
trigger, and the first 500 characters of any error. An operational trail rather than part of the data
model, and the only place a failure is visible after the fact, because the rollup runs with no scheduler.
`date` and `createdAt` are deliberately different: a catch-up run today can be about a day three weeks ago.
Pruned at 30 days.
- `status` and `triggeredBy` stay `String` with CHECKs. See the departures section.
- The draft is internally inconsistent about `[date]`, which no reader uses, while dropping `JobLock`'s
  index for exactly that reason. Kept here, so the inconsistency is at least visible.

### The job bed

**`JobLock`** — a one-row-per-key mutex. Today the only key ever taken is `rollup:<date>`, held for at most
120 seconds. It exists because the rollup is triggered by HTTP requests rather than a scheduler, so two
concurrent requests would otherwise roll the same day up twice. `acquireLock` leans on the primary key: a
second concurrent insert throws, and the catch steals the lock only if the existing row has already
expired. `lockedBy` is a random holder token so a process whose lock was stolen cannot release someone
else's.
- `[expiresAt]` is dropped, correctly: every access has the primary key in its WHERE, and nothing scans or
  prunes by expiry. Note nothing prunes this table at all, so an abandoned lock row survives until that
  same key is rolled again.

**`MaintenanceState`** — one row per housekeeping task, holding when it last ran and what it said. There is
no cron, so the five tasks are attempted on every collect beacon and this table is what stops them running
on every request: `claim()` reads `lastRunAt`, returns false if the interval has not elapsed, and otherwise
does a compare-and-swap so only one of N concurrent requests wins. At most five rows. Unchanged.
- `lastRunAt` is bumped *before* the task body runs, which is deliberate for concurrency but means a task
  that throws is locked out for its full interval, 24 hours for retention, with the only evidence an
  `error:` prefix in `lastResult`.

**`RateLimitBucket`** — a fixed-window counter keyed by an opaque string, in Postgres rather than memory
because it has to survive across serverless instances. Two producers: the collect beacon at 200/hour per
visitor, and the contact form at 5/hour per IP. Pruned at 24 hours, which is necessary rather than optional
because the visitor hash rotates daily with the salt. Unchanged, and its index is genuinely used by the
prune.
- It fails **open**: any database error returns "allowed", so a Neon outage silently removes rate limiting
  from both the beacon and the contact form.

---

## Constraints Prisma cannot express

Prisma does not model a CHECK at all. A `db push` leaves existing ones alone but never creates them, so a
push-built database has none of these. Each belongs in a hand-written migration.

| Table | Constraint |
|---|---|
| `SiteSettings` | `id = 1`; six terrain dial ranges; `catNapSeconds BETWEEN 3 AND 300`; `heroDotColor` empty or a hex colour; no blank or whitespace-only element in `heroPhotos` |
| `HeroContent` | `live IS NULL OR live = 'live'` (exists today) |
| `HeroContent` | `HeroContent_version_check` (exists today) must be **dropped**, not kept: it constrains the column being retyped to `SiteVersion` |
| `Blog`, `Project` | `status <> 'PUBLISHED' OR publishedAt IS NOT NULL`; `status <> 'SCHEDULED' OR publishAt IS NOT NULL` |
| `Blog` | not both `coverAssetId` and `image` |
| `Project`, `Experience` | not both `logoAssetId` and `logoUrl` |
| `ProjectImage` | exactly one of `assetId` and `externalUrl` |
| `ProjectHealth` | `status` and `checkedAt` are both set or both null; `latencyMs` requires `status`; `latencyMs >= 0` |
| `Education` | both years `BETWEEN 1950 AND 2200`; `endYear >= startYear` |
| `Experience` | `endedOn >= startedOn`; both dates fall on day 01 |
| `Skill` | `CREATE UNIQUE INDEX ON "Skill" (lower("name"))` |
| `GithubYear` | `length(days) IN (365, 366)`; `year BETWEEN 2005 AND 2200` (both exist today) |
| `NoteNode` | `parentId IS NULL OR parentId <> id`; `depth >= 0` |
| `NoteAnswer` | `confidence BETWEEN 0 AND 4` |
| `MediaAsset` | `folder` equals the directory prefix of `key`, falling back to `'uploads'` |
| `AnalyticsSession`, `TrackedLink` | `channel` in the eleven-label attribution set |
| `DailyStat` | `dimension` in the seven-label set |
| `RollupRun` | `status` in `ok/skipped/error`; `triggeredBy` in `manual/catch-up` |

`Skill_name_lower_key` is the one index in this schema that cannot be declared, because Prisma has no
functional index. `db push` **will** drop it, and it is a UNIQUE index, so losing it silently loses
case-insensitive skill identity. Re-apply that one statement after any push, and prefer `migrate deploy`.

Every CHECK on a busy table should be added `NOT VALID` and then validated, and every value-set CHECK
should be preceded by a `SELECT DISTINCT` assertion rather than a `USING CASE` rewrite: these sets have
been stable since they were introduced, so a stray value is information, not noise.

---

## The order to migrate in

The schema file is the destination, not a migration. Nine of these steps break a live feature if the
schema half ships without the code half in the same deploy; those are marked **coupled**.

1. Give `packages/db` a typecheck and a lint task, and widen its tsconfig. No SQL. First, because every
   later step edits the seed and the scripts, and today nothing checks them.
2. Disarm the tooling. A `DATABASE_URL` host guard on the seed, its sixteen `deleteMany` calls converted to
   keyed upserts, a separate `TEST_DATABASE_URL`, and a standing staging branch. Highest-leverage hour in
   the plan: it makes every later step survivable.
3. Repair the migration history so a fresh database can be built from it, guarded with `IF NOT EXISTS` so
   it is a no-op against production. `ContactMessage` has no `CREATE TABLE` anywhere, and neither do
   `AdminUser.username`, `failedAttempts`, `otp`, `otpExpiresAt`, `AdminRole.SUB_ADMIN` or `Project.images`.
4. The enum pass with no data move: `AuditAction`, `PublishState`, `AuditChangeKind`, `AdminRole` on
   `actorRole`, and `AuditSurface` with its three members. Assert the value sets first; two of the four
   columns have no CHECK today. **coupled** (the script that writes `surface='script'`).
5. `SiteVersion` on **four** version columns, dropping **four** `*_version_check` constraints. Three are
   on `HeroTitle`, `HeroSkillBadge` and `SocialLink`; the fourth, `HeroContent_version_check`, is easy to
   miss because it was added by a different migration and because the draft's plan put that cast in a step
   whose other half (dropping `HeroContent.id` and `live`) is now rejected. `HeroTitle` and
   `HeroSkillBadge` carry a default, so those two casts must `DROP DEFAULT`, retype, then `SET DEFAULT`;
   `HeroContent.version` has no default and needs only the constraint dropped before the retype.
6. Create `SiteSettings` and backfill it from `SiteConfig` without dropping `SiteConfig`. Trim and filter
   `heroPhotos` in the backfill.
7. Cut the admin over to `SiteSettings`, and repoint the media reference scan at the three named columns.
   **coupled.** Then drop `SiteConfig`.
8. The five admin foreign keys with their denormalised name columns: null the orphans, add the constraints
   `SetNull`, add the supporting indexes. **coupled** (re-validate the actor before the media and reply
   inserts, which have already had an external side effect by then).
9. `AdminUser.lockedUntil` and `otpAttempts`, shipped with the auth fix: count OTP misses, replace the
   permanent lock with a window, and wrap login, OTP send, OTP verify and forgot-password in the rate
   limiter that already exists.
10. Timestamps on nine models plus `Project.createdAt`. Add NOT NULL with a default, then drop the default,
    except `ContactPurpose.updatedAt`, which keeps it to match `ContactMessage`.
11. Lifecycle unification: `Blog.publishedAt` nullable, then the four CHECKs on both content tables, with a
    repair `UPDATE` for `Project` first. **coupled** (create and update must stamp it, the form needs a
    control, `reviveBlogDates` must preserve null, and four admin dereferences are non-null today).
12. Drop `Blog.show` and `ContactMessage.read`. **coupled** (four admin surfaces repointed at the shared
    visibility predicate, and the six inbox writes removed, not just the one in the contact route). Do not
    invent `readAt` values for rows nobody opened.
13. The explicit skill joins: create both, `INSERT ... SELECT` with `row_number()`, drop the implicit tables.
    **coupled** (`sortOrder` has no default, so every write path changes and every read needs an `orderBy`).
14. Hero badges become a relation, with the `label` override column so no duplicate skill has to be minted.
    **coupled** (the badge editor becomes a skill picker, and the staged delete needs a badge count).
15. Typed dates on `Experience` and `Education`: add the new columns, backfill with the existing parser plus
    an assertion, verify every row resolved, ship the render switch, then drop the old columns. **coupled**,
    and the largest code half in the plan. Two details worth writing into the migration: `Education` keeps
    its column names, so it is an in-place retype (or a temp column and a rename), not the rename-based
    expand and contract `Experience` uses, and it needs a `DROP NOT NULL` on `endYear` in the same
    transaction. And the two source documents disagree on the data rule, mutually exclusively for a row
    holding `Present`; the workable rule is to abort on a `startYear` that is not four digits, map a
    non-numeric `endYear` to NULL, and print every id it nulled.
16. Media relations, in three deploys: adopt every referenced object into the library and report the
    unresolved; add the nullable FK columns beside the existing string columns and backfill; then switch the
    readers. `SetNull`, not `Restrict`, and reorder the three delete paths to delete the row before the
    object. **coupled.**
17. Give the system a clock: a cron-protected route running scheduled publishing, then rollup catch-up, then
    maintenance. No schema change, and the lock and state tables already make it safe to overlap with the
    beacon path.
18. `ProjectHealth`, and move the probe out of the render into a scheduled task. **coupled** (clear the row
    when `Project.live` changes).
19. Retention for the click and tracker tables, and the analytics kill switch on the redirect route. No
    schema change, and it makes the next step cheap.
20. `GithubYear`'s foreign key, `Restrict`. Repair orphans by inserting the profile, and reorder the refresh
    transaction to upsert the profile first. **coupled.**
21. Merge the UTM capture: add the three columns and the two indexes, repoint the tracker and outreach
    screens, then drop `UtmTracker` and its route and beacon. **coupled**, and the only phase with real
    regression surface.
22. Analytics slimming: drop `lastSeenAt` and `meta`, narrow `EventType` through the rename/create/cast/drop
    dance with a zero-row assertion, drop the dead indexes. **coupled** (restructure the session update so a
    dwell-only batch does not issue an empty one). `AnalyticsEvent.label` waits for its own commit.
23. `DailyStat`'s natural key: drop `id`, add the compound primary key, and edit the raw upsert's column list
    and tuple in the same deploy. **coupled** (a failed rollup silently freezes event retention).
24. The value-set CHECKs on `channel`, `dimension`, `status` and `triggeredBy`, each `NOT VALID` then
    validated, each preceded by its assertion.
25. `RevalidationLog.scope` nullable, with the writer; drop `RevalidationTrigger.SYSTEM` after asserting no
    row carries it; have a site flush stamp `TagState`.
26. Quotes: `sortOrder` by `row_number()` over the current id order so nothing moves on migration day, plus
    the sortable-entity work the column requires. **coupled.**
27. Declare the two notes indexes under their existing names, and add the three notes CHECKs.
28. Drop `MediaAsset.url`, contract-only, after the code deploy that stopped reading it.
29. Rewrite `packages/db/src/index.ts`'s enum re-export. It is a curated list of nine names today and eight
    new enums are unreachable without it. The better form is one line, `export * from
    "./generated/prisma/enums"`, which tracks the schema automatically and removes the export bookkeeping
    from seven of the steps above. It must stay a value export, not `export type`: the collect route feeds
    `EventType` to `z.nativeEnum` at runtime.
30. Delete `db.md` and point the README here.

---

## The branch, and how it was built

A Neon child branch holds the new schema with a full copy of production data. It was built without
running a single statement against production, in four steps, each with its own command:

    bun run db:dump                      whole database -> one JSON, read-only
    bun run db:transform --in= --out=    old-shape JSON -> new-shape JSON, no database involved
    bun run db:apply-sql --file=         run a .sql file against NEW_DATABASE_URL
    bun run db:restore --file=           JSON -> database
    bun run db:verify                    compare a database against this schema

`DATABASE_URL` now points at the branch in all three `.env` files, so both apps and every Prisma command
read the branch by default. Production moved to `PROD_DATABASE_URL`, which exists for exactly two
reasons: dumping it (`db:dump --from=PROD_DATABASE_URL`), and being the host the write tools refuse.

Three safety properties worth keeping. `db:dump` runs inside `begin transaction read only isolation
level repeatable read`, so Postgres itself refuses any write and the snapshot is consistent. `db:restore`
and `db:apply-sql` are dry-run by default and refuse outright if the target resolves to the host in
`PROD_DATABASE_URL`. That guard is keyed to production specifically, not to "whatever `DATABASE_URL`
happens to be" — an earlier version did the latter and silently stopped protecting production the moment
`DATABASE_URL` was repointed at the branch. And the transform is a pure JSON-to-JSON step, so the whole
data migration can be inspected and diffed before anything touches a database.

The schema itself came from `prisma migrate diff --from-empty --to-schema`, i.e. Prisma generated it from
this file. That makes drift impossible by construction, which is why `db:verify` comes back clean.

**What the branch does NOT have: any of the CHECK constraints above.** Prisma does not model a CHECK, so
its generated DDL contains none of them. They have to be applied separately.

### Two things the exercise proved

**Prisma cannot see a btree operator class.** `prisma db pull` reads both `@@index([key(ops:
raw("text_pattern_ops"))])` declarations back as a plain `@@index([key], map: ...)`, dropping the opclass,
while correctly preserving `type: Gin` on the GIN index beside it. Consequences: `migrate diff` reports
`MediaAsset_key_prefix_idx` and `NoteNode_path_prefix_idx` as pending forever even when the database
carries the opclass, so a drift check has to whitelist them (`db:verify` does) and the opclass must be
confirmed with `pg_indexes`, not with Prisma. The good news is that declaring them still works as
intended: a `db push` diff recreates them *from the datamodel*, which does carry the opclass.

**The `@db.Date` reading trap is real, and it is a day, not a month.** Reading `Experience.startedOn`
through node-pg in IST returns `2025-06-30T18:30:00Z` for a stored `2025-07-01`, because the driver
parses a bare `date` at local midnight. The stored value is correct; every reader must format with
`timeZone: 'UTC'` and do tenure arithmetic on UTC getters, or the public timeline will print dates a day
early for anyone east of UTC and a day late west of it.

## Open questions

Decisions taken in this file that could reasonably have gone the other way.

**The outreach match is now a 90-day window.** `rawContent` is pruned with its session, where
`UtmTracker`'s history was unpruned. If an all-time ledger is a requirement rather than a nicety, the
alternative is a small `OutreachVisit` table written alongside the session, and dropping `rawContent`. As it
stands the outreach screen needs relabelling to say what it now shows.

**`ContactPurpose.label` has no database uniqueness at all.** Prisma's immediate constraint provably breaks
two legitimate staged edits, so the check moved to preflight. That makes the preflight check load-bearing
rather than defence in depth.

**`Skill` carries both a declared `name @unique` and the raw lower-case index.** Redundant on purpose, so
that a `db push` which drops the functional index still leaves exact-match identity standing. Drop the
declared one if the redundancy grates, but then `db push` must never be the documented setup path.

**`MediaAsset.url` and `folder` are both kept, and both are derivable from `key`.** Internally inconsistent,
resolved by keeping both rather than dropping both, so this file stays a safe recovery source today.

**`AnalyticsEvent.label` is still here** even though the plan intends to remove it, because the drop is only
safe in the commit that also deletes the three code sites. Delete the field when you ship that commit.

**Nothing verifies the constraint table above against the database.** It is a checklist, and it will drift
the first time someone adds a constraint in a migration and not here. Generating it from `pg_constraint` and
diffing would be better than maintaining it by hand.
