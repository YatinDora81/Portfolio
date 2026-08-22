import { prisma } from "db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  IconArrowLeft,
  IconMapPin,
  IconPointer,
  IconQrcode,
  IconUsers,
} from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHead } from "@/components/ui/card";
import { istLabel } from "@/lib/lifecycle";
import { getSession } from "@/lib/session";
import { fullUrl, qrDataUrl, shortUrl } from "@/lib/tracked-links";
import { ActiveToggle, CopyButton } from "../parts";
import { ClickTimeline, type ClickDay } from "../timeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const RECENT_CLICKS = 50;

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

function istDayIndex(instant: Date): number {
  return Math.floor((instant.getTime() + IST_OFFSET_MS) / DAY_MS);
}

function flagOf(code: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 127397 + (c.codePointAt(0) ?? 0)),
  );
}

function Breakdown({
  rows,
  empty,
}: {
  rows: { key: string; label: string; count: number }[];
  empty: string;
}) {
  if (rows.length === 0) return <div className="tl-none">{empty}</div>;

  const top = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="tl-bars">
      {rows.map((r) => (
        <div className="tl-bar" key={r.key}>
          <span className="tl-bar-k">{r.label}</span>
          <span className="tl-bar-t">
            <span style={{ width: `${(r.count / top) * 100}%` }} />
          </span>
          <span className="tl-bar-n">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function TrackedLinkDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const link = await prisma.trackedLink.findUnique({ where: { id } });
  if (!link) notFound();

  const todayIndex = istDayIndex(new Date());
  const windowStart = new Date((todayIndex - (WINDOW_DAYS - 1)) * DAY_MS - IST_OFFSET_MS);
  const dayStart = new Date(todayIndex * DAY_MS - IST_OFFSET_MS);

  const [windowClicks, byCountry, byDevice, todayVisitors, recent] = await Promise.all([
    prisma.linkClick.findMany({
      where: { linkId: link.id, createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    prisma.linkClick.groupBy({
      by: ["country"],
      where: { linkId: link.id },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["deviceType"],
      where: { linkId: link.id },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["visitorHash"],
      where: { linkId: link.id, createdAt: { gte: dayStart } },
    }),
    prisma.linkClick.findMany({
      where: { linkId: link.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_CLICKS,
    }),
  ]);

  const counts = new Array<number>(WINDOW_DAYS).fill(0);
  for (const click of windowClicks) {
    const slot = istDayIndex(click.createdAt) - (todayIndex - (WINDOW_DAYS - 1));
    if (slot >= 0 && slot < WINDOW_DAYS) counts[slot] = (counts[slot] ?? 0) + 1;
  }

  const days: ClickDay[] = counts.map((clicks, i) => ({
    day: dayFormat.format(new Date((todayIndex - (WINDOW_DAYS - 1) + i) * DAY_MS - IST_OFFSET_MS)),
    clicks,
  }));
  const windowTotal = counts.reduce((a, b) => a + b, 0);

  const short = shortUrl(link.slug);
  const full = fullUrl(link);
  const qr = await qrDataUrl(short);

  const countries = byCountry
    .map((r) => ({
      key: r.country ?? "unknown",
      label: `${flagOf(r.country)} ${r.country ?? "unknown"}`.trim(),
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const devices = byDevice
    .map((r) => ({
      key: r.deviceType ?? "unknown",
      label: r.deviceType ?? "unknown",
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="view wide">
      <Link className="tl-back" href="/tracked-links">
        <IconArrowLeft size={13} stroke={1.7} /> All tracked links
      </Link>

      <PageHeader eyebrow={`outreach · ${link.channel}`} title={link.label}>
        <ActiveToggle id={link.id} label={link.label} active={link.active} />
      </PageHeader>

      <Card flush className="rv-card">
        <CardHead
          title="The link"
          right={link.active ? <Badge variant="success" dot>live</Badge> : <Badge variant="outline">retired</Badge>}
        />
        <div className="tl-made">
          <div className="tl-made-links">
            <div className="tl-line">
              <div className="tl-line-k">short link</div>
              <div className="tl-line-v">
                <code>{short}</code>
                <CopyButton text={short} label="short link" />
              </div>
              <div className="tl-line-n">
                The only form counted below. Inactive links redirect home rather than 404.
              </div>
            </div>

            <div className="tl-line">
              <div className="tl-line-k">full link</div>
              <div className="tl-line-v">
                <code>{full}</code>
                <CopyButton text={full} label="full link" />
              </div>
              <div className="tl-line-n">
                Attributes the visit the same way, but does not pass through /r, so it adds
                nothing to the click count.
              </div>
            </div>

            <dl className="tl-facts">
              <div>
                <dt>destination</dt>
                <dd>{link.destination}</dd>
              </div>
              <div>
                <dt>channel</dt>
                <dd>{link.channel}</dd>
              </div>
              <div>
                <dt>campaign</dt>
                <dd>{link.campaign ?? "—"}</dd>
              </div>
              <div>
                <dt>created</dt>
                <dd>{istLabel(link.createdAt)}</dd>
              </div>
            </dl>

            {link.notes ? <div className="tl-notes">{link.notes}</div> : null}
          </div>

          {qr ? (
            <figure className="tl-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR code for ${short}`} />
              <figcaption>
                <IconQrcode size={11} stroke={1.7} /> {link.slug}
              </figcaption>
            </figure>
          ) : null}
        </div>
      </Card>

      <div className="stat-grid even">
        <div className="stat">
          <div className="stat-k">
            <IconPointer size={11} /> clicks
          </div>
          <div className="stat-v">{link.clickCount}</div>
          <div className="stat-m">
            {link.lastClickAt ? `last ${istLabel(link.lastClickAt)}` : <em>never opened yet</em>}
          </div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconPointer size={11} /> last {WINDOW_DAYS} days
          </div>
          <div className="stat-v">{windowTotal}</div>
          <div className="stat-m">what the chart below adds up to</div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconUsers size={11} /> unique today
          </div>
          <div className="stat-v">{todayVisitors.length}</div>
          {/* 🚨 The salt is redrawn nightly, so the same person is a different hash
              tomorrow. There is no honest cross-day unique figure to show. */}
          <div className="stat-m">
            <i>today only</i> — not comparable with any other day
          </div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconMapPin size={11} /> countries
          </div>
          <div className="stat-v">{countries.length}</div>
          <div className="stat-m">coarse geo only, never a city trail</div>
        </div>
      </div>

      <Card flush className="rv-card">
        <CardHead
          title="Clicks"
          count={windowTotal}
          right={<span className="card-n">last {WINDOW_DAYS} days · IST</span>}
        />
        {windowTotal === 0 ? (
          <div className="utm-empty">No clicks in the last {WINDOW_DAYS} days.</div>
        ) : (
          <ClickTimeline days={days} />
        )}
      </Card>

      <div className="tl-split">
        <Card flush className="rv-card">
          <CardHead title="Countries" count={countries.length} />
          <div className="card-b">
            <Breakdown rows={countries} empty="Nothing to break down yet." />
          </div>
        </Card>

        <Card flush className="rv-card">
          <CardHead title="Devices" count={devices.length} />
          <div className="card-b">
            <Breakdown rows={devices} empty="Nothing to break down yet." />
          </div>
        </Card>
      </div>

      {recent.length > 0 ? (
        <Card flush className="rv-card">
          <CardHead title="Recent clicks" count={recent.length} />
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Country</th>
                  <th>Device</th>
                  <th>Came from</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((click) => (
                  <tr key={click.id}>
                    <td className="rv-mono rv-nowrap">{istLabel(click.createdAt)}</td>
                    <td className="rv-mono">
                      {click.country ? `${flagOf(click.country)} ${click.country}` : (
                        <span className="rv-none">unknown</span>
                      )}
                    </td>
                    <td className="rv-mono">{click.deviceType ?? "unknown"}</td>
                    <td className="rv-mono">
                      {click.referrerHost ?? <span className="rv-none">no referrer</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
