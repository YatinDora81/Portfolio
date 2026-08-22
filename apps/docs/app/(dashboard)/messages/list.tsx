"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageStatus } from "db";
import { cn } from "@/lib/utils";
import { transportError } from "@/lib/lifecycle";
import { bulkUpdateMessages, setMessageStarred, type BulkAction } from "@/lib/actions/messages";
import { TAB_LABEL, avatarStyle, initials, type TabKey } from "./shared";
import {
  IconAlertTriangle, IconArchive, IconInbox, IconInboxOff, IconMailOpened,
  IconShieldCheck, IconStar, IconStarFilled, IconX,
} from "@tabler/icons-react";

export interface MessageRow {
  id: string;
  name: string;
  email: string;
  purpose: string | null;
  snippet: string;
  /** Pre-formatted on the server — a clock read in the browser would not match SSR. */
  when: string;
  status: MessageStatus;
  starred: boolean;
  spamScore: number;
}

const EMPTY: Record<TabKey, { title: string; note: string }> = {
  inbox: {
    title: "Nothing waiting",
    note: "Anything sent through the site’s contact form shows up here.",
  },
  starred: {
    title: "Nothing starred",
    note: "Star a message and it stays one click away, whatever its status becomes.",
  },
  replied: {
    title: "No replies sent yet",
    note: "A message moves here once a reply has actually left the mail server.",
  },
  archived: {
    title: "Nothing archived",
    note: "Archiving keeps a message without keeping it in front of you.",
  },
  spam: {
    title: "No spam",
    note: "Flagged messages land here rather than being refused, so a false positive is one click from the inbox.",
  },
};

const BULK_FOR: Record<TabKey, BulkAction[]> = {
  inbox: ["read", "archive", "spam"],
  starred: ["read", "archive", "spam"],
  replied: ["archive", "spam"],
  archived: ["inbox", "spam"],
  spam: ["inbox", "archive"],
};

const BULK_ICON: Record<BulkAction, typeof IconArchive> = {
  read: IconMailOpened,
  archive: IconArchive,
  spam: IconAlertTriangle,
  inbox: IconInbox,
};

function bulkLabel(action: BulkAction, tab: TabKey): string {
  if (action === "read") return "Mark read";
  if (action === "archive") return "Archive";
  if (action === "spam") return "Mark spam";
  return tab === "spam" ? "Not spam" : "Move to inbox";
}

export function MessageList({ rows, tab, selectedId }: {
  rows: MessageRow[];
  tab: TabKey;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const isPicked = (id: string) => picked.includes(id);
  const starOf = (row: MessageRow) => stars[row.id] ?? row.starred;

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const allPicked = rows.length > 0 && picked.length === rows.length;

  const runBulk = (action: BulkAction) => {
    setBusy(action);
    setError(null);
    start(async () => {
      try {
        const res = await bulkUpdateMessages({ ids: picked, action });
        if (!res.ok) {
          setError(res.error ?? "Nothing was changed.");
          return;
        }
        setPicked([]);
        router.refresh();
      } catch (e) {
        setError(transportError(e));
      } finally {
        setBusy(null);
      }
    });
  };

  const toggleStar = (row: MessageRow) => {
    const next = !starOf(row);
    setStars((prev) => ({ ...prev, [row.id]: next }));
    setBusy(`star:${row.id}`);
    setError(null);
    start(async () => {
      try {
        const res = await setMessageStarred(row.id, next);
        if (!res.ok) {
          setStars((prev) => ({ ...prev, [row.id]: !next }));
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setStars((prev) => ({ ...prev, [row.id]: !next }));
        setError(transportError(e));
      } finally {
        setBusy(null);
      }
    });
  };

  const hrefFor = (id: string) => `/messages?tab=${tab}&id=${encodeURIComponent(id)}`;

  return (
    <>
      <div className="msg-bar">
        {rows.length > 0 ? (
          <label className="msg-all">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))}
              aria-label={`Select every message shown in ${TAB_LABEL[tab]}`}
            />
            {picked.length > 0 ? `${picked.length} selected` : `${rows.length} shown`}
          </label>
        ) : (
          <span className="msg-all">{TAB_LABEL[tab]}</span>
        )}

        {picked.length > 0 ? (
          <div className="msg-bulk">
            {BULK_FOR[tab].map((action) => {
              const Icon = action === "inbox" && tab === "spam" ? IconShieldCheck : BULK_ICON[action];
              return (
                <button
                  key={action}
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => runBulk(action)}
                >
                  <Icon size={13} stroke={1.6} /> {bulkLabel(action, tab)}
                </button>
              );
            })}
            <button
              type="button"
              className="ibtn"
              aria-label="Clear the selection"
              title="Clear selection"
              onClick={() => setPicked([])}
            >
              <IconX size={14} stroke={1.6} />
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="rv-err msg-err">{error}</div> : null}

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconInboxOff size={18} stroke={1.5} />
          </div>
          <b>{EMPTY[tab].title}</b>
          <span>{EMPTY[tab].note}</span>
        </div>
      ) : (
        <div className="msg-list">
          {rows.map((row) => (
            <div
              key={row.id}
              className={cn("msg-it", selectedId === row.id && "sel", isPicked(row.id) && "picked")}
            >
              <label className="msg-ck">
                <input
                  type="checkbox"
                  checked={isPicked(row.id)}
                  onChange={() => toggle(row.id)}
                  aria-label={`Select the message from ${row.name}`}
                />
              </label>

              <Link className="msg-open" href={hrefFor(row.id)}>
                <span className={row.status === "UNREAD" ? "msg-unread" : "msg-read"} />
                <span className="mava" style={avatarStyle(row.name)}>{initials(row.name)}</span>
                <span className="msg-main">
                  <span className="msg-who">
                    <span className="truncate">{row.name}</span>
                    <span className="msg-when">{row.when}</span>
                  </span>
                  <span className="msg-from">{row.email}</span>
                  <span className="msg-prev">{row.snippet}</span>
                  {row.purpose || row.spamScore > 0 ? (
                    <span className="msg-tags">
                      {row.purpose ? <span className="msg-pill">{row.purpose}</span> : null}
                      {row.spamScore > 0 ? (
                        <span className="chip amb msg-spam">
                          <IconAlertTriangle size={10} stroke={1.8} /> spam {row.spamScore}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </Link>

              <button
                type="button"
                className={cn("ibtn msg-star", starOf(row) && "amber")}
                disabled={busy === `star:${row.id}`}
                aria-pressed={starOf(row)}
                aria-label={starOf(row) ? `Unstar the message from ${row.name}` : `Star the message from ${row.name}`}
                title={starOf(row) ? "Starred" : "Star"}
                onClick={() => toggleStar(row)}
              >
                {starOf(row) ? <IconStarFilled size={14} /> : <IconStar size={14} stroke={1.6} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
