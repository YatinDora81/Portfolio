"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import {
  IconSearch,
  IconX,
  IconChevronDown,
  IconMail,
  IconMailOpened,
  IconClock,
  IconAlertTriangle,
  IconCircleCheck,
  IconCopy,
  IconCheck,
  IconEye,
  IconBuilding,
  IconBriefcase,
  IconHash,
  IconCalendar,
  IconUsers,
  IconSend,
  IconActivity,
  IconChartBar,
  IconFlame,
  IconSparkles,
  IconArrowUpRight,
  IconLoader2,
  IconWorld,
} from "@tabler/icons-react";
import type { SheetContact, SheetStats, ContactStatus } from "@/lib/sheet";
import { syncReferEmails } from "@/lib/actions/refer-emails";

const AUTO_SYNC_INTERVAL_MS = 40_000;

/** Compact `.sel` sizing for the filter strip — `.sel` is full width by default. */
const SEL_STYLE: React.CSSProperties = {
  width: "auto",
  minWidth: 128,
  padding: "5px 28px 5px 10px",
  fontSize: 12,
};

const MONO: React.CSSProperties = { fontFamily: "var(--mono)" };

function useAutoSync(fetchedAt: string) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const lastFetchRef = useRef(fetchedAt);
  const lastSyncedAtRef = useRef(Date.now());

  // When the server returns a new fetchedAt, reset our local "last synced" anchor.
  useEffect(() => {
    if (lastFetchRef.current !== fetchedAt) {
      lastFetchRef.current = fetchedAt;
      lastSyncedAtRef.current = Date.now();
    }
  }, [fetchedAt]);

  // Tick once a second so the countdown UI stays live.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const triggerSync = () => {
    startTransition(async () => {
      try {
        await syncReferEmails();
        router.refresh();
        lastSyncedAtRef.current = Date.now();
      } catch {
        // ignore network errors — next tick will retry
      }
    });
  };

  // Schedule auto-sync every 40s while the tab is visible.
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
      if (elapsed >= AUTO_SYNC_INTERVAL_MS) {
        triggerSync();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msUntilNext = Math.max(
    0,
    AUTO_SYNC_INTERVAL_MS - (now - lastSyncedAtRef.current),
  );
  const secondsUntilNext = Math.ceil(msUntilNext / 1000);

  return { isPending, secondsUntilNext, triggerSync };
}

type FilterKey = "all" | "sent" | "pending" | "failed" | "opened" | "portfolioVisited";
type SortKey = "recent" | "name" | "opens" | "sno" | "status";
type PageSize = 100 | 200 | 500 | 800;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently updated" },
  { value: "opens", label: "Most opens" },
  { value: "name", label: "Name (A–Z)" },
  { value: "sno", label: "S.No" },
  { value: "status", label: "Status" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isLikelyHtml(s: string): boolean {
  return /<\/?(p|br|div|span|a|strong|b|em|i|u|ul|ol|li|h[1-6]|table|tr|td|th|img|figure|blockquote|pre|code|hr|article|section|header|footer)(\s|>|\/)/i.test(
    s,
  );
}

const UNSAFE_STYLE_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "filter",
  "opacity",
  "visibility",
  "display",
  "-webkit-text-fill-color",
  "text-shadow",
  "mix-blend-mode",
]);

function sanitizeStyleAttr(css: string): string {
  return css
    .split(";")
    .map((d) => d.trim())
    .filter((d) => {
      if (!d) return false;
      const prop = d.split(":")[0]?.trim().toLowerCase();
      if (!prop) return false;
      return !UNSAFE_STYLE_PROPS.has(prop);
    })
    .join("; ");
}

function sanitizeHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<\/?(html|head|body|title)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sstyle\s*=\s*(["'])([^"']*)\1/gi, (_, q, css) => {
      const safe = sanitizeStyleAttr(String(css));
      return safe ? ` style=${q}${safe}${q}` : "";
    })
    .replace(/\scolor\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sbgcolor\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sbackground\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sclass\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<font\b([^>]*)>/gi, "<span$1>")
    .replace(/<\/font>/gi, "</span>")
    .replace(/\s(href|src|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, ' $1="#"')
    .replace(/\s(href|src|formaction)\s*=\s*javascript:[^\s>]*/gi, ' $1="#"');
}

function initials(name: string, email: string): string {
  const src = name?.trim() || email || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

/** `.chip` modifiers standing in for the old per-status colour themes. */
const STATUS_THEME: Record<
  ContactStatus,
  { chip: string; style?: React.CSSProperties; label: string; icon: React.ElementType }
> = {
  sent: { chip: "chip on", label: "sent", icon: IconCircleCheck },
  pending: { chip: "chip amb", label: "pending", icon: IconClock },
  failed: {
    chip: "chip",
    style: { borderColor: "var(--bad)", color: "var(--bad)", background: "var(--bad-soft)" },
    label: "failed",
    icon: IconAlertTriangle,
  },
};

function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="chip"
      style={copied ? { borderColor: "var(--good)", color: "var(--goodT)", background: "var(--good-soft)" } : undefined}
      title={copied ? "Copied!" : `Copy ${label || "value"}`}
    >
      {copied ? <IconCheck size={10} stroke={2.4} /> : <IconCopy size={10} stroke={1.8} />}
      {copied ? "copied" : label || "copy"}
    </button>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-k">
        <Icon size={11} stroke={1.8} />
        {label}
      </div>
      <div className="stat-v">{value}</div>
      {hint && <div className="stat-m">{hint}</div>}
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  mono,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line2)",
        borderRadius: 10,
        background: "var(--card)",
        padding: "8px 10px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          ...MONO,
          fontSize: 9,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: accent ? "var(--accT)" : "var(--faint)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon size={11} stroke={1.8} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 12,
          color: accent ? "var(--accT)" : "var(--dim)",
          fontWeight: accent ? 600 : 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          ...(mono ? MONO : null),
        }}
        title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function ContactRow({ c }: { c: SheetContact }) {
  const [expanded, setExpanded] = useState(false);
  const opened = c.openCount > 0;
  const visits = c.portfolioVisitCount ?? 0;
  const portfolioVisited = visits > 0;
  const theme = STATUS_THEME[c.status];
  const StatusIcon = theme.icon;
  const portfolioTooltip = portfolioVisited
    ? [
        `Portolio Open: ${visits} visit${visits > 1 ? "s" : ""}`,
        c.lastPortfolioVisitedAt ? `Last Visit: ${timeAgo(c.lastPortfolioVisitedAt)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <>
      <tr>
        <td style={{ ...MONO, fontSize: 10, color: "var(--faint)", width: 46 }}>
          {c.sno ? String(c.sno).padStart(3, "0") : "—"}
        </td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <div className="ava">{initials(c.name, c.email)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="row-t">{c.name || "—"}</div>
              <div className="row-m">
                <span style={MONO}>{c.email || "—"}</span>
                {c.title && (
                  <>
                    {" · "}
                    <IconBriefcase size={10} style={{ display: "inline", verticalAlign: -1 }} /> {c.title}
                  </>
                )}
                {c.company && (
                  <>
                    {" · "}
                    <IconBuilding size={10} style={{ display: "inline", verticalAlign: -1 }} /> {c.company}
                  </>
                )}
              </div>
            </div>
          </div>
        </td>
        <td style={{ width: 118 }}>
          <span className={theme.chip} style={theme.style}>
            <StatusIcon size={10} stroke={2} /> {theme.label}
          </span>
        </td>
        <td style={{ width: 190 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            {opened ? (
              <span className="chip amb" title={`${c.openCount} open${c.openCount > 1 ? "s" : ""}`}>
                <IconFlame size={10} stroke={2} /> {c.openCount}
              </span>
            ) : null}
            {portfolioVisited ? (
              <span
                className="chip"
                style={{ borderColor: "var(--c1)", color: "var(--accT)", background: "var(--accS)" }}
                title={portfolioTooltip}
              >
                <IconWorld size={10} stroke={2} /> {visits}
              </span>
            ) : null}
            {c.error && !opened ? (
              <span
                className="chip"
                style={{ borderColor: "var(--bad)", color: "var(--bad)", background: "var(--bad-soft)" }}
                title={c.error}
              >
                <IconAlertTriangle size={10} stroke={2} /> error
              </span>
            ) : null}
            {!opened && !portfolioVisited && !c.error ? (
              <span className="chip off">no activity</span>
            ) : null}
          </div>
        </td>
        <td style={{ width: 168, ...MONO, fontSize: 11, color: "var(--dim)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }} title={`Email sent ${timeAgo(c.sentAt)}`}>
            <IconSend size={10} stroke={1.8} style={{ flex: "none" }} />
            {timeAgo(c.sentAt)}
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, color: "var(--faint)" }}
            title={`Last opened ${timeAgo(c.lastOpenedAt)}`}
          >
            <IconEye size={10} stroke={1.8} style={{ flex: "none" }} />
            {timeAgo(c.lastOpenedAt)}
          </div>
        </td>
        <td style={{ width: 44, textAlign: "right" }}>
          <button
            type="button"
            className="ibtn"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse contact" : "Expand contact"}
            style={expanded ? { color: "var(--c1)", transform: "rotate(180deg)" } : undefined}
          >
            <IconChevronDown size={14} stroke={1.8} />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: "var(--bg1)" }}>
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Generated email preview */}
              {c.generatedSubject || c.generatedBody ? (
                <div className="card">
                  <div className="card-h">
                    <IconSparkles size={13} color="var(--c1)" />
                    <div className="card-t">AI-generated email</div>
                    <div className="sp" />
                    <div style={{ display: "flex", gap: 5 }}>
                      {c.generatedSubject && <CopyChip text={c.generatedSubject} label="subject" />}
                      {c.generatedBody && <CopyChip text={c.generatedBody} label="body" />}
                    </div>
                  </div>

                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line2)" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      <span style={{ ...MONO, fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", width: 52, flex: "none" }}>
                        To
                      </span>
                      <span style={{ ...MONO, fontSize: 12, color: "var(--dim)" }}>
                        {c.name ? `${c.name} <${c.email}>` : c.email}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginTop: 7 }}>
                      <span style={{ ...MONO, fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", width: 52, flex: "none" }}>
                        Subject
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {c.generatedSubject || (
                          <span style={{ color: "var(--faint)", fontStyle: "italic", fontWeight: 400 }}>
                            — no subject —
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="card-b">
                    <div style={{ ...MONO, fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>
                      Inbox preview
                    </div>
                    {c.generatedBody ? (
                      // Deliberately rendered on an email-client surface, not the app surface,
                      // so the body looks the way the recipient will see it.
                      <div className="rounded-xl border border-slate-200/80 bg-[#f6f7f9] p-1 shadow-inner shadow-slate-900/5 dark:border-slate-700/60 dark:bg-[#0a0f1a] dark:shadow-black/40">
                        <div className="rounded-[10px] bg-white px-6 py-5 shadow-sm ring-1 ring-slate-200/60 dark:bg-[#111827] dark:ring-slate-700/80 dark:shadow-lg dark:shadow-black/30">
                          {isLikelyHtml(c.generatedBody) ? (
                            <div
                              className="email-body-html text-[13.5px] leading-[1.7] text-slate-800 break-words
                                dark:text-slate-100
                                [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
                                [&_p]:my-2.5 [&_p]:text-slate-800 dark:[&_p]:text-slate-100
                                [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2
                                [&_strong]:font-semibold [&_strong]:text-slate-900 dark:[&_strong]:text-white
                                [&_b]:font-semibold [&_b]:text-slate-900 dark:[&_b]:text-white
                                [&_em]:italic [&_i]:italic
                                [&_u]:underline [&_u]:underline-offset-2
                                [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2
                                [&_li]:my-1 [&_li]:text-slate-800 dark:[&_li]:text-slate-100
                                [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-slate-900 dark:[&_h1]:text-white
                                [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-slate-900 dark:[&_h2]:text-white
                                [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-slate-900 dark:[&_h3]:text-white
                                [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-slate-900 dark:[&_h4]:text-white
                                [&_blockquote]:border-l-2 [&_blockquote]:border-blue-500/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 [&_blockquote]:my-3 dark:[&_blockquote]:text-slate-300 dark:[&_blockquote]:border-blue-400/50
                                [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-[12px] [&_code]:font-mono [&_code]:text-slate-800 dark:[&_code]:bg-slate-800 dark:[&_code]:text-slate-100
                                [&_pre]:bg-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:text-[12px] [&_pre]:font-mono [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre]:border [&_pre]:border-slate-200 dark:[&_pre]:bg-slate-900 dark:[&_pre]:border-slate-700 dark:[&_pre]:text-slate-100
                                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                                [&_hr]:my-4 [&_hr]:border-slate-200 dark:[&_hr]:border-slate-600
                                [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-3 [&_img]:border [&_img]:border-slate-200 dark:[&_img]:border-slate-600
                                [&_table]:border-collapse [&_table]:my-3 [&_table]:w-full
                                [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-50 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-900 dark:[&_th]:border-slate-600 dark:[&_th]:bg-slate-800 dark:[&_th]:text-white
                                [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_td]:text-slate-800 dark:[&_td]:border-slate-600 dark:[&_td]:text-slate-100
                                [&_span]:text-slate-800 dark:[&_span]:text-slate-100 [&_div]:text-slate-800 dark:[&_div]:text-slate-100"
                              dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(c.generatedBody),
                              }}
                            />
                          ) : (
                            <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-[1.7] text-slate-800 dark:text-slate-100">
                              {c.generatedBody}
                            </pre>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="empty" style={{ padding: "24px 20px" }}>
                        <div className="empty-ic"><IconMail size={16} stroke={1.5} /></div>
                        <span>No body generated yet</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card">
                  <div className="empty">
                    <div className="empty-ic"><IconMail size={18} stroke={1.5} /></div>
                    <b>No generated email</b>
                    <span>Nothing has been drafted for this contact yet.</span>
                  </div>
                </div>
              )}

              {/* Send error */}
              {c.error && (
                <div
                  style={{
                    border: "1px solid var(--bad)",
                    background: "var(--bad-soft)",
                    borderRadius: "var(--r3)",
                    padding: "11px 14px",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <IconAlertTriangle size={14} stroke={1.8} style={{ color: "var(--bad)", flex: "none", marginTop: 2 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...MONO, fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--bad)" }}>
                      Send error
                    </div>
                    <div style={{ ...MONO, fontSize: 12, marginTop: 5, color: "var(--bad)", wordBreak: "break-word" }}>
                      {c.error}
                    </div>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <Meta icon={IconHash} label="S.No" value={c.sno || "—"} mono />
                <Meta
                  icon={c.openCount > 0 ? IconMailOpened : IconMail}
                  label="Open count"
                  value={c.openCount}
                  accent={c.openCount > 0}
                />
                <Meta icon={IconEye} label="Last opened" value={timeAgo(c.lastOpenedAt)} />
                <Meta icon={IconSend} label="Sent at" value={formatDate(c.sentAt)} />
                <Meta icon={IconCalendar} label="Created" value={formatDate(c.createdAt)} />
                <Meta icon={IconClock} label="Updated" value={formatDate(c.updatedAt)} />
                <Meta icon={IconWorld} label="Portfolio visits" value={`${visits}`} accent={portfolioVisited} />
                <Meta icon={IconEye} label="Last portfolio visit" value={timeAgo(c.lastPortfolioVisitedAt ?? null)} />
              </div>

              {/* Actions */}
              {c.email && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <a
                    className="btn pri"
                    href={`mailto:${c.email}${
                      c.generatedSubject
                        ? `?subject=${encodeURIComponent(c.generatedSubject)}${
                            c.generatedBody
                              ? `&body=${encodeURIComponent(c.generatedBody)}`
                              : ""
                          }`
                        : ""
                    }`}
                  >
                    <IconSend size={13} stroke={1.7} /> Open in mail
                    <IconArrowUpRight size={12} className="nudge" />
                  </a>
                  <CopyChip text={c.email} label="email" />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ReferEmailsList({
  contacts,
  stats,
  fetchedAt,
}: {
  contacts: SheetContact[];
  stats: SheetStats;
  fetchedAt: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [page, setPage] = useState(1);
  const { isPending, secondsUntilNext, triggerSync } = useAutoSync(fetchedAt);

  const openRate =
    stats.sent > 0 ? Math.round((stats.uniqueOpens / stats.sent) * 100) : 0;
  const sendRate =
    stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;
  const failRate =
    stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0;
  const portfolioVisitors = contacts.filter((c) => (c.portfolioVisitCount ?? 0) > 0).length;
  const totalPortfolioVisits = contacts.reduce((sum, c) => sum + (c.portfolioVisitCount ?? 0), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = contacts;
    if (q) {
      arr = arr.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.generatedSubject || "").toLowerCase().includes(q) ||
          (c.generatedBody || "").toLowerCase().includes(q),
      );
    }
    if (filter === "opened") arr = arr.filter((c) => c.openCount > 0);
    else if (filter === "portfolioVisited") arr = arr.filter((c) => (c.portfolioVisitCount ?? 0) > 0);
    else if (filter !== "all") arr = arr.filter((c) => c.status === filter);

    const sorted = [...arr];
    sorted.sort((a, b) => {
      if (sort === "name") return (a.name || "").localeCompare(b.name || "");
      if (sort === "opens") return b.openCount - a.openCount;
      if (sort === "sno") return (a.sno || 0) - (b.sno || 0);
      if (sort === "status") {
        const order: Record<ContactStatus, number> = {
          failed: 0,
          pending: 1,
          sent: 2,
        };
        return order[a.status] - order[b.status];
      }
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bt - at;
    });
    return sorted;
  }, [contacts, search, filter, sort]);

  useEffect(() => {
    setPage(1);
  }, [search, filter, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const pageRows = filtered.slice(startIndex, endIndex);
  const rangeStart = filtered.length === 0 ? 0 : startIndex + 1;
  const rangeEnd = filtered.length === 0 ? 0 : endIndex;

  const counts = useMemo(
    () => ({
      all: contacts.length,
      sent: contacts.filter((c) => c.status === "sent").length,
      pending: contacts.filter((c) => c.status === "pending").length,
      failed: contacts.filter((c) => c.status === "failed").length,
      opened: contacts.filter((c) => c.openCount > 0).length,
      portfolioVisited: contacts.filter((c) => (c.portfolioVisitCount ?? 0) > 0).length,
    }),
    [contacts],
  );

  const FILTERS: { key: FilterKey; label: React.ReactNode; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "sent", label: "Sent", count: counts.sent },
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "failed", label: "Failed", count: counts.failed },
    {
      key: "opened",
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconFlame size={10} stroke={2.2} /> Opened
        </span>
      ),
      count: counts.opened,
    },
    {
      key: "portfolioVisited",
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconWorld size={10} stroke={2.2} /> Portfolio
        </span>
      ),
      count: counts.portfolioVisited,
    },
  ];

  const pager = (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={safePage <= 1}
      >
        Prev
      </button>
      <span style={{ ...MONO, fontSize: 10, color: "var(--faint)" }}>
        {safePage} / {totalPages}
      </span>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        disabled={safePage >= totalPages}
      >
        Next
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Stats */}
      <div className="stat-grid even">
        <Stat icon={IconUsers} label="Total" value={stats.total} hint="Contacts in sheet" />
        <Stat icon={IconCircleCheck} label="Sent" value={stats.sent} hint={`${sendRate}% of total`} />
        <Stat icon={IconClock} label="Pending" value={stats.pending} hint="Awaiting send" />
        <Stat icon={IconAlertTriangle} label="Failed" value={stats.failed} hint={`${failRate}% failure rate`} />
        <Stat icon={IconActivity} label="Total opens" value={stats.totalOpens} hint={`${stats.uniqueOpens} unique`} />
        <Stat icon={IconChartBar} label="Open rate" value={`${openRate}%`} hint={`${stats.uniqueOpens}/${stats.sent} opened`} />
        <Stat
          icon={IconWorld}
          label="Portfolio visits"
          value={totalPortfolioVisits}
          hint={`${portfolioVisitors} contacts visited`}
        />
      </div>

      <Card flush>
        <CardHead
          title="Contacts"
          count={filtered.length}
          right={
            <button
              type="button"
              className="btn"
              onClick={triggerSync}
              disabled={isPending}
              title={
                isPending
                  ? "Syncing with Google Sheets…"
                  : `Auto-sync every ${AUTO_SYNC_INTERVAL_MS / 1000}s — click to sync now`
              }
            >
              {isPending ? (
                <IconLoader2 size={13} className="spin" />
              ) : (
                <span className="dot" style={{ background: "var(--good)" }} />
              )}
              <span style={{ ...MONO, fontSize: 11 }}>
                {isPending ? "syncing…" : `sync in ${secondsUntilNext}s`}
              </span>
            </button>
          }
        />

        {/* Search + sort */}
        <div className="filters" style={{ alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 280px", minWidth: 200 }}>
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
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company, or email body…"
              className="in"
              style={{ padding: "6px 32px 6px 32px", fontSize: 12.5 }}
            />
            {search && (
              <button
                type="button"
                className="ibtn"
                onClick={() => setSearch("")}
                title="Clear search"
                aria-label="Clear search"
                style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}
              >
                <IconX size={12} />
              </button>
            )}
          </div>
          <select
            className="sel"
            aria-label="Sort contacts"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{ ...SEL_STYLE, minWidth: 158 }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            className="sel"
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
            style={{ ...SEL_STYLE, minWidth: 104 }}
          >
            <option value={100}>100 rows</option>
            <option value={200}>200 rows</option>
            <option value={500}>500 rows</option>
            <option value={800}>800 rows</option>
          </select>
        </div>

        {/* Status filters + top pager */}
        <div className="filters" style={{ alignItems: "center" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? "filt on" : "filt"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>{f.count}</span>
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...MONO, fontSize: 10, color: "var(--faint)" }}>
              {rangeStart}–{rangeEnd} of {filtered.length}
            </span>
            {pager}
          </div>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconSearch size={18} stroke={1.5} /></div>
            <b>No contacts match your filters</b>
            <span>Try clearing the search or selecting another status.</span>
            {(search || filter !== "all") && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                <IconX size={13} /> Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Engagement</th>
                  <th>Activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <ContactRow key={`${c.sno}-${c.email}`} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom pager */}
        {filtered.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 16px",
              borderTop: "1px solid var(--line2)",
              flexWrap: "wrap",
            }}
          >
            <div className="hint">
              <IconMailOpened size={13} stroke={1.5} />
              Rows expand to show the generated email, send errors and full tracking metadata.
            </div>
            <div style={{ marginLeft: "auto" }}>{pager}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
