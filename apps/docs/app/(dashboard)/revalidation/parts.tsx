"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  revalidateAllStale, revalidateBlog, revalidateNow, revalidateWholeSite,
} from "@/lib/actions/revalidation";
import {
  IconCircleCheck, IconRefresh, IconRefreshDot, IconWorldUpload, IconChecks, IconTimeline,
} from "@tabler/icons-react";

interface ActionResult {
  ok: boolean;
  durationMs: number;
  httpStatus?: number;
  error?: string;
}

type Outcome =
  | { ok: true; durationMs: number }
  | { ok: false; error: string };

function outcomeOf(res: ActionResult): Outcome {
  if (res.ok) return { ok: true, durationMs: res.durationMs };
  if (res.error) return { ok: false, error: res.error };
  return {
    ok: false,
    error: res.httpStatus != null
      ? `Failed with HTTP ${res.httpStatus} and no error body.`
      : "Failed, and the action returned no error text.",
  };
}

function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.ok) {
    return (
      <div className="rv-ok">
        <IconCircleCheck size={12} stroke={1.8} /> flushed in {outcome.durationMs} ms
      </div>
    );
  }
  return <div className="rv-err">{outcome.error}</div>;
}

// Must be caught at every call site: a throw inside a transition reaches no error boundary.
function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [, start] = useTransition();

  const run = (key: string, call: () => Promise<ActionResult>, onSuccess?: () => void) => {
    setBusy(key);
    start(async () => {
      try {
        const outcome = outcomeOf(await call());
        setResults((prev) => ({ ...prev, [key]: outcome }));
        if (outcome.ok) onSuccess?.();
      } catch (e) {
        setResults((prev) => ({ ...prev, [key]: { ok: false, error: transportError(e) } }));
      } finally {
        setBusy(null);
      }
    });
  };

  return { busy, results, run };
}

/* ------------------------------------------------------------------ 2. stale */

export interface StaleRow {
  id: string;
  type: string;
  slug: string;
  title: string;
  /** Pre-formatted IST, not a Date. */
  editedAt: string;
  revalidatedAt: string | null;
}

interface BulkResult {
  attempted: number;
  failed: number;
  /** Still stale after this run — the batch is capped. */
  remaining: number;
  error: string | null;
}

export function StaleContent({ items }: { items: StaleRow[] }) {
  const router = useRouter();
  const { busy, results, run } = useRunner();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [, start] = useTransition();

  const runAll = () => {
    setBulkBusy(true);
    start(async () => {
      try {
        const res = await revalidateAllStale();
        setBulk({
          attempted: res.attempted,
          failed: res.failed,
          remaining: res.remaining,
          error: res.error ?? null,
        });
        // Refresh on a partial run too; only a top-level error leaves the list accurate.
        if (res.error === undefined) router.refresh();
      } catch (e) {
        setBulk({ attempted: 0, failed: 0, remaining: 0, error: transportError(e) });
      } finally {
        setBulkBusy(false);
      }
    });
  };

  const anyBusy = bulkBusy || busy !== null;

  return (
    <Card flush className="rv-card">
      <CardHead
        title="Stale content"
        count={items.length}
        right={
          items.length > 0 ? (
            <Button size="sm" onClick={runAll} disabled={anyBusy}>
              {bulkBusy
                ? <><IconRefresh size={13} className="spin" /> Revalidating…</>
                : <><IconRefreshDot size={14} stroke={1.6} /> Revalidate all stale</>}
            </Button>
          ) : undefined
        }
      />

      {bulk ? (
        <div className="rv-strip">
          {bulk.error !== null ? (
            <div className="rv-err">{bulk.error}</div>
          ) : bulk.failed > 0 ? (
            <div className="rv-err">
              {bulk.failed} of {bulk.attempted} did not land. Each one wrote its own error to the
              log below.
            </div>
          ) : (
            <div className="rv-ok">
              <IconCircleCheck size={12} stroke={1.8} /> {bulk.attempted} item
              {bulk.attempted === 1 ? "" : "s"} flushed
            </div>
          )}
          {bulk.error === null && bulk.remaining > 0 ? (
            <div className="f-hint" style={{ marginTop: 7 }}>
              {bulk.remaining} still to go — run it again.
            </div>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconChecks size={19} stroke={1.5} /></div>
          <b>Everything is up to date</b>
          <span>
            Nothing has been edited since the last successful flush of the tag that carries it.
          </span>
        </div>
      ) : (
        <div className="rows">
          {items.map((it) => {
            const res = results[it.id];
            return (
              <div key={it.id} className="row">
                <div className="row-main">
                  <div className="row-t">{it.title}</div>
                  <div className="row-m">
                    {it.type} · <span className="rv-mono">/{it.slug}</span> · edited {it.editedAt} ·{" "}
                    {it.revalidatedAt ? `last revalidated ${it.revalidatedAt}` : "never revalidated"}
                  </div>
                  {res ? <div className="rv-rowout"><Result outcome={res} /></div> : null}
                </div>
                <div className="row-acts" style={{ gap: 8 }}>
                  <Badge variant="warning">stale</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={anyBusy}
                    onClick={() => run(it.id, () => revalidateBlog(it.id), () => router.refresh())}
                  >
                    {busy === it.id
                      ? <><IconRefresh size={13} className="spin" /> Revalidating…</>
                      : "Revalidate"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------- 3. manual controls */

export interface TagRow {
  tag: string;
  /** Pre-formatted IST, or null if never flushed. */
  lastSuccessAt: string | null;
  fails: number;
}

// Not a tag — kept distinct so its key cannot collide with one.
const SITE_KEY = "whole-site";

export function ManualControls({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const { busy, results, run } = useRunner();
  const siteResult = results[SITE_KEY];

  return (
    <Card flush className="rv-card">
      <CardHead title="Manual controls" count={tags.length + 1} />
      <div className="card-b">
        <div className="rv-grid">
          {tags.map((t) => {
            const res = results[t.tag];
            return (
              <div key={t.tag} className="rv-tile">
                <div className="rv-tile-k">{t.tag}</div>
                <div className="rv-tile-s">
                  {t.lastSuccessAt ? `last flushed ${t.lastSuccessAt}` : "never flushed"}
                  {t.fails > 0 ? ` · ${t.fails} failed in a row since` : ""}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run(t.tag, () => revalidateNow({ tags: [t.tag] }), () => router.refresh())}
                >
                  {busy === t.tag
                    ? <><IconRefresh size={13} className="spin" /> Flushing…</>
                    : <><IconRefreshDot size={13} stroke={1.6} /> Flush tag</>}
                </Button>
                {res ? <Result outcome={res} /> : null}
              </div>
            );
          })}

          <div className="rv-tile">
            <div className="rv-tile-k">whole site</div>
            <div className="rv-tile-s">
              Every route under the root layout at once — the homepage, /sitemap.xml and every
              /blog/&lt;slug&gt;. Coarser than a tag and slower, but it is the only thing that
              reaches a route no tag covers yet.
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => run(SITE_KEY, () => revalidateWholeSite(), () => router.refresh())}
            >
              {busy === SITE_KEY
                ? <><IconRefresh size={13} className="spin" /> Flushing…</>
                : <><IconWorldUpload size={13} stroke={1.6} /> Flush the site</>}
            </Button>
            {siteResult ? <Result outcome={siteResult} /> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- 4. recent log */

export interface LogRow {
  id: string;
  /** Pre-formatted IST, not a Date. */
  at: string;
  trigger: string;
  paths: string[];
  tags: string[];
  status: string;
  httpStatus: number | null;
  durationMs: number;
  actorId: string | null;
  error: string | null;
}

type StatusFilter = "ALL" | "SUCCESS" | "FAILED" | "TIMEOUT";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "all" },
  { key: "SUCCESS", label: "success" },
  { key: "FAILED", label: "failed" },
  { key: "TIMEOUT", label: "timeout" },
];

const STATUS_CHIP: Record<string, string> = {
  SUCCESS: "chip on",
  FAILED: "chip bad",
  TIMEOUT: "chip amb",
};

// null = no human actor; an id that resolves to nobody is an admin deleted since.
function actorLabel(id: string | null, actors: Record<string, string>): string {
  if (id === null) return "—";
  return actors[id] ?? id;
}

export function RecentLog({ rows, actors, capped }: {
  rows: LogRow[];
  actors: Record<string, string>;
  capped: boolean;
}) {
  const [filter, setFilter] = useState<StatusFilter>("ALL");

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { ALL: rows.length, SUCCESS: 0, FAILED: 0, TIMEOUT: 0 };
    for (const r of rows) {
      if (r.status === "SUCCESS" || r.status === "FAILED" || r.status === "TIMEOUT") out[r.status] += 1;
    }
    return out;
  }, [rows]);

  const shown = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  return (
    <>
      <Card flush className="rv-card">
        <CardHead title="Recent attempts" count={rows.length} />

        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filt ${filter === f.key ? "on" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} · {counts[f.key]}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconTimeline size={19} stroke={1.5} /></div>
            <b>{rows.length === 0 ? "No attempts recorded" : "Nothing matches that filter"}</b>
            <span>
              {rows.length === 0
                ? "Saving content, publishing, or any button above writes a row here."
                : "Every attempt in this window came back with a different status."}
            </span>
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl rv-log">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Time</th>
                  <th style={{ width: 120 }}>Trigger</th>
                  <th>Paths / tags</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 88, textAlign: "right" }}>Duration</th>
                  <th style={{ width: 130 }}>Actor</th>
                  <th style={{ width: 340 }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="rv-mono rv-nowrap">{r.at}</td>
                    <td className="rv-mono">{r.trigger.toLowerCase().replace(/_/g, " ")}</td>
                    <td>
                      {r.paths.length === 0 && r.tags.length === 0 ? (
                        <span className="rv-none">—</span>
                      ) : (
                        <div className="rv-targets">
                          {r.paths.map((p, i) => (
                            <span key={`p${i}-${p}`} className="chip off">{p}</span>
                          ))}
                          {r.tags.map((t, i) => (
                            <span key={`t${i}-${t}`} className="chip">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={STATUS_CHIP[r.status] ?? "chip"}>
                        {r.status.toLowerCase()}
                      </span>
                      {r.httpStatus != null ? (
                        <span className="rv-http">{r.httpStatus}</span>
                      ) : null}
                    </td>
                    <td className="rv-mono" style={{ textAlign: "right" }}>{r.durationMs} ms</td>
                    <td>{actorLabel(r.actorId, actors)}</td>
                    <td>
                      {r.error ? <div className="rv-err">{r.error}</div> : <span className="rv-none">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {capped ? (
        <div className="f-hint" style={{ marginTop: 14 }}>
          Showing the newest {rows.length}. Older attempts are kept, but this page does not page
          back to them yet.
        </div>
      ) : null}
    </>
  );
}
