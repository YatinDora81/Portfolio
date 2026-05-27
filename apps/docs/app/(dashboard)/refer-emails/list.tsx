"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
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
} from "@tabler/icons-react";
import type { SheetContact, SheetStats, ContactStatus } from "@/lib/sheet";
import { syncReferEmails } from "@/lib/actions/refer-emails";

const AUTO_SYNC_INTERVAL_MS = 40_000;

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

type FilterKey = "all" | "sent" | "pending" | "failed" | "opened";
type SortKey = "recent" | "name" | "opens" | "sno" | "status";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently updated" },
  { value: "opens", label: "Most opens" },
  { value: "name", label: "Name (A–Z)" },
  { value: "sno", label: "S.No" },
  { value: "status", label: "Status" },
];

function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="Sort contacts"
        className="h-10 w-full min-w-[11.75rem] appearance-none rounded-full border border-border bg-background py-0 pl-3.5 pr-9 text-xs font-semibold leading-none text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/15 hover:border-border/80 cursor-pointer"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={15}
        stroke={2}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

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

const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-purple-500 to-fuchsia-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
  "from-violet-500 to-purple-600",
  "from-lime-500 to-emerald-600",
  "from-orange-500 to-red-600",
  "from-indigo-500 to-blue-600",
];

function gradientFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx]!;
}

const STATUS_THEME: Record<
  ContactStatus,
  {
    accent: string;
    ring: string;
    dot: string;
    bg: string;
    hoverBg: string;
    text: string;
    label: string;
    icon: React.ElementType;
  }
> = {
  sent: {
    accent: "bg-gradient-to-b from-emerald-400 to-emerald-600",
    ring: "ring-emerald-500/40 dark:ring-emerald-400/40",
    dot: "bg-emerald-500",
    bg: "bg-emerald-500/[0.03] dark:bg-emerald-400/[0.04]",
    hoverBg: "hover:bg-emerald-500/[0.06] dark:hover:bg-emerald-400/[0.07]",
    text: "text-emerald-600 dark:text-emerald-400",
    label: "Sent",
    icon: IconCircleCheck,
  },
  pending: {
    accent: "bg-gradient-to-b from-amber-400 to-amber-600",
    ring: "ring-amber-500/40 dark:ring-amber-400/40",
    dot: "bg-amber-500",
    bg: "bg-amber-500/[0.025] dark:bg-amber-400/[0.03]",
    hoverBg: "hover:bg-amber-500/[0.05] dark:hover:bg-amber-400/[0.06]",
    text: "text-amber-600 dark:text-amber-400",
    label: "Pending",
    icon: IconClock,
  },
  failed: {
    accent: "bg-gradient-to-b from-rose-400 to-rose-600",
    ring: "ring-rose-500/40 dark:ring-rose-400/40",
    dot: "bg-rose-500",
    bg: "bg-rose-500/[0.03] dark:bg-rose-400/[0.04]",
    hoverBg: "hover:bg-rose-500/[0.06] dark:hover:bg-rose-400/[0.07]",
    text: "text-rose-600 dark:text-rose-400",
    label: "Failed",
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
      onClick={onCopy}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted hover:border-border cursor-pointer"
      title={copied ? "Copied!" : `Copy ${label || "value"}`}
    >
      {copied ? <IconCheck size={11} stroke={2.5} /> : <IconCopy size={11} stroke={2} />}
      {copied ? "Copied" : label || "Copy"}
    </button>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  hint?: string;
  accent: string;
  glowColor: string;
}

function StatCard({ icon: Icon, label, value, hint, accent, glowColor }: StatCardProps) {
  return (
    <div className="group relative">
      <div
        className={`absolute -inset-px rounded-xl bg-gradient-to-br ${accent} opacity-0 group-hover:opacity-30 blur transition-opacity duration-500`}
        aria-hidden
      />
      <Card className="relative p-4 overflow-hidden">
        <div
          className={`absolute -top-12 -right-12 size-32 rounded-full bg-gradient-to-br ${accent} opacity-[0.07] blur-2xl transition-all duration-500 group-hover:opacity-[0.13] group-hover:scale-110`}
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/80">
              {label}
            </p>
            <p className="text-[28px] font-bold leading-none tracking-tight mt-2 tabular-nums">
              {value}
            </p>
            {hint && (
              <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{hint}</p>
            )}
          </div>
          <div
            className={`shrink-0 rounded-xl p-2 bg-gradient-to-br ${accent} text-white shadow-lg`}
            style={{ boxShadow: `0 6px 20px -8px ${glowColor}` }}
          >
            <Icon size={16} stroke={2} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  count,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  label: React.ReactNode;
  tone: "default" | "success" | "warning" | "destructive" | "primary";
}) {
  const tones: Record<string, string> = {
    default:
      "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border",
    success:
      "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/40",
    warning:
      "border-amber-500/25 bg-amber-500/[0.04] text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/40",
    destructive:
      "border-rose-500/25 bg-rose-500/[0.04] text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40",
    primary:
      "border-blue-500/25 bg-blue-500/[0.04] text-blue-700 dark:text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/40",
  };
  const activeTones: Record<string, string> = {
    default: "bg-foreground text-background border-foreground shadow-sm",
    success: "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/30",
    warning: "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/30",
    destructive: "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/30",
    primary: "bg-blue-500 text-white border-blue-500 shadow-md shadow-blue-500/30",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold leading-none transition-all duration-200 cursor-pointer ${
        active ? activeTones[tone] : tones[tone]
      }`}
    >
      {label}
      <span
        className={`tabular-nums rounded-full px-1.5 text-[10px] font-bold ${
          active ? "bg-white/20" : "bg-foreground/10"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ContactRow({ c }: { c: SheetContact }) {
  const [expanded, setExpanded] = useState(false);
  const opened = c.openCount > 0;
  const gradient = gradientFor(c.email || c.name || "x");
  const theme = STATUS_THEME[c.status];
  const StatusIcon = theme.icon;

  return (
    <div className="group/row relative">
      <Card
        className={`p-0 overflow-hidden transition-all duration-200 ${
          expanded
            ? "border-primary/40 shadow-md shadow-primary/5"
            : "hover:border-border hover:shadow-md hover:shadow-black/[0.04]"
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className={`relative w-full text-left flex cursor-pointer transition-colors ${theme.hoverBg}`}
        >
          {/* Status accent bar */}
          <div className={`w-[3px] shrink-0 self-stretch ${theme.accent}`} aria-hidden />

          <div
            className={`flex min-h-[4.25rem] flex-1 items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-3.5 ${theme.bg}`}
          >
            {/* Avatar with status ring */}
            <div className="relative shrink-0">
              <div
                className={`size-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-[13px] shadow-md ring-2 ${theme.ring}`}
              >
                {initials(c.name, c.email)}
              </div>
              {opened && (
                <div
                  className="absolute -top-1 -right-1 size-5 rounded-full bg-gradient-to-br from-orange-400 to-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card shadow-sm"
                  title={`${c.openCount} open${c.openCount > 1 ? "s" : ""}`}
                >
                  {c.openCount > 9 ? "9+" : c.openCount}
                </div>
              )}
            </div>

            {/* Identity */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-[14px] tracking-tight truncate text-foreground">
                  {c.name || "—"}
                </p>
                <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                  <IconHash size={9} stroke={2} />
                  {c.sno || "—"}
                </span>
                {/* Mobile-only status chip (right column is hidden < md) */}
                <span
                  className={`md:hidden inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold border-current/30 ${theme.text}`}
                >
                  <StatusIcon size={9} stroke={2.4} />
                  {theme.label}
                </span>
                {opened && (
                  <span className="md:hidden inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <IconFlame size={9} stroke={2.4} />
                    {c.openCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[12px] text-muted-foreground flex-wrap">
                <span className="truncate font-medium text-foreground/70">
                  {c.email || "—"}
                </span>
                {(c.title || c.company) && (
                  <span className="opacity-30">·</span>
                )}
                {c.title && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <IconBriefcase size={11} stroke={1.8} className="opacity-60" />
                    <span className="truncate">{c.title}</span>
                  </span>
                )}
                {c.company && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <span className="opacity-30">·</span>
                    <IconBuilding size={11} stroke={1.8} className="opacity-60" />
                    <span className="truncate font-medium">{c.company}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Right: status + timeline */}
            <div className="hidden md:flex shrink-0 items-center gap-2">
              <span
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold leading-none ${theme.text} border-current/25 bg-card/80`}
              >
                <StatusIcon size={12} stroke={2.2} className="shrink-0" />
                {theme.label}
              </span>

              {(c.status === "sent" || opened) && (
                <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-2.5">
                  {c.status === "sent" && (
                    <span
                      className="inline-flex items-center gap-1 leading-none"
                      title={`Sent ${formatDate(c.sentAt)}`}
                    >
                      <IconSend size={11} className="shrink-0 text-emerald-500" stroke={2.2} />
                      <span className="text-[11px] font-medium tabular-nums">
                        {timeAgo(c.sentAt)}
                      </span>
                    </span>
                  )}
                  {c.status === "sent" && opened && (
                    <span className="text-muted-foreground/40 text-[10px] leading-none">·</span>
                  )}
                  {opened && (
                    <span
                      className="inline-flex items-center gap-1 leading-none"
                      title={`Last opened ${formatDate(c.lastOpenedAt)}`}
                    >
                      <IconEye size={11} className="shrink-0 text-blue-500" stroke={2.2} />
                      <span className="text-[11px] font-medium tabular-nums text-blue-600 dark:text-blue-400">
                        {timeAgo(c.lastOpenedAt)}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {c.error && !opened && (
                <span
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 text-[11px] font-semibold leading-none text-rose-600 dark:text-rose-400"
                  title={c.error}
                >
                  <IconAlertTriangle size={11} stroke={2.2} className="shrink-0" />
                  Error
                </span>
              )}
            </div>

            <span
              className={`ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 ${
                expanded
                  ? "rotate-180 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                  : "bg-muted/70 text-muted-foreground group-hover/row:bg-muted"
              }`}
              aria-hidden
            >
              <IconChevronDown size={16} stroke={2} />
            </span>
          </div>
        </button>

        {expanded && (
          <div className="border-t border-border bg-gradient-to-b from-muted/30 to-muted/10 px-4 py-4 space-y-4 animate-fade-in">
            {/* Generated Email Preview */}
            {(c.generatedSubject || c.generatedBody) ? (
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                <div className="border-b border-border bg-gradient-to-r from-muted/60 via-muted/40 to-muted/20 px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="rounded-md bg-primary/10 p-1 text-primary">
                      <IconSparkles size={12} stroke={2.2} />
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
                      AI-Generated Email
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.generatedSubject && (
                      <CopyChip text={c.generatedSubject} label="subject" />
                    )}
                    {c.generatedBody && (
                      <CopyChip text={c.generatedBody} label="body" />
                    )}
                  </div>
                </div>
                <div className="px-5 py-3.5 border-b border-border space-y-2 bg-muted/[0.15]">
                  <div className="flex items-baseline gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 w-14 shrink-0">
                      To
                    </span>
                    <span className="text-[13px] font-mono text-foreground/90">
                      {c.name ? `${c.name} <${c.email}>` : c.email}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 w-14 shrink-0">
                      Subject
                    </span>
                    <span className="text-[14px] font-semibold text-foreground">
                      {c.generatedSubject || (
                        <span className="text-muted-foreground italic font-normal">
                          — no subject —
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-muted/30">
                  <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2 px-1">
                    Inbox preview
                  </p>
                  {c.generatedBody ? (
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
                    <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center">
                      <p className="text-sm text-muted-foreground italic">
                        No body generated yet
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-8 text-center">
                <div className="inline-flex rounded-xl bg-muted/60 p-2.5">
                  <IconMail size={18} className="text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  No AI-generated email yet for this contact
                </p>
              </div>
            )}

            {/* Error */}
            {c.error && (
              <div className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/[0.06] to-rose-500/[0.02] px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <div className="rounded-lg bg-rose-500/15 p-1.5 text-rose-600 dark:text-rose-400 shrink-0">
                    <IconAlertTriangle size={14} stroke={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-rose-600 dark:text-rose-400">
                      Send Error
                    </p>
                    <p className="text-sm mt-1 break-words text-rose-700 dark:text-rose-300/90 font-mono">
                      {c.error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Meta icon={IconHash} label="S.No" value={c.sno || "—"} mono />
              <Meta
                icon={c.openCount > 0 ? IconMailOpened : IconMail}
                label="Open Count"
                value={c.openCount}
                accent={c.openCount > 0 ? "primary" : undefined}
              />
              <Meta icon={IconEye} label="Last Opened" value={timeAgo(c.lastOpenedAt)} />
              <Meta icon={IconSend} label="Sent At" value={formatDate(c.sentAt)} />
              <Meta icon={IconCalendar} label="Created" value={formatDate(c.createdAt)} />
              <Meta icon={IconClock} label="Updated" value={formatDate(c.updatedAt)} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {c.email && (
                <>
                  <a
                    href={`mailto:${c.email}${
                      c.generatedSubject
                        ? `?subject=${encodeURIComponent(c.generatedSubject)}${
                            c.generatedBody
                              ? `&body=${encodeURIComponent(c.generatedBody)}`
                              : ""
                          }`
                        : ""
                    }`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-blue-600 text-primary-foreground px-3.5 py-2 text-xs font-semibold hover:brightness-110 transition-all shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/35"
                  >
                    <IconSend size={12} /> Open in Mail
                    <IconArrowUpRight size={11} className="opacity-80" />
                  </a>
                  <CopyChip text={c.email} label="email" />
                </>
              )}
            </div>
          </div>
        )}
      </Card>
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
  accent?: "primary";
}) {
  return (
    <div
      className={`rounded-xl border border-border/60 bg-card px-3 py-2.5 min-w-0 transition-colors hover:border-border hover:bg-card ${
        accent === "primary" ? "ring-1 ring-primary/20 border-primary/30 bg-primary/[0.03]" : ""
      }`}
    >
      <div
        className={`flex items-center gap-1.5 ${
          accent === "primary" ? "text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon size={11} stroke={2} />
        <p className="text-[10px] uppercase tracking-[0.12em] font-semibold">{label}</p>
      </div>
      <p
        className={`mt-1 text-xs truncate ${
          mono ? "font-mono tabular-nums" : ""
        } ${accent === "primary" ? "text-primary font-bold" : "text-foreground/90 font-medium"}`}
        title={
          typeof value === "string" || typeof value === "number" ? String(value) : undefined
        }
      >
        {value}
      </p>
    </div>
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
  const { isPending, secondsUntilNext, triggerSync } = useAutoSync(fetchedAt);

  const openRate =
    stats.sent > 0 ? Math.round((stats.uniqueOpens / stats.sent) * 100) : 0;
  const sendRate =
    stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;
  const failRate =
    stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0;

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

  const counts = useMemo(
    () => ({
      all: contacts.length,
      sent: contacts.filter((c) => c.status === "sent").length,
      pending: contacts.filter((c) => c.status === "pending").length,
      failed: contacts.filter((c) => c.status === "failed").length,
      opened: contacts.filter((c) => c.openCount > 0).length,
    }),
    [contacts],
  );

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={IconUsers}
          label="Total"
          value={stats.total}
          hint="Contacts in sheet"
          accent="from-slate-500 to-slate-700"
          glowColor="rgba(100,116,139,0.4)"
        />
        <StatCard
          icon={IconCircleCheck}
          label="Sent"
          value={stats.sent}
          hint={`${sendRate}% of total`}
          accent="from-emerald-500 to-teal-600"
          glowColor="rgba(16,185,129,0.45)"
        />
        <StatCard
          icon={IconClock}
          label="Pending"
          value={stats.pending}
          hint="Awaiting send"
          accent="from-amber-500 to-orange-600"
          glowColor="rgba(245,158,11,0.45)"
        />
        <StatCard
          icon={IconAlertTriangle}
          label="Failed"
          value={stats.failed}
          hint={`${failRate}% failure rate`}
          accent="from-rose-500 to-red-600"
          glowColor="rgba(244,63,94,0.45)"
        />
        <StatCard
          icon={IconActivity}
          label="Total Opens"
          value={stats.totalOpens}
          hint={`${stats.uniqueOpens} unique`}
          accent="from-blue-500 to-indigo-600"
          glowColor="rgba(59,130,246,0.45)"
        />
        <StatCard
          icon={IconChartBar}
          label="Open Rate"
          value={`${openRate}%`}
          hint={`${stats.uniqueOpens}/${stats.sent} opened`}
          accent="from-violet-500 to-fuchsia-600"
          glowColor="rgba(139,92,246,0.45)"
        />
      </div>

      {/* Toolbar */}
      <Card className="p-4 space-y-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company, or email body…"
              className="h-10 w-full rounded-full border border-border bg-background py-0 pl-10 pr-10 text-sm leading-none outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/15 hover:border-border/80"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                title="Clear search"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:pl-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Sort
            </span>
            <SortSelect value={sort} onChange={setSort} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3.5">
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={counts.all}
            label="All"
            tone="default"
          />
          <FilterPill
            active={filter === "sent"}
            onClick={() => setFilter("sent")}
            count={counts.sent}
            label="Sent"
            tone="success"
          />
          <FilterPill
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
            count={counts.pending}
            label="Pending"
            tone="warning"
          />
          <FilterPill
            active={filter === "failed"}
            onClick={() => setFilter("failed")}
            count={counts.failed}
            label="Failed"
            tone="destructive"
          />
          <FilterPill
            active={filter === "opened"}
            onClick={() => setFilter("opened")}
            count={counts.opened}
            label={
              <span className="inline-flex items-center gap-1">
                <IconFlame size={11} stroke={2.5} /> Opened
              </span>
            }
            tone="primary"
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex h-8 items-center text-[11px] leading-none text-muted-foreground tabular-nums">
              <span className="font-bold text-foreground">{filtered.length}</span>
              <span className="mx-1 text-muted-foreground/50">/</span>
              {counts.all}
            </span>
            <button
              type="button"
              onClick={triggerSync}
              disabled={isPending}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold leading-none tabular-nums transition-all cursor-pointer disabled:cursor-wait ${
                isPending
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50"
              }`}
              title={
                isPending
                  ? "Syncing with Google Sheets…"
                  : `Auto-sync every ${AUTO_SYNC_INTERVAL_MS / 1000}s — click to sync now`
              }
            >
              {isPending ? (
                <IconLoader2 size={11} className="animate-spin" stroke={2.5} />
              ) : (
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
              )}
              {isPending ? "Syncing…" : `Sync in ${secondsUntilNext}s`}
            </button>
          </div>
        </div>
      </Card>

      {/* List */}
      <div className="space-y-2">
        {filtered.map((c) => (
          <ContactRow key={`${c.sno}-${c.email}`} c={c} />
        ))}
        {filtered.length === 0 && (
          <Card className="p-10 text-center">
            <div className="inline-flex rounded-2xl bg-muted/60 p-3">
              <IconSearch size={22} className="text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold mt-4">No contacts match your filters</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try clearing the search or selecting another status
            </p>
            {(search || filter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
              >
                <IconX size={12} /> Reset filters
              </button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
