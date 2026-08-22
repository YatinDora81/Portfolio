"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { runDuePublish } from "@/lib/actions/publishing";
import { transportError } from "@/lib/lifecycle";
import { IconRefresh, IconPlayerPlay } from "@tabler/icons-react";

/**
 * Runs the due queue on demand, from the overdue warning that made it relevant.
 *
 * The warning already says a page load would have done this. The button exists
 * because "reload and see" is a worse instruction than a control that reports
 * what happened: it skips the "we checked recently" memo the background trigger
 * respects, and it says how many rows moved instead of leaving the admin to
 * count badges.
 */
export function RunDueButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [, start] = useTransition();

  const run = () => {
    setBusy(true);
    setSaid(null);
    start(async () => {
      try {
        const res = await runDuePublish();
        if (!res.ok) {
          setSaid(res.error ?? "The publish run failed.");
          return;
        }
        setSaid(
          res.published === 0
            ? "Nothing was due. If a row above still says Scheduled, its time has not actually arrived."
            : `Published ${res.published} item${res.published === 1 ? "" : "s"}.`
        );
        // The banner and every badge on the page are now stale by definition —
        // this action is the thing that changed them.
        router.refresh();
      } catch (e) {
        // An expired session redirects the action POST to /login, which arrives
        // here as a rejection. Without the catch the button would stay disabled
        // with nothing to explain it.
        setSaid(transportError(e));
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="lc-acts">
      <div className="lc-btns">
        <Button variant="outline" size="sm" disabled={busy} onClick={run}>
          {busy
            ? <><IconRefresh size={13} className="spin" /> Running…</>
            : <><IconPlayerPlay size={13} stroke={1.6} /> Run the schedule now</>}
        </Button>
      </div>
      {said ? <div className="lc-note">{said}</div> : null}
    </div>
  );
}
