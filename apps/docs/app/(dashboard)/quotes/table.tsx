"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import {
  IconPlus, IconPencil, IconQuote, IconArrowBackUp, IconAlertTriangle, IconClock,
} from "@tabler/icons-react";

interface Quote { id: string; quote: string; author: string }

function DayDial({ day, days }: { day: number; days: number }) {
  const R = 21;
  const C = 2 * Math.PI * R;
  const done = Math.max(0, Math.min(1, day / days));
  return (
    <figure className="tod-cell tod-dial">
      <div style={{ position: "relative", width: 54, height: 54 }}>
        <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
          <circle cx="27" cy="27" r={R} fill="none" stroke="var(--bg3)" strokeWidth="3" />
          <circle
            cx="27" cy="27" r={R} fill="none"
            stroke="var(--c1)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${C * done} ${C}`}
            transform="rotate(-90 27 27)"
          />
        </svg>
        <span className="val">{day}</span>
      </div>
      <figcaption>day {day} / {days}<br />utc</figcaption>
    </figure>
  );
}

function Pick({ label, hint, quote, now }: {
  label: string;
  hint: string;
  quote: Quote | null;
  now?: boolean;
}) {
  return (
    <div className={cn("tod-cell", now && "now")}>
      <div className="tod-k">
        {now && <span className="dot" style={{ background: "var(--c1)" }} />}
        {label}
        <span style={{ letterSpacing: 0, textTransform: "none", opacity: .8 }}>· {hint}</span>
      </div>
      {quote && quote.quote.trim() ? (
        <>
          <div className="tod-q">&ldquo;{quote.quote}&rdquo;</div>
          <div className="tod-a">— {quote.author}</div>
        </>
      ) : (
        <div className="tod-q" style={{ color: "var(--faint)", fontWeight: 500 }}>
          {quote
            ? "Blank body — the site drops the whole section for this day."
            : "Nothing in rotation — the section does not render."}
        </div>
      )}
    </div>
  );
}

export function QuotesTable({ quotes, dayOfYear, nextDayOfYear, daysInYear, todayLabel, nextLabel }: {
  quotes: Quote[];
  dayOfYear: number;
  nextDayOfYear: number;
  daysInYear: number;
  todayLabel: string;
  nextLabel: string;
}) {
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete,
    isDeleted, isNew, isEdited,
  } = useStaging();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);

  const rows = overlay("quote", quotes, (q) => q.id);

  const live = rows.filter((q) => !isDeleted("quote", q.id));
  const todayQuote = live.length > 0 ? live[dayOfYear % live.length] ?? null : null;
  const nextQuote = live.length > 0 ? live[nextDayOfYear % live.length] ?? null : null;
  const todayId = todayQuote?.id ?? null;
  const nextId = nextQuote && nextQuote.id !== todayId ? nextQuote.id : null;

  const cycle = live.length;

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  const mark = (id: string) =>
    isDeleted("quote", id) ? "staged-del"
      : isNew("quote", id) ? "staged-new"
        : isEdited("quote", id) ? "staged-edit"
          : null;

  return (
    <>
      <Card flush className="wk-in">
        <CardHead
          title="The rule"
          right={
            <span className="hint">
              <IconClock size={13} /> rolls at 00:00 UTC · {cycle > 0 ? `${cycle}-day cycle` : "nothing in rotation"}
            </span>
          }
        />
        <div className="tod-ledger">
          <DayDial day={dayOfYear} days={daysInYear} />
          <Pick label="showing now" hint={todayLabel} quote={todayQuote} now />
          <Pick label="up next" hint={nextLabel} quote={nextQuote} />
        </div>
        <div className="card-b" style={{ borderTop: "1px solid var(--line2)", paddingTop: 12, paddingBottom: 12 }}>
          <span className="hint" style={{ lineHeight: 1.6, alignItems: "flex-start" }}>
            <IconQuote size={13} style={{ flex: "none", marginTop: 2 }} />
            <span>
              The site picks <code style={{ fontFamily: "var(--mono)" }}>day-of-year % {cycle || "count"}</code>{" "}
              over this list in id order — so adding or deleting a line reshuffles every
              future day, not just the next one.
            </span>
          </span>
        </div>
      </Card>

      {todayQuote && !todayQuote.quote.trim() && (
        <div className="ico-warn" style={{ marginTop: 14 }}>
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>Today&rsquo;s pick has an empty body</b>
            A blank quote makes the site skip section 07 entirely — visitors go straight from
            Blogs to Contact. Give it a body or delete it.
          </div>
        </div>
      )}

      <div className="wk-in s1" style={{ marginTop: 14 }}>
        <Card flush>
          <CardHead
            title="Rotation"
            count={rows.length}
            right={
              <Button size="sm" onClick={openNew}>
                <IconPlus size={14} /> Add quote
              </Button>
            }
          />

          {rows.length === 0 ? (
            <div className="empty">
              <div className="empty-ic"><IconQuote size={18} stroke={1.5} /></div>
              <b>Nothing in rotation</b>
              <span>Section 07 does not render at all — the page goes straight from Blogs to Contact.</span>
              <Button size="sm" onClick={openNew}><IconPlus size={14} /> Add the first line</Button>
            </div>
          ) : (
            <div>
              {rows.map((q, i) => {
                const gone = isDeleted("quote", q.id);
                return (
                  <div
                    key={q.id}
                    className={cn("qcard", q.id === todayId && "today", q.id === nextId && "tod-next", mark(q.id))}
                  >
                    <span className="row-i" style={{ marginTop: 4 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="qtext">&ldquo;{q.quote}&rdquo;</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 5, flexWrap: "wrap" }}>
                        <span className="qauth" style={{ marginTop: 0 }}>— {q.author}</span>
                        {q.id === todayId && (
                          <span className="chip amb"><span className="dot" /> showing today</span>
                        )}
                        {q.id === nextId && (
                          <span className="chip off"><span className="dot" /> up next, {nextLabel}</span>
                        )}
                      </div>
                    </div>
                    <div className="row-acts">
                      {gone ? (
                        <button
                          className="ibtn"
                          aria-label="Keep this quote"
                          title="Undo delete"
                          onClick={() => unstageDelete("quote", q.id)}
                        >
                          <IconArrowBackUp size={13} stroke={1.5} />
                        </button>
                      ) : (
                        <>
                          <button
                            className="ibtn"
                            aria-label={`Edit quote by ${q.author}`}
                            onClick={() => { setEditing(q); setDialogOpen(true); }}
                          >
                            <IconPencil size={13} stroke={1.5} />
                          </button>
                          <DeleteButton
                            staged
                            newRow={isNew("quote", q.id)}
                            label="this quote"
                            sub={q.id === todayId ? "This is the line the site is showing right now — deleting it changes today's quote as well as every future day." : undefined}
                            onDelete={() => stageDelete("quote", q.id)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title={editing ? "Edit quote" : "Add quote"}
            icon={IconQuote}
            footer={
              <>
                <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" form="quote-form">{editing ? "Update quote" : "Add quote"}</Button>
              </>
            }
          >
            <form
              id="quote-form"
              action={(formData) => {
                const fields = {
                  quote: String(formData.get("quote") ?? ""),
                  author: String(formData.get("author") ?? ""),
                };
                if (editing) stageUpdate("quote", editing.id, fields);
                else stageCreate("quote", fields);
                setDialogOpen(false);
              }}
            >
              <Textarea
                name="quote"
                label="Quote"
                defaultValue={editing?.quote || ""}
                required
                rows={4}
                hint="No quote marks needed — the site adds them. Past ~90 characters it switches to the longer reading rung."
              />
              <Input name="author" label="Author" defaultValue={editing?.author || ""} required />
            </form>
          </Dialog>
        </Card>
      </div>
    </>
  );
}
