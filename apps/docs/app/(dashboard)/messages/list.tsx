"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { markMessageRead, markMessageUnread, deleteMessage } from "@/lib/actions/messages";
import { IconMail, IconMailOpened, IconChevronDown } from "@tabler/icons-react";

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

function MessageCard({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);

  const handleExpand = async () => {
    setExpanded(!expanded);
    if (!expanded && !msg.read) {
      await markMessageRead(msg.id);
    }
  };

  return (
    <Card className={`p-0 overflow-hidden transition-all ${!msg.read ? "border-primary/30 bg-primary/[0.02]" : ""}`}>
      <button
        onClick={handleExpand}
        className="w-full text-left p-4 cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 shrink-0 ${!msg.read ? "text-primary" : "text-muted-foreground"}`}>
            {msg.read ? <IconMailOpened size={18} /> : <IconMail size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm ${!msg.read ? "font-semibold" : "font-medium"}`}>{msg.name}</span>
              {msg.purpose && <Badge variant="outline">{msg.purpose}</Badge>}
              {!msg.read && <Badge variant="default">New</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{msg.email}</p>
            {!expanded && (
              <p className="text-sm text-muted-foreground mt-1 truncate">{msg.message}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(msg.createdAt)}</span>
            <IconChevronDown size={14} className={`text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border">
          <div className="pt-3 pl-[30px]">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
            <div className="mt-4 flex items-center gap-2">
              <a
                href={`mailto:${msg.email}?subject=Re: ${msg.purpose ? `[${msg.purpose}] ` : ""}Contact from ${msg.name}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
              >
                Reply
              </a>
              {msg.read ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async (e) => { e.stopPropagation(); await markMessageUnread(msg.id); }}
                >
                  Mark unread
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async (e) => { e.stopPropagation(); await markMessageRead(msg.id); }}
                >
                  Mark read
                </Button>
              )}
              <DeleteButton
                label={`message from "${msg.name}"`}
                onDelete={async () => { await deleteMessage(msg.id); }}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export function MessagesList({ messages }: { messages: Message[] }) {
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  const filtered = messages.filter(m => {
    if (filter === "unread") return !m.read;
    if (filter === "read") return m.read;
    return true;
  });

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {(["all", "unread", "read"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filter === f
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {f === "all" ? `All (${messages.length})` : f === "unread" ? `Unread (${messages.filter(m => !m.read).length})` : `Read (${messages.filter(m => m.read).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(msg => (
          <MessageCard key={msg.id} msg={msg} />
        ))}
        {filtered.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            {filter === "unread" ? "No unread messages" : filter === "read" ? "No read messages" : "No messages yet"}
          </Card>
        )}
      </div>
    </div>
  );
}
