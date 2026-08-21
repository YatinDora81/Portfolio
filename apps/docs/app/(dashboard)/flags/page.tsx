import { prisma } from "db";
import { redirect } from "next/navigation";
import { FLAG_DEFINITIONS, flagValue, type FlagMap } from "@repo/shared/flags";
import { PageHeader } from "@/components/shared/page-header";
import { getSession } from "@/lib/session";
import { IconAlertTriangle, IconToggleLeft, IconPlugConnected } from "@tabler/icons-react";
import { FlagBoard, type FlagRow } from "./parts";

// The whole page is a picture of what the live site is currently doing. A
// cached render would show the switch positions from before the incident
// somebody just switched something off for.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * `FeatureFlag.updatedAt` reaches this page straight from Prisma — no
 * `unstable_cache` in the way — so it is a real `Date` here, and formatting it
 * is this file's job. On the server, with the zone named: a `toLocaleString()`
 * inside the client component would use the server's zone during SSR and the
 * browser's on hydration, which is exactly the text mismatch React tears the
 * tree down over. Same reasoning, same formatter shape as
 * (dashboard)/revalidation/page.tsx.
 */
const IST = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST, day: "2-digit", month: "short", year: "numeric", hourCycle: "h23",
  hour: "2-digit", minute: "2-digit",
});
const day = (d: Date) => `${dayFmt.format(d)} IST`;

export default async function FlagsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stored = await prisma.featureFlag.findMany();
  const byKey = new Map(stored.map((f) => [f.key, f]));

  const map: FlagMap = Object.fromEntries(stored.map((f) => [f.key, f.enabled]));

  // One query over the distinct ids actually present, not a join: `updatedById`
  // is a plain String so hard-deleting an admin cannot take the flag's history
  // with it, which means some ids here resolve to nobody. Those render as the
  // raw id — a true answer beats a crash. The signed-in admin is folded into
  // the same query so a change made on this page can name its author without a
  // second round trip.
  const actorIds = [
    ...new Set([
      ...stored.map((f) => f.updatedById).filter((id): id is string => id !== null),
      session.userId,
    ]),
  ];
  const admins = await prisma.adminUser.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const actors: Record<string, string> = {};
  for (const a of admins) actors[a.id] = a.name;

  // One row per registry entry, never per database row. A flag whose row is
  // missing — added to the registry since the last `flags:seed`, or deleted by
  // hand — is precisely the flag you need to see: `flagValue` is failing open
  // to its default, so the site is serving it as ON while nothing in the table
  // says so. Listing only what the table holds would hide it completely.
  const rows: FlagRow[] = FLAG_DEFINITIONS.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      group: def.group,
      enabled: flagValue(map, def.key),
      defaultEnabled: def.defaultEnabled,
      note: row?.note ?? null,
      present: row !== undefined,
      changedAt: row ? day(row.updatedAt) : null,
      changedBy: row?.updatedById ? (actors[row.updatedById] ?? row.updatedById) : null,
    };
  });

  const off = rows.filter((r) => !r.enabled);
  const missing = rows.filter((r) => !r.present);

  return (
    <div className="view">
      <PageHeader
        eyebrow="operations · kill switches"
        title="Feature flags"
        description="Every switch the public site reads, and what it is set to right now. Turning one off hides that part of the site from the next visit onward — nothing is deleted and nothing is republished."
      />

      {missing.length > 0 ? (
        <div className="rv-banner bad">
          <i><IconAlertTriangle size={17} stroke={1.7} /></i>
          <div>
            <b>{missing.length} flag{missing.length === 1 ? " has" : "s have"} no row in the database</b>
            {missing.map((r) => r.key).join(", ")} — the site is serving{" "}
            {missing.length === 1 ? "it" : "them"} at the registry default because the lookup fails
            open, and the switch{missing.length === 1 ? "" : "es"} below cannot be saved until the
            row exists. Run <code>bun run flags:seed</code> in packages/db.
          </div>
        </div>
      ) : null}

      <div className="stat-grid even">
        <div className="stat">
          <div className="stat-k"><IconPlugConnected size={11} /> switches</div>
          <div className="stat-v">{rows.length}</div>
          <div className="stat-m">every flag the site knows how to read</div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconToggleLeft size={11} /> currently off</div>
          <div className="stat-v">{off.length}</div>
          <div className="stat-m">
            {off.length === 0 ? <em>the whole site is live</em> : <i>{off.map((r) => r.label).join(" · ")}</i>}
          </div>
        </div>
      </div>

      <FlagBoard rows={rows} actor={actors[session.userId] ?? "you"} />
    </div>
  );
}
