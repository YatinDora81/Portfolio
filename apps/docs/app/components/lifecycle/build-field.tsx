"use client";

import type { BuildState, MilestoneState } from "db";
import { IconAlertTriangle, IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  BUILD_LABEL, BUILD_NOTE, BUILD_STATES, BUILD_SUB, BUILD_VERSION_MAX, ETA_MAX,
  MILESTONE_CAP, MILESTONE_LABEL_MAX, MILESTONE_STATES,
  buildWarning, isBuildState, isMilestoneState,
} from "@/lib/lifecycle";

export interface MilestoneDraft {
  id?: string;
  label: string;
  state: MilestoneState;
  sortOrder: number;
}

export function BuildField({
  buildState,
  onBuildState,
  buildVersion,
  onBuildVersion,
  etaLabel,
  onEtaLabel,
  milestones,
  onMilestones,
  liveUrl,
  bulletCount,
  neglect,
}: {
  buildState: BuildState;
  onBuildState: (next: BuildState) => void;
  buildVersion: string;
  onBuildVersion: (next: string) => void;
  etaLabel: string;
  onEtaLabel: (next: string) => void;
  milestones: MilestoneDraft[];
  onMilestones: (next: MilestoneDraft[]) => void;
  liveUrl: string;
  bulletCount: number;
  neglect?: string | null;
}) {
  const inFlight = buildState !== "SHIPPED";
  const named = milestones.filter((m) => m.label.trim().length > 0);
  const warning = buildWarning(buildState, named);

  const patch = (index: number, change: Partial<MilestoneDraft>) => {
    onMilestones(milestones.map((m, i) => (i === index ? { ...m, ...change } : m)));
  };

  const swap = (index: number, to: number) => {
    const next = [...milestones];
    const moved = next[index]!;
    next[index] = next[to]!;
    next[to] = moved;
    onMilestones(next.map((m, i) => ({ ...m, sortOrder: i })));
  };

  const drop = (index: number) => {
    onMilestones(milestones.filter((_, i) => i !== index).map((m, i) => ({ ...m, sortOrder: i })));
  };

  return (
    <div className="lc-field ad-build">
      <div className="f">
        <label id="ad-bs-lab">Build state</label>

        <div className="ad-seg" role="radiogroup" aria-labelledby="ad-bs-lab">
          {BUILD_STATES.map((state) => (
            <label key={state} className="ad-seg-o" data-state={state}>
              <input
                type="radio"
                name="buildState"
                value={state}
                checked={state === buildState}
                onChange={(e) => {
                  if (isBuildState(e.target.value)) onBuildState(e.target.value);
                }}
              />
              <span>{BUILD_LABEL[state]}</span>
              <em>{BUILD_SUB[state]}</em>
            </label>
          ))}
        </div>

        <div className="f-hint">{BUILD_NOTE[buildState]}</div>

        {inFlight && liveUrl.trim() ? (
          <div className="lc-warn">
            <b><IconAlertTriangle size={13} stroke={1.7} /> A live URL and {BUILD_LABEL[buildState]} say different things</b>
            <code>{liveUrl.trim()}</code> is set above, and this tells the row there is nothing to
            visit yet. Saving is allowed: the row still prints the domain, links nothing to it, and
            the health probe skips it — which is right if the domain is a plan you have reserved. If
            it is actually serving, set the state back to Shipped.
          </div>
        ) : null}

        {!inFlight && bulletCount === 0 ? (
          <div className="lc-warn">
            <b><IconAlertTriangle size={13} stroke={1.7} /> Shipped with no bullet points</b>
            Shipped is the state that ignores everything below, so the fold falls back to the
            bullets — and there are none. The row will open onto nothing. Milestones are kept either
            way, so coming back to Building loses nothing.
          </div>
        ) : null}
      </div>

      {inFlight ? (
        <div className="ad-g">
          <div className="ad-gh">
            <h3>The drawing <code>ProjectMilestone</code></h3>
            <p>
              Three panes, left to right. Name the surface, not the task — and the row marked doing
              is the one the dimension line points at.
            </p>
          </div>

          {milestones.length ? (
            <div className="ad-rep">
              {milestones.map((milestone, i) => (
                <div className="ad-row" key={milestone.id ?? `new-${i}`}>
                  <div className="ad-ord">
                    <span className="row-i">{String(i + 1).padStart(2, "0")}</span>
                    <button
                      type="button"
                      className="ibtn"
                      disabled={i === 0}
                      aria-label={`Move milestone ${i + 1} up`}
                      onClick={() => swap(i, i - 1)}
                    >
                      <IconChevronUp size={13} stroke={1.5} />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      disabled={i === milestones.length - 1}
                      aria-label={`Move milestone ${i + 1} down`}
                      onClick={() => swap(i, i + 1)}
                    >
                      <IconChevronDown size={13} stroke={1.5} />
                    </button>
                  </div>

                  <div className="ad-main">
                    <div className="ad-ms-wrap">
                      <input
                        className="in"
                        value={milestone.label}
                        maxLength={MILESTONE_LABEL_MAX}
                        placeholder="scheduling"
                        aria-label={`Milestone ${i + 1} label`}
                        onChange={(e) => patch(i, { label: e.target.value })}
                      />
                      <div className="ad-ms" role="radiogroup" aria-label={`Milestone ${i + 1} state`}>
                        {MILESTONE_STATES.map((state) => (
                          <label key={state} data-ms={state}>
                            <input
                              type="radio"
                              name={`ad-ms-${i}`}
                              value={state}
                              checked={milestone.state === state}
                              onChange={(e) => {
                                if (isMilestoneState(e.target.value)) patch(i, { state: e.target.value });
                              }}
                            />
                            {state.toLowerCase()}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="ibtn warn ad-del"
                    aria-label={`Remove milestone ${i + 1}`}
                    onClick={() => drop(i)}
                  >
                    <IconTrash size={14} stroke={1.5} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={milestones.length >= MILESTONE_CAP}
              onClick={() =>
                onMilestones([
                  ...milestones,
                  { label: "", state: "NEXT", sortOrder: milestones.length },
                ])
              }
            >
              <IconPlus size={14} /> Add milestone
            </Button>
          </div>

          <div className="f-hint">
            One word each, {MILESTONE_LABEL_MAX} characters at most — the two right-hand panes are
            the narrow ones and clip anything longer. {MILESTONE_CAP} is the cap because the cover
            draws {MILESTONE_CAP} panes; a fourth row would be stored and never shown. An empty
            label is not saved, so clearing a row removes its pane.
          </div>

          {warning ? (
            <div className="lc-warn">
              <b><IconAlertTriangle size={13} stroke={1.7} /> The drawing will not point anywhere</b>
              {warning}
            </div>
          ) : null}

          {neglect ? (
            <div className="lc-warn">
              <b><IconAlertTriangle size={13} stroke={1.7} /> This has been saying the same thing for a while</b>
              {neglect} A pane looks identical in week one and month six, so the drawing goes stale
              quietly. The honest edit is a milestone flip — or <b>Paused</b>, which drains the amber
              and drops the eta rather than letting either keep claiming momentum.
            </div>
          ) : null}

          <div className="f-row">
            <div className="f">
              <label htmlFor="ad-bv">Version</label>
              <input
                id="ad-bv"
                className="in mono"
                value={buildVersion}
                maxLength={BUILD_VERSION_MAX}
                placeholder="v0.4"
                onChange={(e) => onBuildVersion(e.target.value)}
              />
              <div className="f-hint">
                Whatever you call it in commits. It prints on the corner tab; leave it empty and the
                tab reads just <code>&#9650; plan</code>.
              </div>
            </div>

            <div className="f">
              <label htmlFor="ad-eta">Eta</label>
              <input
                id="ad-eta"
                className="in"
                value={etaLabel}
                maxLength={ETA_MAX}
                placeholder="shipping ~ Nov"
                onChange={(e) => onEtaLabel(e.target.value)}
              />
              <div className="f-hint">
                Prose, not a date — a real date is refused on save. Leave it empty rather than guess:
                the row drops the chip by itself once the month it names is past, and Paused drops it
                outright. <span className="ad-count">{etaLabel.length}/{ETA_MAX}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
