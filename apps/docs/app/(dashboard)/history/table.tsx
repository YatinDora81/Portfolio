"use client";

import { useMemo, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { badgeFor } from "@/lib/audit";
import { historyDetail } from "@/lib/actions/history";
import { IconHistory, IconWorldUpload, IconRefresh } from "@tabler/icons-react";

interface Event {
  id: string;
  action: string;
  surface: string;
  createdAt: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  publishState: string;
  publishedAt: string | null;
  publishError: string | null;
  changeCount: number;
  summary: string;
}

interface Change {
  seq: number; kind: string; entityLabel: string; rowLabel: string | null;
  field: string; before: string | null; after: string | null;
  redacted: boolean; truncated: boolean;
}

function ago(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

const full = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "";
  return (first + last).toUpperCase();
}

const role = (r: string) => r.toLowerCase().replace("_", " ");

function Diff({ c }: { c: Change }) {
  const val = (v: string | null, tone: "was" | "now") => (
    <div className={`hist-val ${tone}`}>
      {v === null || v === "" ? <em>empty</em> : v}
    </div>
  );
  return (
    <div className="hist-diff">
      <div className="hist-field">
        <b>{c.field}</b>
        {c.rowLabel && <span>{c.rowLabel}</span>}
        <span className="chip">{c.kind.toLowerCase()}</span>
        {c.truncated && <span className="chip amb">excerpt</span>}
      </div>
      {c.redacted ? (
        <div className="f-hint">Value hidden — this field holds a credential.</div>
      ) : (
        <>
          {c.kind !== "CREATE" && val(c.before, "was")}
          {c.kind !== "DELETE" && val(c.after, "now")}
        </>
      )}
    </div>
  );
}

export function HistoryTable({ events, lastPublish, capped }: {
  events: Event[];
  lastPublish: { actorName: string; actorRole: string; publishedAt: string } | null;
  capped: boolean;
}) {
  const [open, setOpen] = useState<Event | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [pending, start] = useTransition();

  // the query already sorts newest first
  const days = useMemo(() => {
    const out: { label: string; events: Event[] }[] = [];
    for (const e of events) {
      const label = dayLabel(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.events.push(e);
      else out.push({ label, events: [e] });
    }
    return out;
  }, [events]);

  const show = (e: Event) => {
    setOpen(e);
    setChanges(null);
    start(async () => {
      const res = await historyDetail(e.id);
      setChanges(res.ok ? res.changes ?? [] : []);
    });
  };

  return (
    <>
      <div className="hist-pub">
        <i><IconWorldUpload size={16} stroke={1.7} /></i>
        {lastPublish ? (
          <span>
            Last published by <b>{lastPublish.actorName}</b>{" "}
            <span className="sub">
              · {role(lastPublish.actorRole)} · {ago(lastPublish.publishedAt)}
            </span>
          </span>
        ) : (
          <span className="sub">Nothing published yet since the history started recording.</span>
        )}
      </div>

      {events.length === 0 ? (
        <Card flush>
          <div className="empty">
            <div className="empty-ic"><IconHistory size={18} stroke={1.5} /></div>
            <b>No history yet</b>
            <span>
              Recording starts from the moment this shipped — earlier edits were made before there
              was anywhere to write them down. Save something and it appears here.
            </span>
          </div>
        </Card>
      ) : (
        days.map((day) => (
          <div key={day.label}>
            <div className="hist-day">{day.label}</div>
            {day.events.map((e) => {
              const badge = badgeFor(e.action, e.publishState);
              return (
                <button key={e.id} type="button" className="hist-ev" onClick={() => show(e)}>
                  <div className="hist-time">{time(e.createdAt)}</div>
                  <div className="hist-rail">
                    <span className={`hist-dot ${badge.tone === "neutral" ? "" : badge.tone}`} />
                  </div>
                  <div className="hist-body">
                    <div className="hist-sum">{e.summary}</div>
                    <div className="hist-meta">
                      <span className="hist-av">{initials(e.actorName)}</span>
                      <span>{e.actorName}</span>
                      <span style={{ color: "var(--faint)" }}>· {role(e.actorRole)} · {ago(e.createdAt)}</span>
                    </div>
                  </div>
                  <span className={`hist-badge ${badge.tone === "neutral" ? "" : badge.tone}`}>
                    {badge.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}

      {capped && (
        <div className="f-hint" style={{ marginTop: 14 }}>
          Showing the newest {events.length}. Older entries are kept, but this page does not page
          back to them yet.
        </div>
      )}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? open.summary : ""}
        icon={IconHistory}
        footer={<Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>}
      >
        {open && (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="hist-meta" style={{ marginTop: 0 }}>
              <span className="hist-av">{initials(open.actorName)}</span>
              <span>
                <b style={{ color: "var(--ink)" }}>{open.actorName}</b> · {role(open.actorRole)} ·{" "}
                {full(open.createdAt)}
              </span>
            </div>
            {open.publishError && (
              <div className="f-hint" style={{ color: "var(--bad)" }}>
                Publish failed: {open.publishError}
              </div>
            )}

            {pending || changes === null ? (
              <div className="f-hint"><IconRefresh size={13} className="spin" /> Loading the diff…</div>
            ) : changes.length === 0 ? (
              <div className="f-hint">This entry records a publish; no content fields changed with it.</div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {changes.map((c) => <Diff key={c.seq} c={c} />)}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
