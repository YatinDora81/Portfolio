import { prisma } from "db";
import { redirect } from "next/navigation";
import { FLAG_DEFINITIONS, flagValue, type FlagMap } from "@repo/shared/flags";
import { PageHeader } from "@/components/shared/page-header";
import { getSession } from "@/lib/session";
import { IconAlertTriangle, IconToggleLeft, IconPlugConnected } from "@tabler/icons-react";
import { FlagBoard, type FlagRow } from "./parts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
