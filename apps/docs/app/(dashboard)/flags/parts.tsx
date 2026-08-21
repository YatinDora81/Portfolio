"use client";

import { useState, useTransition } from "react";
import type { FlagDefinition } from "@repo/shared/flags";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setFlag } from "@/lib/actions/flags";
import {
  IconAlertTriangle, IconCircleCheck, IconRefresh, IconDeviceFloppy,
} from "@tabler/icons-react";

export interface FlagRow {
  key: string;
  label: string;
  description: string;
  group: FlagDefinition["group"];
  enabled: boolean;
  defaultEnabled: boolean;
  note: string | null;
  /** False when the registry declares this flag but no database row holds it. */
  present: boolean;
  /** Pre-formatted IST — see the note in page.tsx on why this is not a Date. */
  changedAt: string | null;
  changedBy: string | null;
}

/**
 * What a row knows about its last save.
 *
 * `stale` is the arm that justifies the shape: the write landed and the flush
 * did not, so the switch on screen is telling the truth about the database and
 * a lie about what visitors are seeing. Folding it into either "saved" or
 * "failed" loses the only fact worth reporting, and it carries the server's own
 * words rather than a friendlier sentence for the same reason the revalidation
 * page does — a paraphrased error is a dead end.
 */
type Outcome =
  | { kind: "saved" }
  | { kind: "stale"; error: string }
  | { kind: "failed"; error: string };

/**
 * `setFlag` reports its own failures as `{ ok: false }`, so a *rejection* is the
 * transport underneath one: the network gone, or — the case this page will
 * actually meet — an expired session redirecting the action POST to /login.
 *
 * Caught at every call site, because a throw inside a client transition reaches
 * no error boundary: `busy` would never clear and the row's switch would sit
 * disabled with no message, mid-flip, showing a position nothing ever saved.
 * The same bug was found and fixed on the revalidation page last phase.
 */
function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "saved") {
    return (
      <div className="rv-ok fl-out">
        <IconCircleCheck size={12} stroke={1.8} /> saved · live from the next visit onward
      </div>
    );
  }
  if (outcome.kind === "stale") {
    return (
      <div className="fl-warn fl-out">
        <b><IconAlertTriangle size={13} stroke={1.7} /> Saved, but the site was not flushed</b>
        The switch below is what the database says. Visitors keep seeing the old version until the
        cache clears on its own — flush <code>flags</code> by hand from Revalidation.
        <span>{outcome.error}</span>
      </div>
    );
  }
  return <div className="rv-err fl-out">{outcome.error}</div>;
}

/** The line under the description: who moved this switch, and when. */
function lastChanged(row: FlagRow, justSavedBy: string | null): string {
  if (justSavedBy !== null) return `just now · by ${justSavedBy}`;
  if (!row.present) return "never saved — this flag has no row yet";
  // A row with no author is one the seed created and nobody has touched since,
  // which is a different fact from "an admin set it and we lost their name".
  const who = row.changedBy ?? "the seed";
  return `last changed ${row.changedAt} · by ${who}`;
}

function FlagCard({ row, actor }: { row: FlagRow; actor: string }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [note, setNote] = useState(row.note ?? "");
  const [savedNote, setSavedNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [justSavedBy, setJustSavedBy] = useState<string | null>(null);
  const [, start] = useTransition();

  const dirty = note.trim() !== savedNote;

  /**
   * `next` is applied to the switch before the round trip and rolled back if the
   * server refuses. The note draft is deliberately *not* rolled back: it is text
   * the admin is still typing, and throwing it away to undo a failed toggle
   * would punish them for the server's problem.
   *
   * The whole row is re-rendered from local state rather than from a
   * `router.refresh()`. Refreshing would race the optimistic value — the props
   * arriving mid-flight would flip the switch back under the reader's hand —
   * and the action already calls `revalidatePath("/flags")`, so the next visit
   * is accurate. The cost is that the "last changed" line is written here
   * instead of read from the server, which is what `justSavedBy` is.
   */
  const save = (next: boolean, nextNote: string | undefined) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    setOutcome(null);
    start(async () => {
      try {
        const res = await setFlag({
          key: row.key,
          enabled: next,
          ...(nextNote === undefined ? {} : { note: nextNote }),
        });

        if (!res.ok) {
          setEnabled(previous);
          setOutcome({ kind: "failed", error: res.error ?? "The change was not saved." });
          return;
        }

        if (nextNote !== undefined) {
          const stored = nextNote.trim();
          setSavedNote(stored);
          setNote(stored);
        }
        setJustSavedBy(actor);
        setOutcome(
          res.revalidated
            ? { kind: "saved" }
            : {
                kind: "stale",
                error: res.revalidateError ?? "The flush failed, and returned no error text.",
              }
        );
      } catch (e) {
        setEnabled(previous);
        setOutcome({ kind: "failed", error: transportError(e) });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="row fl-row">
      <div className="row-main">
        <div className="fl-head">
          <span className="fl-name">{row.label}</span>
          <code className="fl-key">{row.key}</code>
          {!row.present ? <Badge variant="warning">no row</Badge> : null}
          {!enabled ? <Badge variant="destructive" dot>off</Badge> : null}
          {enabled !== row.defaultEnabled ? (
            <span className="fl-def">default {row.defaultEnabled ? "on" : "off"}</span>
          ) : null}
        </div>

        <div className="fl-desc">{row.description}</div>
        <div className="fl-meta">{lastChanged(row, justSavedBy)}</div>

        <div className="fl-noterow">
          <input
            className="in fl-note"
            value={note}
            maxLength={500}
            disabled={busy}
            aria-label={`Note for ${row.label}`}
            placeholder="why is this off?"
            onChange={(e) => setNote(e.target.value)}
          />
          {dirty ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => save(enabled, note)}>
              <IconDeviceFloppy size={13} stroke={1.6} /> Save note
            </Button>
          ) : null}
        </div>

        {outcome ? <Result outcome={outcome} /> : null}
      </div>

      <div className="fl-switch">
        {busy ? <IconRefresh size={13} className="spin" /> : null}
        {/* The toggle sends no note at all, so a half-typed draft in the box
            cannot be committed by flipping a switch — `setFlag` leaves the
            column alone when `note` is omitted. */}
        <Switch
          checked={enabled}
          disabled={busy}
          ariaLabel={row.label}
          onChange={(next) => save(next, undefined)}
        />
      </div>
    </div>
  );
}

/** Declared order, not alphabetical: layout first, then the things a visitor never sees. */
const GROUPS: FlagDefinition["group"][] = ["Sections", "System"];

const GROUP_BLURB: Record<FlagDefinition["group"], string> = {
  Sections:
    "One band of the public homepage each. Off means the section is not rendered at all — no gap, no placeholder, and its nav link goes with it.",
  System:
    "Behaviour rather than layout. A visitor sees nothing change until one of these is off, which is exactly when it matters.",
};

export function FlagBoard({ rows, actor }: { rows: FlagRow[]; actor: string }) {
  return (
    <>
      {GROUPS.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <Card key={group} flush className="rv-card">
            <CardHead title={group} count={inGroup.length} />
            <div className="fl-blurb">{GROUP_BLURB[group]}</div>
            <div className="rows">
              {inGroup.map((r) => (
                <FlagCard key={r.key} row={r} actor={actor} />
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
