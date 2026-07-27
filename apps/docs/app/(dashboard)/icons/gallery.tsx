"use client";

import { useMemo, useRef, useState } from "react";
import { IconSearch, IconCopy, IconCheck, IconAlertTriangle, IconMoodSad } from "@tabler/icons-react";
import { SKILL_ICONS, SOCIAL_ICONS, ICON_GROUPS, matchesIconQuery } from "@repo/ui/icons/registry";
import { Card, CardHead } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Cell {
  key: string;
  label: string;
  group: string;
  aliases?: string[];
  search?: string;
  node: React.ReactNode;
  used: number;
}

export function IconLibrary({
  skillUse,
  socialUse,
  broken,
  nameOnlyGaps,
}: {
  skillUse: Record<string, number>;
  socialUse: Record<string, number>;
  broken: { where: string; row: string; key: string }[];
  nameOnlyGaps: string[];
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skillCells: Cell[] = useMemo(
    () =>
      SKILL_ICONS.map((e) => ({
        key: e.key,
        label: e.key,
        group: e.group,
        aliases: e.aliases,
        search: e.search,
        node: <span className="ico-sw"><e.Icon /></span>,
        used: skillUse[e.key] ?? 0,
      })),
    [skillUse]
  );

  const socialCells: Cell[] = useMemo(
    () =>
      SOCIAL_ICONS.map((e) => ({
        key: e.key,
        label: e.label,
        group: "Social & contact",
        aliases: e.aliases,
        search: e.search,
        node: <span className="ico-sw ink"><e.Icon /></span>,
        used: socialUse[e.key] ?? 0,
      })),
    [socialUse]
  );

  const visibleSkills = useMemo(
    () => skillCells.filter((c) => (group === "all" || c.group === group) && matchesIconQuery(c, q)),
    [skillCells, group, q]
  );
  const visibleSocial = useMemo(
    () => socialCells.filter((c) => (group === "all" || group === "Social & contact") && matchesIconQuery(c, q)),
    [socialCells, group, q]
  );

  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      // Clipboard is permission-gated; the key is on screen either way.
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1400);
  };

  const grouped = useMemo(
    () =>
      ICON_GROUPS.map((g) => ({ group: g as string, items: visibleSkills.filter((c) => c.group === g) })).filter(
        (g) => g.items.length > 0
      ),
    [visibleSkills]
  );

  const total = visibleSkills.length + visibleSocial.length;

  return (
    <>
      {broken.length > 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>{broken.length} saved {broken.length === 1 ? "key doesn't" : "keys don't"} match any icon</b>
            These render as an empty gap on the live site. Fix them in the dialog that owns each row —{" "}
            {broken.map((b, i) => (
              <span key={`${b.where}-${b.row}-${i}`}>
                {i > 0 && ", "}
                {b.where} · {b.row} <code>{b.key || "(blank)"}</code>
              </span>
            ))}
            .
          </div>
        </div>
      )}

      {nameOnlyGaps.length > 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>{nameOnlyGaps.length} {nameOnlyGaps.length === 1 ? "skill renders" : "skills render"} iconless on the experience timeline</b>
            That one surface matches on the skill&rsquo;s <em>name</em> rather than its icon key, so a name the
            library doesn&rsquo;t know draws nothing there — even though the skills grid and project cards are
            fine. Affected:{" "}
            {nameOnlyGaps.map((g, i) => (
              <span key={g}>{i > 0 && ", "}<code>{g}</code></span>
            ))}
            .
          </div>
        </div>
      )}

      <Card flush>
        <CardHead title="Icon keys" count={total} />

        <div className="filters">
          <div style={{ position: "relative", flex: "1 1 260px", minWidth: 200 }}>
            <IconSearch
              size={14}
              style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                color: "var(--faint)", pointerEvents: "none",
              }}
            />
            <input
              className="in"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search react, postgres, aws, linkedin…"
              style={{ padding: "6px 12px 6px 32px", fontSize: 12.5 }}
            />
          </div>
          <button className={cn("filt", group === "all" && "on")} onClick={() => setGroup("all")}>
            All
          </button>
          {ICON_GROUPS.map((g) => (
            <button key={g} className={cn("filt", group === g && "on")} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
          <button
            className={cn("filt", group === "Social & contact" && "on")}
            onClick={() => setGroup("Social & contact")}
          >
            Social
          </button>
        </div>

        <div className="card-b">
          {total === 0 && (
            <div className="empty">
              <div className="empty-ic"><IconMoodSad size={19} stroke={1.5} /></div>
              <b>No icon matches &ldquo;{q}&rdquo;</b>
              <span>Try the tool&rsquo;s short name — &ldquo;pg&rdquo; finds PostgreSQL, &ldquo;ts&rdquo; finds TypeScript.</span>
            </div>
          )}

          {grouped.map((g, gi) => (
            <div key={g.group} className="skill-cat" style={gi === grouped.length - 1 && visibleSocial.length === 0 ? { marginBottom: 0 } : undefined}>
              <div className="skill-cat-h">
                <div className="skill-cat-t">{g.group}</div>
                <div className="skill-cat-n">/ {String(g.items.length).padStart(2, "0")}</div>
              </div>
              <div className="ico-grid">
                {g.items.map((c) => (
                  <IconCell key={c.key} cell={c} copied={copied === c.key} onCopy={copy} />
                ))}
              </div>
            </div>
          ))}

          {visibleSocial.length > 0 && (
            <div className="skill-cat" style={{ marginBottom: 0 }}>
              <div className="skill-cat-h">
                <div className="skill-cat-t">Social &amp; contact · lowercase keys</div>
                <div className="skill-cat-n">/ {String(visibleSocial.length).padStart(2, "0")}</div>
              </div>
              <div className="ico-grid">
                {visibleSocial.map((c) => (
                  <IconCell key={c.key} cell={c} copied={copied === c.key} onCopy={copy} />
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function IconCell({
  cell,
  copied,
  onCopy,
}: {
  cell: Cell;
  copied: boolean;
  onCopy: (key: string) => void;
}) {
  const aliasLine = cell.aliases?.length
    ? `also ${cell.aliases.join(", ")}`
    : cell.label !== cell.key
      ? cell.label
      : null;

  return (
    <button
      type="button"
      className={cn("ico-cell", copied && "copied")}
      onClick={() => onCopy(cell.key)}
      title={`Copy "${cell.key}"`}
    >
      {cell.node}
      <div className="ico-cell-m">
        <div className="ico-k">{cell.key}</div>
        {aliasLine && <div className="ico-a">{aliasLine}</div>}
      </div>
      {cell.used > 0 && <span className="ico-n" title={`Used by ${cell.used} row${cell.used === 1 ? "" : "s"}`}>{cell.used}</span>}
      <span className="ico-cp">
        {copied ? <IconCheck size={13} stroke={2} /> : <IconCopy size={13} stroke={1.6} />}
      </span>
    </button>
  );
}
