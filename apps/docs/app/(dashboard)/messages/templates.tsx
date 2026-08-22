"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transportError } from "@/lib/lifecycle";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteButton } from "@/components/shared/delete-button";
import { createReplyTemplate, deleteReplyTemplate } from "@/lib/actions/messages";
import { TEMPLATE_TOKENS } from "./text";
import { IconPlus, IconRefresh, IconTemplate, IconX } from "@tabler/icons-react";

export interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  useCount: number;
  createdAt: string;
}

export function TemplateSettings({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const create = () => {
    setBusy("create");
    setError(null);
    start(async () => {
      try {
        const res = await createReplyTemplate({ name, subject, body });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setName("");
        setSubject("");
        setBody("");
        setAdding(false);
        router.refresh();
      } catch (e) {
        setError(transportError(e));
      } finally {
        setBusy(null);
      }
    });
  };

  const remove = async (id: string) => {
    setBusy(`del:${id}`);
    setError(null);
    try {
      const res = await deleteReplyTemplate(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(transportError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card flush className="msg-tpl-card">
      <CardHead
        title="Reply templates"
        count={templates.length}
        right={
          <Button variant="outline" size="sm" onClick={() => setAdding((a) => !a)}>
            {adding ? <IconX size={13} stroke={1.6} /> : <IconPlus size={13} stroke={1.6} />}
            {adding ? "Cancel" : "New template"}
          </Button>
        }
      />

      <div className="msg-tpl-blurb">
        Canned replies for the composer above. {TEMPLATE_TOKENS.join(" and ")} are replaced with the
        sender’s own details when a template is picked, and escaped on the way into the email — they
        come from a public form, so they are treated as text and never as markup.
      </div>

      {error ? <div className="rv-err msg-err msg-tpl-err">{error}</div> : null}

      {adding ? (
        <div className="msg-tpl-form">
          <Input
            label="Name"
            value={name}
            maxLength={80}
            placeholder="Freelance — not taking work"
            disabled={busy === "create"}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Subject"
            value={subject}
            maxLength={200}
            placeholder="Re: your message — {{purpose}}"
            disabled={busy === "create"}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            label="Body"
            value={body}
            rows={6}
            maxLength={10_000}
            placeholder={"Hi {{name}},\n\nThanks for writing in…"}
            disabled={busy === "create"}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button
            disabled={busy === "create" || !name.trim() || !subject.trim() || !body.trim()}
            onClick={create}
          >
            {busy === "create" ? <IconRefresh size={13} className="spin" /> : <IconTemplate size={13} stroke={1.6} />}
            {busy === "create" ? "Saving…" : "Save template"}
          </Button>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconTemplate size={18} stroke={1.5} />
          </div>
          <b>No templates yet</b>
          <span>
            Save the reply you keep retyping and it turns into one pick in the composer.
          </span>
        </div>
      ) : (
        <div className="rows">
          {templates.map((t) => (
            <div key={t.id} className="row msg-tpl-row">
              <div className="row-main">
                <div className="row-t">{t.name}</div>
                <div className="row-m">{t.subject}</div>
                <div className="msg-tpl-body">{t.body}</div>
                <div className="msg-tpl-meta">
                  used {t.useCount} {t.useCount === 1 ? "time" : "times"} · added {t.createdAt}
                </div>
              </div>
              <div className="row-acts">
                <DeleteButton
                  label={`template “${t.name}”`}
                  sub="Replies already sent with it are untouched; only the template goes."
                  disabled={busy === `del:${t.id}`}
                  onDelete={() => remove(t.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
