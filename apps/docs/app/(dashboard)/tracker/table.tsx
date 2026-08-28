"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { IconSearch, IconChartBar, IconRefresh, IconLoader2 } from "@tabler/icons-react";

interface TrackerRow {
  id: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  messageId: string | null;
  path: string | null;
  referrer: string | null;
  userAgent: string | null;
  visitedAt: string;
}

const AUTO_SYNC_INTERVAL_MS = 40_000;

const SEL_STYLE: React.CSSProperties = {
  width: "auto",
  minWidth: 132,
  padding: "5px 28px 5px 10px",
  fontSize: 12,
};

function short(v: string | null, n = 42) {
  if (!v) return "—";
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

function decodeUrlSafeBase64(value: string | null): string | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = atob(normalized + padding);
    return decoded || null;
  } catch {
    return null;
  }
}

export function TrackerTable({ rows }: { rows: TrackerRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const lastSyncedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<
    "date_newest" | "date_oldest" | "source_az" | "medium_az" | "campaign_az"
  >("date_newest");
  const [decodeContent, setDecodeContent] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [mediumFilter, setMediumFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");

  useEffect(() => {
    lastSyncedAtRef.current = Date.now();
  }, [rows]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const triggerSync = () => {
    startTransition(() => {
      router.refresh();
      lastSyncedAtRef.current = Date.now();
    });
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          triggerSync();
        }
        schedule();
      }, AUTO_SYNC_INTERVAL_MS);
    };

    schedule();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const elapsed = Date.now() - lastSyncedAtRef.current;
      if (elapsed >= AUTO_SYNC_INTERVAL_MS) triggerSync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const secondsUntilNext = Math.ceil(
    Math.max(0, AUTO_SYNC_INTERVAL_MS - (now - lastSyncedAtRef.current)) / 1000,
  );

  const sourceOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.source).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Sources" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const mediumOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.medium).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Mediums" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const campaignOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.campaign).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Campaigns" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byFilters = rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (mediumFilter !== "all" && r.medium !== mediumFilter) return false;
      if (campaignFilter !== "all" && r.campaign !== campaignFilter) return false;
      return true;
    });

    const searched = !s
      ? byFilters
      : byFilters.filter((r) =>
          [
            r.source,
            r.medium,
            r.campaign,
            r.content,
            decodeUrlSafeBase64(r.content),
            r.term,
            r.messageId,
            r.path,
            r.referrer,
            r.userAgent,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(s)),
        );

    const sorted = [...searched].sort((a, b) => {
      const at = new Date(a.visitedAt).getTime();
      const bt = new Date(b.visitedAt).getTime();
      if (sortBy === "date_newest") return bt - at;
      if (sortBy === "date_oldest") return at - bt;
      if (sortBy === "source_az") return (a.source || "").localeCompare(b.source || "");
      if (sortBy === "medium_az") return (a.medium || "").localeCompare(b.medium || "");
      return (a.campaign || "").localeCompare(b.campaign || "");
    });

    return sorted;
  }, [q, rows, sortBy, sourceFilter, mediumFilter, campaignFilter]);

  return (
    <Card flush>
      <CardHead
        title="UTM hits"
        count={filtered.length}
        right={
          <button
            type="button"
            className="btn"
            onClick={triggerSync}
            disabled={isPending}
            title="Refresh now — auto-refreshes every 40s"
          >
            {isPending ? (
              <IconLoader2 size={13} className="spin" />
            ) : (
              <IconRefresh size={13} stroke={1.6} />
            )}
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {isPending ? "syncing…" : `sync in ${secondsUntilNext}s`}
            </span>
          </button>
        }
      />

      <div className="filters">
        <div style={{ position: "relative", flex: "1 1 260px", minWidth: 200 }}>
          <IconSearch
            size={14}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--faint)",
              pointerEvents: "none",
            }}
          />
          <input
            className="in"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search source, medium, campaign, content, path, message id…"
            style={{ padding: "6px 12px 6px 32px", fontSize: 12.5 }}
          />
        </div>

        <select
          className="sel"
          aria-label="Sort hits"
          value={sortBy}
          onChange={(e) =>
            setSortBy(
              e.target.value as
                | "date_newest"
                | "date_oldest"
                | "source_az"
                | "medium_az"
                | "campaign_az",
            )
          }
          style={SEL_STYLE}
        >
          <option value="date_newest">Date: Newest</option>
          <option value="date_oldest">Date: Oldest</option>
          <option value="source_az">Source: A-Z</option>
          <option value="medium_az">Medium: A-Z</option>
          <option value="campaign_az">Campaign: A-Z</option>
        </select>

        <select
          className="sel"
          aria-label="Filter by source"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={SEL_STYLE}
        >
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          className="sel"
          aria-label="Filter by medium"
          value={mediumFilter}
          onChange={(e) => setMediumFilter(e.target.value)}
          style={SEL_STYLE}
        >
          {mediumOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          className="sel"
          aria-label="Filter by campaign"
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          style={SEL_STYLE}
        >
          {campaignOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <Switch checked={decodeContent} onChange={setDecodeContent} label="Decode content" />
      </div>

      <div className="tbl-scroll">
        <table className="tbl" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th>Visited</th>
              <th>Source</th>
              <th>Medium</th>
              <th>Campaign</th>
              <th>Content</th>
              <th>Term</th>
              <th>Message ID</th>
              <th>Path</th>
              <th>Referrer</th>
              <th>User agent</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--dim)" }}>
                  {new Date(r.visitedAt).toLocaleString()}
                </td>
                <td>{r.source ? <span className="chip">{r.source}</span> : "—"}</td>
                <td>{r.medium ? <span className="chip">{r.medium}</span> : "—"}</td>
                <td>{r.campaign || "—"}</td>
                <td
                  style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
                  title={decodeContent ? decodeUrlSafeBase64(r.content) || r.content || "" : r.content || ""}
                >
                  {decodeContent
                    ? short(decodeUrlSafeBase64(r.content) || r.content, 36)
                    : short(r.content, 36)}
                </td>
                <td>{r.term || "—"}</td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--dim)" }} title={r.messageId || ""}>
                  {short(r.messageId, 24)}
                </td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 11.5 }} title={r.path || ""}>
                  {short(r.path, 28)}
                </td>
                <td style={{ color: "var(--dim)" }} title={r.referrer || ""}>
                  {short(r.referrer, 36)}
                </td>
                <td style={{ color: "var(--faint)", fontSize: 12 }} title={r.userAgent || ""}>
                  {short(r.userAgent, 42)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 0 }}>
                  <div className="empty">
                    <div className="empty-ic"><IconChartBar size={18} stroke={1.5} /></div>
                    <b>No UTM hits</b>
                    <span>Nothing matches these filters yet — tagged links show up here within seconds of a visit.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "11px 16px", borderTop: "1px solid var(--line2)" }}>
        <div className="hint">
          <IconRefresh size={13} stroke={1.5} />
          Auto-refreshes every {AUTO_SYNC_INTERVAL_MS / 1000}s while this tab is visible · showing {filtered.length} of {rows.length} captured hits.
        </div>
      </div>
    </Card>
  );
}
