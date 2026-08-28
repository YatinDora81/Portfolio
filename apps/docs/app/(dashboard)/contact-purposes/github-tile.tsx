import { Card, CardHead } from "@/components/ui/card";
import { IconBrandGithub, IconChartHistogram } from "@tabler/icons-react";
import { RefreshGithubButton } from "./refresh-github";
import type { GithubLedger } from "./github-ledger";

export function GithubTile({ ledger, hasGithubRow }: {
  ledger: GithubLedger | null;
  hasGithubRow: boolean;
}) {
  return (
    <Card flush>
      <CardHead
        title="Contribution tile"
        right={
          ledger ? (
            <span className={ledger.stale ? "chip amb" : "chip on"}>
              <span className="dot" aria-hidden="true" />
              {ledger.stale ? "due a refresh" : "fresh"}
            </span>
          ) : undefined
        }
      />

      {!hasGithubRow ? (
        <div className="empty">
          <div className="empty-ic"><IconBrandGithub size={18} stroke={1.5} /></div>
          <b>No GitHub link</b>
          <span>The site reads the handle from the GitHub row of the social list, so the dial shows no activity line at all.</span>
        </div>
      ) : !ledger ? (
        <>
          <div className="empty">
            <div className="empty-ic"><IconChartHistogram size={18} stroke={1.5} /></div>
            <b>Nothing captured yet</b>
            <span>The GitHub row on the site&rsquo;s dial shows the bare handle — no year, no streak, no fold.</span>
          </div>
          <div className="ctc-foot"><RefreshGithubButton /></div>
        </>
      ) : (
        <>
          <div className="ctc-figs">
            <Fig v={ledger.total.toLocaleString("en-US")} k="contributions · past year" />
            <Fig v={String(ledger.streak)} k="day streak" />
            <Fig v={String(ledger.best)} k="best run" />
            <Fig v={`@${ledger.handle}`} k="handle" mono />
          </div>

          <Weeks weeks={ledger.weeks} startDate={ledger.startDate} />

          <div className="ctc-foot">
            <RefreshGithubButton />
            <span className="ctc-asof">
              captured{" "}
              {ledger.fetchedAt.toLocaleString("en-GB", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
              })}{" "}
              UTC
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function Fig({ v, k, mono }: { v: string; k: string; mono?: boolean }) {
  return (
    <div className="ctc-fig">
      <b style={mono ? { fontFamily: "var(--mono)", fontSize: 15 } : undefined}>{v}</b>
      <span>{k}</span>
    </div>
  );
}

function Weeks({ weeks, startDate }: { weeks: (number | null)[]; startDate: string }) {
  const known = weeks.filter((w): w is number => w != null);
  const max = Math.max(1, ...known);
  const label = `${known.length} of ${weeks.length} weeks in the archive, from ${startDate}`;

  return (
    <figure className="ctc-weeks">
      <div className="ctc-bars" role="img" aria-label={label}>
        {weeks.map((w, i) => (
          <i
            key={i}
            className={w == null ? "gap" : undefined}
            style={w == null ? undefined : { height: `${Math.max(6, (w / max) * 100)}%` }}
            title={w == null ? "not in the archive" : `${w} in week ${i + 1}`}
          />
        ))}
      </div>
      <figcaption>
        <span>{startDate}</span>
        <span>53 weeks · from the archive, not from GitHub</span>
        <span>today</span>
      </figcaption>
    </figure>
  );
}
