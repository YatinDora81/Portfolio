"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { DeleteButton } from "@/components/shared/delete-button";
import { markMessageRead, markMessageUnread, deleteMessage } from "@/lib/actions/messages";
import {
  IconArrowLeft,
  IconCornerUpLeft,
  IconInboxOff,
  IconMail,
  IconMailOpened,
} from "@tabler/icons-react";

interface Message {
  id: string;
  name: string;
  email: string;
  purpose: string | null;
  message: string;
  read: boolean;
  createdAt: string;
}

function timeAgo(dateStr: string) {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Two letters for the `.mava` tile — first + last word of the sender's name. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Stable hue per sender so the same person always gets the same avatar colour.
 * `.mava` ships no background of its own — dark mode just desaturates whatever
 * we set here — so the pair is computed rather than pulled from a token.
 */
function avatarStyle(name: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { background: `hsl(${h} 64% 88%)`, color: `hsl(${h} 58% 27%)` };
}

function replyHref(msg: Message) {
  return `mailto:${msg.email}?subject=Re: ${msg.purpose ? `[${msg.purpose}] ` : ""}Contact from ${msg.name}`;
}

export function MessagesList({ messages }: { messages: Message[] }) {
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const unreadCount = messages.filter(m => !m.read).length;
  const readCount = messages.length - unreadCount;

  const filtered = messages.filter(m => {
    if (filter === "unread") return !m.read;
    if (filter === "read") return m.read;
    return true;
  });

  const selected = messages.find(m => m.id === selectedId) ?? null;

  const openMessage = async (msg: Message) => {
    setSelectedId(msg.id);
    if (!msg.read) await markMessageRead(msg.id);
  };

  const filters: { key: typeof filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: messages.length },
    { key: "unread", label: "Unread", n: unreadCount },
    { key: "read", label: "Read", n: readCount },
  ];

  return (
    <div className={cn("inbox", selected && "reading")}>
      {/* ---------- left: the list ---------- */}
      <Card flush className="msg-listcard">
        <div className="filters">
          {filters.map(f => (
            <button
              key={f.key}
              type="button"
              className={cn("filt", filter === f.key && "on")}
              onClick={() => setFilter(f.key)}
            >
              {f.label} {f.n}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-ic">
              <IconInboxOff size={18} stroke={1.5} />
            </div>
            <b>
              {filter === "unread"
                ? "No unread messages"
                : filter === "read"
                  ? "Nothing read yet"
                  : "No messages yet"}
            </b>
            <span>
              {filter === "all"
                ? "Anything sent through the site's contact form shows up here."
                : "Try the All filter to see the rest of the inbox."}
            </span>
          </div>
        ) : (
          <div className="msg-list">
            {filtered.map(msg => (
              <button
                key={msg.id}
                type="button"
                className={cn("msg-it", selectedId === msg.id && "sel")}
                onClick={() => openMessage(msg)}
              >
                <span className={msg.read ? "msg-read" : "msg-unread"} />
                <span className="mava" style={avatarStyle(msg.name)}>
                  {initials(msg.name)}
                </span>
                <span className="flex-1 min-w-0 block">
                  <span className="msg-who">
                    <span className="truncate">{msg.name}</span>
                    <span className="msg-when">{timeAgo(msg.createdAt)}</span>
                  </span>
                  <span className="msg-prev">{msg.message}</span>
                  {msg.purpose && <span className="msg-pill block">{msg.purpose}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ---------- right: the reading pane ---------- */}
      <Card flush className="msg-panecard">
        {selected ? (
          <>
            <div className="card-h">
              <button
                type="button"
                className="ibtn"
                onClick={() => setSelectedId(null)}
                aria-label="Back to the message list"
                title="Back to list"
              >
                <IconArrowLeft size={15} stroke={1.5} />
              </button>
              <span className="mava" style={avatarStyle(selected.name)}>
                {initials(selected.name)}
              </span>
              <div className="min-w-0">
                <div className="card-t truncate">{selected.name}</div>
                <div className="card-n truncate">
                  {selected.email} · {new Date(selected.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="sp" />
              {selected.purpose && <span className="chip">{selected.purpose}</span>}
              <a className="btn pri" href={replyHref(selected)}>
                <IconCornerUpLeft size={13} stroke={1.5} /> Reply
              </a>
              <button
                type="button"
                className="ibtn"
                title="Mark unread"
                aria-label="Mark unread"
                onClick={async () => {
                  await markMessageUnread(selected.id);
                  setSelectedId(null);
                }}
              >
                <IconMail size={15} stroke={1.5} />
              </button>
              <DeleteButton
                label={`message from "${selected.name}"`}
                sub="This deletes the message permanently. There's no undo here."
                onDelete={async () => {
                  await deleteMessage(selected.id);
                  setSelectedId(null);
                }}
              />
            </div>
            <div className="card-b">
              <div className="msg-body">{selected.message}</div>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-ic">
              <IconMailOpened size={18} stroke={1.5} />
            </div>
            <b>{messages.length === 0 ? "Inbox zero" : "Nothing open"}</b>
            <span>
              {messages.length === 0
                ? "No one has written in yet. New contact-form messages land here."
                : "Pick a message on the left to read it in full and reply."}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
