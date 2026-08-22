import { prisma } from "db";
import type { MessageStatus, Prisma } from "db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SPAM_THRESHOLD } from "@repo/shared/spam";
import { IconMailOpened } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/session";
import { istLabel } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import { TAB_KEYS, TAB_LABEL, isTab, type TabKey } from "./shared";
import { applyVars, htmlToText } from "./text";
import { MessageList } from "./list";
import { MessageDetail } from "./detail";
import { TemplateSettings } from "./templates";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_PAGES = 12;
const SNIPPET_CHARS = 180;

const WHERE: Record<TabKey, Prisma.ContactMessageWhereInput> = {
  inbox: { status: { in: ["UNREAD", "READ"] } },
  starred: { starred: true },
  replied: { status: "REPLIED" },
  archived: { status: "ARCHIVED" },
  spam: { status: "SPAM" },
};

// A notification email links with only `?id=`, so the tab has to come from the
// message: defaulting to Inbox opens a replied or archived message beside a
// list that does not contain it.
const STATUS_TAB: Record<MessageStatus, TabKey> = {
  UNREAD: "inbox",
  READ: "inbox",
  REPLIED: "replied",
  ARCHIVED: "archived",
  SPAM: "spam",
};

function shortAgo(when: Date, now: number): string {
  const mins = Math.round((now - when.getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(days / 365)}y`;
}

function snippet(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
}

function defaultSubject(purpose: string | null): string {
  return purpose ? `Re: your message — ${purpose}` : "Re: your message";
}

function tabHref(tab: TabKey, id?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (id) params.set("id", id);
  return `/messages?${params.toString()}`;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; id?: string; n?: string }>;
}) {
  if (!(await getSession())) redirect("/login");

  const { tab: requestedTab, id: requestedId, n } = await searchParams;
  const pages = Math.min(Math.max(Number(n) || 1, 1), MAX_PAGES);
  const take = PAGE_SIZE * pages;

  const selectedPromise = requestedId
    ? prisma.contactMessage.findUnique({
        where: { id: requestedId },
        include: { replies: { orderBy: { sentAt: "desc" } } },
      })
    : Promise.resolve(null);

  const explicitTab = isTab(requestedTab) ? requestedTab : null;
  const deepLinked = explicitTab ? null : await selectedPromise;
  const tab: TabKey = explicitTab ?? (deepLinked ? STATUS_TAB[deepLinked.status] : "inbox");

  const [grouped, starredCount, rows, selected, templates] = await Promise.all([
    prisma.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.contactMessage.count({ where: { starred: true } }),
    // The take is the point: this page used to serialise the whole table.
    prisma.contactMessage.findMany({
      where: WHERE[tab],
      orderBy: { createdAt: "desc" },
      take: take + 1,
      select: {
        id: true, name: true, email: true, purpose: true, message: true,
        createdAt: true, status: true, starred: true, spamScore: true,
      },
    }),
    selectedPromise,
    prisma.replyTemplate.findMany({ orderBy: [{ useCount: "desc" }, { name: "asc" }] }),
  ]);

  const byStatus: Partial<Record<MessageStatus, number>> = {};
  for (const g of grouped) byStatus[g.status] = g._count._all;

  const counts: Record<TabKey, number> = {
    inbox: (byStatus.UNREAD ?? 0) + (byStatus.READ ?? 0),
    starred: starredCount,
    replied: byStatus.REPLIED ?? 0,
    archived: byStatus.ARCHIVED ?? 0,
    spam: byStatus.SPAM ?? 0,
  };

  const hasMore = rows.length > take;
  const now = Date.now();

  const list = rows.slice(0, take).map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    purpose: m.purpose,
    snippet: snippet(m.message),
    when: shortAgo(m.createdAt, now),
    status: m.status,
    starred: m.starred,
    spamScore: m.spamScore,
  }));

  const vars = { name: selected?.name ?? "", purpose: selected?.purpose ?? "" };

  // Substituted here rather than in the composer: the browser gets finished
  // text, and the server re-applies it on send for anything typed by hand.
  const composerTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: applyVars(t.subject, vars),
    body: applyVars(htmlToText(t.bodyHtml), vars),
  }));

  const unread = byStatus.UNREAD ?? 0;

  return (
    <div className="view">
      <PageHeader
        eyebrow="contact form → you"
        title="Inbox"
        description={
          unread > 0
            ? `${unread} unread. Everything people send through the site’s contact form lands here, and a reply goes back out from this page.`
            : "All caught up. Everything people send through the site’s contact form lands here, and a reply goes back out from this page."
        }
      />

      <div className="filters msg-tabs">
        {TAB_KEYS.map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            className={cn("filt", tab === key && "on", counts[key] === 0 && "msg-tab-0")}
            aria-current={tab === key ? "page" : undefined}
          >
            {TAB_LABEL[key]} <b>{counts[key]}</b>
          </Link>
        ))}
      </div>

      <div className={cn("inbox", selected && "reading")}>
        <Card flush className="msg-listcard">
          <MessageList rows={list} tab={tab} selectedId={selected?.id ?? null} />
          {hasMore ? (
            <Link className="msg-more" href={`${tabHref(tab, selected?.id)}&n=${pages + 1}`}>
              Load {PAGE_SIZE} older
            </Link>
          ) : null}
        </Card>

        <Card flush className="msg-panecard">
          {selected ? (
            <MessageDetail
              key={selected.id}
              tab={tab}
              message={{
                id: selected.id,
                name: selected.name,
                email: selected.email,
                purpose: selected.purpose,
                body: selected.message,
                status: selected.status,
                starred: selected.starred,
                spamScore: selected.spamScore,
                spamReasons: selected.spamReasons,
                country: selected.country,
                deviceType: selected.deviceType,
                browser: selected.browser,
                referrer: selected.referrer,
                receivedAt: istLabel(selected.createdAt),
                readAt: selected.readAt ? istLabel(selected.readAt) : null,
                repliedAt: selected.repliedAt ? istLabel(selected.repliedAt) : null,
                threaded: selected.notificationMessageId !== null,
              }}
              defaultSubject={defaultSubject(selected.purpose)}
              templates={composerTemplates}
              spamThreshold={SPAM_THRESHOLD}
              replies={selected.replies.map((r) => ({
                id: r.id,
                subject: r.subject,
                bodyText: r.bodyText,
                sentAt: istLabel(r.sentAt),
                deliveryOk: r.deliveryOk,
                deliveryError: r.deliveryError,
              }))}
            />
          ) : (
            <div className="empty">
              <div className="empty-ic">
                <IconMailOpened size={18} stroke={1.5} />
              </div>
              <b>{counts.inbox === 0 ? "Inbox zero" : "Nothing open"}</b>
              <span>
                {list.length === 0
                  ? "New contact-form messages land here the moment someone writes in."
                  : "Pick a message on the left to read it in full, see how it scored, and reply."}
              </span>
            </div>
          )}
        </Card>
      </div>

      <TemplateSettings
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          body: htmlToText(t.bodyHtml),
          useCount: t.useCount,
          createdAt: istLabel(t.createdAt),
        }))}
      />
    </div>
  );
}
