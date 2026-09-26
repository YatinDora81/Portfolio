import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

type Col = { name: string; udt: string };
type Table = { name: string; columns: Col[]; rows: Record<string, any>[] };
type Dump = { generatedAt: string; source: { host: string; database: string }; tables: Table[] };

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const [k, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(k!, rest.join("=") || "true");
}

const inFile = args.get("in");
const outFile = args.get("out");
if (!inFile || !outFile) {
  console.error("pass --in=<old-dump.json> --out=<new-dump.json>");
  process.exit(1);
}

const dump = JSON.parse(readFileSync(inFile, "utf8")) as Dump;
const src = new Map(dump.tables.map((t) => [t.name, t]));
const rows = (n: string) => src.get(n)?.rows ?? [];
const stamp = dump.generatedAt;

const notes: string[] = [];
const note = (s: string) => notes.push(s);

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function monthStart(value: string): string | null {
  const m = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  return `${m[2]}-${String(month).padStart(2, "0")}-01`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const asInt = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return clamp(Number.isFinite(n) ? n : fallback, lo, hi);
};
const asBool = (v: unknown, fallback: boolean) =>
  v === undefined || v === null || v === "" ? fallback : String(v) === "on" || String(v) === "true";
const asStr = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v));
const asVersion = (v: unknown, fallback: "v1" | "v2") => (v === "v1" || v === "v2" ? v : fallback);

const NAP = ["tooltip", "ring", "halo", "pixel", "moon", "ticks", "random", "off"];

const config = new Map(rows("SiteConfig").map((r) => [r.key as string, r.value as string]));

const heroPhotos = asStr(config.get("heroPhotos"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const napStyle = NAP.includes(asStr(config.get("catNapStyle"))) ? asStr(config.get("catNapStyle")) : "ticks";
const dot = asStr(config.get("heroDotColor"));
const heroDotColor = dot === "" || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(dot) ? dot : "";
if (heroDotColor !== dot) note(`heroDotColor ${JSON.stringify(dot)} failed the hex check and became ''`);

const siteSettings = [
  {
    id: 1,
    name: asStr(config.get("name")),
    avatarUrl: asStr(config.get("avatarUrl")),
    heroPhotos,
    resumeUrl: asStr(config.get("resumeUrl")),
    projectsVersion: asVersion(config.get("projectsVersion"), "v2"),
    backgroundVersion: asVersion(config.get("backgroundVersion"), "v1"),
    heroDotColor,
    heroDotPulse: asBool(config.get("heroDotPulse"), true),
    navbarLogo: asStr(config.get("navbarLogo")),
    copyrightName: asStr(config.get("copyrightName")),
    contactEmail: asStr(config.get("contactEmail")),
    availabilityStatus: asStr(config.get("availabilityStatus")),
    availabilityDetail: asStr(config.get("availabilityDetail")),
    terrainStrength: asInt(config.get("terrainStrength"), 50, 10, 100),
    terrainVeil: asInt(config.get("terrainVeil"), 50, 0, 90),
    terrainCell: asInt(config.get("terrainCell"), 12, 8, 28),
    terrainLevels: asInt(config.get("terrainLevels"), 14, 4, 24),
    terrainMinor: asInt(config.get("terrainMinor"), 20, 2, 60),
    terrainMajor: asInt(config.get("terrainMajor"), 48, 5, 90),
    terrainChannel: asBool(config.get("terrainChannel"), true),
    terrainInteractive: asBool(config.get("terrainInteractive"), true),
    catNapStyle: napStyle,
    catNapSeconds: asInt(config.get("catNapSeconds"), 30, 3, 300),
    createdAt: stamp,
    updatedAt: stamp,
  },
];

for (const key of ["heroVersion", "intro", "tagline"]) {
  if (config.has(key)) note(`SiteConfig.${key} = ${JSON.stringify(config.get(key))} dropped as legacy`);
}
const known = new Set([
  "name", "avatarUrl", "heroPhotos", "resumeUrl", "projectsVersion", "backgroundVersion",
  "heroDotColor", "heroDotPulse", "navbarLogo", "copyrightName", "contactEmail",
  "availabilityStatus", "availabilityDetail", "terrainStrength", "terrainVeil", "terrainCell",
  "terrainLevels", "terrainMinor", "terrainMajor", "terrainChannel", "terrainInteractive",
  "catNapStyle", "catNapSeconds", "heroVersion", "intro", "tagline",
]);
for (const key of config.keys()) if (!known.has(key)) note(`SiteConfig.${key} was not in the registry and is dropped`);

const skills = rows("Skill");
const skillById = new Map(skills.map((s) => [s.id as string, s]));
const skillByLower = new Map(skills.map((s) => [(s.name as string).toLowerCase(), s]));

const skillOut = skills.map((s) => ({
  id: s.id, name: s.name, iconKey: s.iconKey, showInGrid: s.show,
  sortOrder: s.sortOrder, createdAt: s.createdAt, updatedAt: s.updatedAt,
}));

const badgeOut = rows("HeroSkillBadge").map((b) => {
  const skill = skillByLower.get((b.name as string).toLowerCase());
  const fallback = skillByLower.get((b.iconKey as string).toLowerCase());
  const target = skill ?? fallback;
  if (!target) throw new Error(`HeroSkillBadge ${b.name} matches no Skill by name or iconKey`);
  if (!skill) note(`badge ${JSON.stringify(b.name)} matched Skill ${JSON.stringify(target.name)} via iconKey, label kept`);
  return {
    id: b.id, version: b.version, skillId: target.id,
    label: target.name === b.name ? null : b.name,
    sortOrder: b.sortOrder, createdAt: stamp, updatedAt: stamp,
  };
});

const skillRank = (id: string) => {
  const s = skillById.get(id);
  return s ? (s.sortOrder as number) : Number.MAX_SAFE_INTEGER;
};

function joinRows(table: string, parentKey: string) {
  const byParent = new Map<string, string[]>();
  for (const r of rows(table)) {
    const list = byParent.get(r.A as string) ?? [];
    list.push(r.B as string);
    byParent.set(r.A as string, list);
  }
  const out: Record<string, unknown>[] = [];
  for (const [parent, skillIds] of byParent) {
    skillIds
      .slice()
      .sort((a, b) => skillRank(a) - skillRank(b) || String(skillById.get(a)?.name).localeCompare(String(skillById.get(b)?.name)))
      .forEach((skillId, i) => out.push({ [parentKey]: parent, skillId, sortOrder: i }));
  }
  return out;
}

const experienceOut = rows("Experience").map((e) => {
  const startedOn = monthStart(e.startDate as string);
  if (!startedOn) throw new Error(`Experience ${e.company}: cannot parse startDate ${JSON.stringify(e.startDate)}`);
  let endedOn: string | null = null;
  if (!e.isCurrent) {
    endedOn = monthStart(e.endDate as string);
    if (!endedOn) throw new Error(`Experience ${e.company}: cannot parse endDate ${JSON.stringify(e.endDate)}`);
  } else if (String(e.endDate).trim().toLowerCase() !== "present") {
    note(`Experience ${e.company}: isCurrent with endDate ${JSON.stringify(e.endDate)}, endedOn set NULL and that date dropped`);
  }
  return {
    id: e.id, company: e.company, position: e.position, location: e.location,
    startedOn, endedOn, website: e.website,
    logoUrl: e.logoUrl, logoAssetId: null,
    visibleBullets: e.visibleBullets, sortOrder: e.sortOrder,
    createdAt: stamp, updatedAt: stamp,
  };
});

const educationOut = rows("Education").map((ed) => {
  const start = Number.parseInt(String(ed.startYear), 10);
  if (!Number.isFinite(start)) throw new Error(`Education startYear ${JSON.stringify(ed.startYear)} is not numeric`);
  const rawEnd = String(ed.endYear ?? "").trim();
  const end = /^\d{4}$/.test(rawEnd) ? Number.parseInt(rawEnd, 10) : null;
  if (end === null && rawEnd !== "") note(`Education endYear ${JSON.stringify(ed.endYear)} is not a year and became NULL`);
  return {
    id: ed.id, institution: ed.institution, location: ed.location, degree: ed.degree,
    scoreType: ed.scoreType, score: ed.score, scoreTotal: ed.scoreTotal,
    startYear: start, endYear: end, sortOrder: ed.sortOrder,
    createdAt: stamp, updatedAt: stamp,
  };
});

const projectImages: Record<string, unknown>[] = [];
const projectOut = rows("Project").map((p) => {
  (p.images as string[] | null ?? []).forEach((value, i) => {
    if (!value) return;
    projectImages.push({
      id: randomUUID(), projectId: p.id,
      assetId: null, externalUrl: value, sortOrder: i,
    });
  });
  return {
    id: p.id, title: p.title, summary: p.summary, github: p.github, live: p.live,
    sortOrder: p.sortOrder, logoUrl: p.logoUrl, logoAssetId: null,
    status: p.status, publishAt: p.publishAt, publishedAt: p.publishedAt,
    createdAt: p.publishedAt ?? stamp, updatedAt: p.updatedAt,
  };
});

const blogOut = rows("Blog").map((b) => {
  const drafted = b.status !== "PUBLISHED";
  if (drafted && b.publishedAt) note(`Blog ${b.slug}: status ${b.status}, creation-stamp publishedAt moved to createdAt and publishedAt set NULL`);
  return {
    id: b.id, slug: b.slug, title: b.title, description: b.description, content: b.content,
    color: b.color, sortOrder: b.sortOrder, imageOrientation: b.imageOrientation,
    image: b.image === "" ? null : b.image, coverAssetId: null,
    status: b.status, publishAt: b.publishAt,
    publishedAt: drafted ? null : b.publishedAt,
    createdAt: b.publishedAt ?? stamp, updatedAt: b.updatedAt,
  };
});

const admins = new Map(rows("AdminUser").map((a) => [a.id as string, a.name as string]));

const quoteOut = rows("Quote")
  .slice()
  .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  .map((q, i) => ({ id: q.id, quote: q.quote, author: q.author, sortOrder: i, createdAt: stamp, updatedAt: stamp }));

const withStamps = (name: string) => rows(name).map((r) => ({ ...r, createdAt: stamp, updatedAt: stamp }));

const passthrough = (name: string) => rows(name).map((r) => ({ ...r }));

const out: Record<string, Record<string, unknown>[]> = {
  SiteSettings: siteSettings,
  HeroContent: rows("HeroContent").map((h) => ({ ...h, createdAt: stamp, updatedAt: stamp })),
  HeroTitle: withStamps("HeroTitle"),
  HeroSkillBadge: badgeOut,
  SocialLink: withStamps("SocialLink"),
  AboutParagraph: withStamps("AboutParagraph"),
  Education: educationOut,
  Skill: skillOut,
  Experience: experienceOut,
  ExperienceBullet: passthrough("ExperienceBullet"),
  ExperienceSkill: joinRows("_ExperienceToSkill", "experienceId"),
  Project: projectOut,
  ProjectBullet: passthrough("ProjectBullet"),
  ProjectSkill: joinRows("_ProjectToSkill", "projectId"),
  ProjectImage: projectImages,
  ProjectHealth: [],
  Blog: blogOut,
  Quote: quoteOut,
  ContactPurpose: withStamps("ContactPurpose"),
  ContactMessage: passthrough("ContactMessage"),
  MessageReply: rows("MessageReply").map((m) => ({ ...m, sentByName: admins.get(m.sentById as string) ?? null })),
  ReplyTemplate: passthrough("ReplyTemplate"),
  GithubProfile: passthrough("GithubProfile"),
  GithubYear: passthrough("GithubYear"),
  AdminUser: rows("AdminUser").map((a) => ({ ...a, lockedUntil: null, otpAttempts: 0 })),
  AuditEvent: passthrough("AuditEvent"),
  AuditChange: passthrough("AuditChange"),
  NoteNode: passthrough("NoteNode"),
  NoteAnswer: passthrough("NoteAnswer"),
  MediaAsset: passthrough("MediaAsset"),
  FeatureFlag: rows("FeatureFlag").map((f) => ({ ...f, updatedByName: admins.get(f.updatedById as string) ?? null })),
  RevalidationLog: rows("RevalidationLog").map((r) => ({ ...r, scope: null, actorName: admins.get(r.actorId as string) ?? null })),
  TagState: passthrough("TagState"),
  AnalyticsSalt: passthrough("AnalyticsSalt"),
  AnalyticsSession: rows("AnalyticsSession").map((s) => ({ ...s, rawContent: null, rawTerm: null, messageId: null })),
  AnalyticsEvent: passthrough("AnalyticsEvent"),
  TrackedLink: passthrough("TrackedLink"),
  LinkClick: passthrough("LinkClick"),
  DailyStat: passthrough("DailyStat"),
  RollupRun: passthrough("RollupRun"),
  JobLock: passthrough("JobLock"),
  MaintenanceState: passthrough("MaintenanceState"),
  RateLimitBucket: passthrough("RateLimitBucket"),
};

const dropped = ["SiteConfig", "UtmTracker", "_ExperienceToSkill", "_ProjectToSkill"];
for (const name of dropped) note(`${name}: ${rows(name).length} rows not carried into the new schema`);

const tables = Object.entries(out).map(([name, data]) => ({
  name,
  columns: Object.keys(data[0] ?? {}).map((k) => ({ name: k, udt: "" })),
  rows: data,
}));

const total = tables.reduce((n, t) => n + t.rows.length, 0);
const before = dump.tables.reduce((n, t) => n + t.rows.length, 0);

writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: { host: `${dump.source.host} (transformed)`, database: dump.source.database },
      transformedFrom: inFile,
      tableCount: tables.length,
      rowCount: total,
      tables,
    },
    null,
    2,
  ),
);

for (const t of tables) console.log(`${t.name.padEnd(24)} ${t.rows.length}`);
console.log(`\n${tables.length} tables, ${total} rows (was ${before} across ${dump.tables.length})`);
console.log(`\nnotes:`);
for (const n of notes) console.log(`  ${n}`);
console.log(`\n-> ${outFile}`);
