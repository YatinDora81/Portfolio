"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageStatus } from "db";
import { cn } from "@/lib/utils";
import { transportError } from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  deleteMessage, markMessageRead, markMessageUnread, sendMessageReply, setMessageStarred,
} from "@/lib/actions/messages";
import { avatarStyle, initials, spamReasonLabel, type TabKey } from "./shared";
import { TEMPLATE_TOKENS } from "./text";
import {
  IconAlertTriangle, IconArrowLeft, IconBrowser, IconCircleCheck, IconClockHour4,
  IconDeviceMobile, IconLink, IconMail, IconMailForward, IconRefresh, IconSend,
  IconStar, IconStarFilled, IconWorld,
} from "@tabler/icons-react";

export interface DetailMessage {
  id: string;
  name: string;
  email: string;
  purpose: string | null;
  body: string;
  status: MessageStatus;
  starred: boolean;
  spamScore: number;
  spamReasons: string[];
  country: string | null;
  deviceType: string | null;
  browser: string | null;
  referrer: string | null;
  receivedAt: string;
  readAt: string | null;
  repliedAt: string | null;
  threaded: boolean;
}

export interface ReplyRow {
  id: string;
  subject: string;
  bodyText: string;
  sentAt: string;
  deliveryOk: boolean;
  deliveryError: string | null;
}

export interface ComposerTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

const STATUS_TEXT: Record<MessageStatus, string> = {
  UNREAD: "unread",
  READ: "read",
  REPLIED: "replied",
  ARCHIVED: "archived",
  SPAM: "spam",
};

function Meta({ icon: Icon, label, value }: {
  icon: typeof IconWorld;
  label: string;
  value: string;
}) {
  return (
    <div className="msg-meta-it">
      <span className="msg-meta-k">
        <Icon size={11} stroke={1.7} /> {label}
      </span>
      <span className="msg-meta-v">{value}</span>
    </div>
  );
}

export function MessageDetail({ message, replies, templates, defaultSubject, spamThreshold, tab }: {
  message: DetailMessage;
  replies: ReplyRow[];
  templates: ComposerTemplate[];
  defaultSubject: string;
  spamThreshold: number;
  tab: TabKey;
}) {
  const router = useRouter();
  const [starred, setStarred] = useState(message.starred);
  const [marking, setMarking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [, start] = useTransition();

  const opened = useRef(false);

  useEffect(() => {
    if (message.status !== "UNREAD" || opened.current) return;
    opened.current = true;
    setMarking(true);
    void (async () => {
      try {
        await markMessageRead(message.id);
        router.refresh();
      } catch {
        opened.current = false;
      } finally {
        setMarking(false);
      }
    })();
  }, [message.id, message.status, router]);

  const backHref = `/messages?tab=${tab}`;

  const run = (key: string, call: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(key);
    setError(null);
    start(async () => {
      try {
        const res = await call();
        if (!res.ok) {
          setError(res.error ?? "That did not go through.");
          return;
        }
        if (after) after();
        else router.refresh();
      } catch (e) {
        setError(transportError(e));
      } finally {
        setBusy(null);
      }
    });
  };

  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    run("star", () => setMessageStarred(message.id, next));
  };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const chosen = templates.find((t) => t.id === id);
    if (!chosen) return;
    setSubject(chosen.subject);
    setBody(chosen.body);
  };

  const send = () => {
    setBusy("send");
    setSent(false);
    setSendError(null);
    start(async () => {
      try {
        const res = await sendMessageReply({
          messageId: message.id,
          subject,
          body,
          ...(templateId ? { templateId } : {}),
        });
        if (!res.ok) {
          setSendError(res.error);
          router.refresh();
          return;
        }
        setSent(true);
        setBody("");
        setTemplateId("");
        router.refresh();
      } catch (e) {
        setSendError(transportError(e));
      } finally {
        setBusy(null);
      }
    });
  };

  const flagged = message.spamScore > 0;
  const overThreshold = message.spamScore >= spamThreshold;

  return (
    <>
      <div className="card-h msg-head">
        <Link className="ibtn" href={backHref} aria-label="Back to the message list" title="Back to list">
          <IconArrowLeft size={15} stroke={1.5} />
        </Link>
        <span className="mava" style={avatarStyle(message.name)}>{initials(message.name)}</span>
        <div className="min-w-0">
          <div className="card-t truncate">{message.name}</div>
          <div className="card-n truncate">
            {message.email} · {message.receivedAt} · {STATUS_TEXT[message.status]}
          </div>
        </div>
        <div className="sp" />
        {message.purpose ? <span className="chip">{message.purpose}</span> : null}
        <button
          type="button"
          className={cn("ibtn", starred && "amber")}
          disabled={busy === "star"}
          aria-pressed={starred}
          aria-label={starred ? "Unstar this message" : "Star this message"}
          title={starred ? "Starred" : "Star"}
          onClick={toggleStar}
        >
          {starred ? <IconStarFilled size={15} /> : <IconStar size={15} stroke={1.5} />}
        </button>
        <button
          type="button"
          className="ibtn"
          title="Mark unread"
          aria-label="Mark unread"
          disabled={marking || busy === "unread"}
          onClick={() => run("unread", () => markMessageUnread(message.id), () => router.push(backHref))}
        >
          <IconMail size={15} stroke={1.5} />
        </button>
        <DeleteButton
          label={`message from “${message.name}”`}
          sub="This deletes the message and every reply sent against it. There is no undo here."
          disabled={busy === "delete"}
          onDelete={async () => {
            setBusy("delete");
            setError(null);
            try {
              const res = await deleteMessage(message.id);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              router.push(backHref);
            } catch (e) {
              setError(transportError(e));
            } finally {
              setBusy(null);
            }
          }}
        />
      </div>

      <div className="card-b msg-pane">
        {error ? <div className="rv-err msg-err">{error}</div> : null}

        {flagged ? (
          <div className={cn("msg-spam-panel", overThreshold && "bad")}>
            <b>
              <IconAlertTriangle size={13} stroke={1.7} /> Spam score {message.spamScore}
              <span className="msg-spam-th">
                {overThreshold
                  ? `over the ${spamThreshold}-point line, so it was filed as spam rather than refused`
                  : `under the ${spamThreshold}-point line that files a message as spam`}
              </span>
            </b>
            {message.spamReasons.length > 0 ? (
              <ul className="msg-reasons">
                {message.spamReasons.map((reason) => (
                  <li key={reason}>{spamReasonLabel(reason)}</li>
                ))}
              </ul>
            ) : (
              <p className="msg-reasons-none">Scored above zero, but no rule recorded a reason.</p>
            )}
          </div>
        ) : null}

        <div className="msg-meta">
          <Meta icon={IconWorld} label="country" value={message.country ?? "unknown"} />
          <Meta icon={IconDeviceMobile} label="device" value={message.deviceType ?? "unknown"} />
          <Meta icon={IconBrowser} label="browser" value={message.browser ?? "unknown"} />
          <Meta icon={IconLink} label="referrer" value={message.referrer ?? "direct or unknown"} />
          <Meta
            icon={IconClockHour4}
            label="opened"
            value={message.readAt ?? "not opened before now"}
          />
          <Meta
            icon={IconMailForward}
            label="replied"
            value={message.repliedAt ?? "not replied to"}
          />
        </div>

        <div className="msg-body">{message.body}</div>

        <div className="msg-composer">
          <div className="msg-composer-h">
            <IconSend size={13} stroke={1.6} /> Reply to {message.name}
            <span className="sp" />
            <span className="msg-thread">
              {message.threaded
                ? "threads onto the notification in Gmail"
                : "no notification to thread onto — this starts a new thread"}
            </span>
          </div>

          {templates.length > 0 ? (
            <Select
              label="Template"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              disabled={busy === "send"}
              hint={`Picking one replaces the subject and body. ${TEMPLATE_TOKENS.join(" and ")} are already filled in.`}
              options={[
                { value: "", label: "— write from scratch —" },
                ...templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          ) : null}

          <Input
            label="Subject"
            value={subject}
            maxLength={200}
            disabled={busy === "send"}
            onChange={(e) => setSubject(e.target.value)}
          />

          <Textarea
            label="Reply"
            value={body}
            rows={7}
            maxLength={10_000}
            disabled={busy === "send"}
            placeholder="Thanks for writing in — happy to talk about this."
            hint={`Plain text. The email layout adds “Hi ${message.name.split(/\s+/)[0] ?? "there"},” above and a sign-off below, so start with the substance. Their answer arrives in Gmail, not here.`}
            onChange={(e) => setBody(e.target.value)}
          />

          <div className="msg-send">
            <Button disabled={busy === "send" || subject.trim() === "" || body.trim() === ""} onClick={send}>
              {busy === "send" ? <IconRefresh size={13} className="spin" /> : <IconSend size={13} stroke={1.6} />}
              {busy === "send" ? "Sending…" : "Send reply"}
            </Button>
            {sent ? (
              <span className="rv-ok">
                <IconCircleCheck size={12} stroke={1.8} /> sent · this message is now marked replied
              </span>
            ) : null}
          </div>

          {sendError ? (
            <div className="rv-err msg-err">
              <b>The reply did not go out.</b> {sendError} It is recorded below as a failed send, and
              the message has deliberately not been marked replied.
            </div>
          ) : null}
        </div>

        {replies.length > 0 ? (
          <div className="msg-history">
            <div className="msg-history-h">
              {replies.length} {replies.length === 1 ? "reply" : "replies"} sent from here
            </div>
            {replies.map((reply) => (
              <div key={reply.id} className={cn("msg-reply", !reply.deliveryOk && "failed")}>
                <div className="msg-reply-h">
                  <b className="truncate">{reply.subject}</b>
                  <span className="sp" />
                  <span className={reply.deliveryOk ? "chip on" : "chip amb"}>
                    <span className="dot" /> {reply.deliveryOk ? "delivered" : "failed"}
                  </span>
                  <span className="msg-reply-at">{reply.sentAt}</span>
                </div>
                {reply.deliveryError ? (
                  <div className="rv-err msg-err">{reply.deliveryError}</div>
                ) : null}
                <div className="msg-reply-b">{reply.bodyText}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
