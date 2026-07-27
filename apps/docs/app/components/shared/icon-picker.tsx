"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSearch, IconSelector, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import {
  SKILL_ICONS, SOCIAL_ICONS, ICON_GROUPS, matchesIconQuery,
  type SkillIconEntry, type SocialIconEntry,
} from "@repo/ui/icons/registry";
import { cn } from "@/lib/utils";

/**
 * Replaces the free-text "Icon key" field. The author picks a glyph they can
 * actually see; the canonical key still goes over the wire as `name`, so the
 * server actions keep reading `formData.get("iconKey")` unchanged.
 *
 * Two key namespaces exist and they are NOT interchangeable — skill keys are
 * display-cased (`Next.js`), social keys are lowercase slugs (`linkedin`).
 * `kind` picks the right one so the wrong namespace can't be offered.
 */

type Kind = "skill" | "social";

interface Opt {
  key: string;
  /** What the picker shows under the glyph — the key itself for skills. */
  label: string;
  group: string;
  aliases?: string[];
  /** Hidden keywords from the registry — matched, never displayed. Omitting
   *  these silently narrowed the picker vs the /icons page, which passes them. */
  search?: string;
  node: React.ReactNode;
}

function toOpts(kind: Kind): Opt[] {
  if (kind === "social") {
    return SOCIAL_ICONS.map((e: SocialIconEntry) => ({
      key: e.key,
      label: e.label,
      group: "Social & contact",
      aliases: e.aliases,
      search: e.search,
      node: <span className="ico-sw ink sm"><e.Icon /></span>,
    }));
  }
  return SKILL_ICONS.map((e: SkillIconEntry) => ({
    key: e.key,
    label: e.key,
    group: e.group,
    aliases: e.aliases,
    search: e.search,
    node: <span className="ico-sw sm"><e.Icon /></span>,
  }));
}

/** Groups in registry order, so the picker reads the same as the reference page. */
function groupOrder(kind: Kind): string[] {
  return kind === "social" ? ["Social & contact"] : [...ICON_GROUPS];
}

export function IconPicker({
  name = "iconKey",
  kind,
  defaultValue = "",
  label = "Icon",
  hint,
  required,
}: {
  name?: string;
  kind: Kind;
  defaultValue?: string;
  label?: string;
  hint?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const opts = useMemo(() => toOpts(kind), [kind]);
  const byKey = useMemo(() => new Map(opts.map((o) => [o.key, o])), [opts]);

  /** Aliases resolve to their canonical entry so legacy rows still show a glyph. */
  const current = useMemo(() => {
    if (!value) return undefined;
    const needle = value.trim().toLowerCase();
    return opts.find((o) => [o.key, ...(o.aliases ?? [])].some((k) => k.toLowerCase() === needle));
  }, [opts, value]);

  const filtered = useMemo(
    () => opts.filter((o) => matchesIconQuery(o, q)),
    [opts, q]
  );

  const groups = useMemo(() => {
    const order = groupOrder(kind);
    return order
      .map((g) => ({ group: g, items: filtered.filter((o) => o.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, kind]);

  /** Flat order matching what's rendered — keyboard indexes into this. */
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /** Typing a key the registry doesn't know is still allowed — just deliberate. */
  const customKey = q.trim();
  const showCustom = customKey.length > 0 && !byKey.has(customKey) && flat.length === 0;

  useEffect(() => setHot(0), [q]);

  const position = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const openUp = below < 240 && above > below;
    const maxH = Math.min(360, Math.max(200, openUp ? above : below));
    setRect({
      top: openUp ? r.top - 6 - maxH : r.bottom + 6,
      left: r.left,
      width: Math.max(r.width, 280),
      maxH,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    position();
    // `true` catches scrolls inside the dialog body and the page shell alike.
    const onScroll = () => position();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commit = (k: string) => {
    setValue(k);
    setOpen(false);
    setQ("");
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHot((h) => Math.min(h + 1, flat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showCustom) commit(customKey);
      else if (flat[hot]) commit(flat[hot].key);
    }
  };

  const unresolved = value !== "" && !current;

  return (
    <div className="f">
      {label && <label>{label}</label>}
      {/* The one field the server actually reads. */}
      <input type="hidden" name={name} value={value} />
      {/* Mirrors the hidden field so browser validation still fires on submit. */}
      {required && (
        <input
          tabIndex={-1}
          /* Deliberately NOT aria-hidden: constraint validation focuses THIS
             node to report "please fill out this field", and a hidden target
             leaves a screen-reader user with an error they can't perceive. */
          aria-label={`${label} — required`}
          required
          value={value}
          onChange={() => {}}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        />
      )}

      <div className="ipick">
        <button
          ref={btnRef}
          type="button"
          className="ipick-btn"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {current ? (
            current.node
          ) : (
            <span className="ico-sw ink sm" style={{ color: unresolved ? "var(--bad)" : "var(--faint)" }}>
              {unresolved ? <IconAlertTriangle size={13} stroke={1.8} /> : <IconSearch size={13} stroke={1.8} />}
            </span>
          )}
          <span className={cn("ipick-v", !value && "ph")}>
            {value || `Pick a ${kind === "social" ? "social" : "skill"} icon…`}
          </span>
          {unresolved && (
            <span className="chip amb" style={{ flex: "none" }}>no icon</span>
          )}
          <IconSelector className="ipick-chev" size={14} stroke={1.6} />
        </button>
      </div>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="ipick-pop"
          style={{ top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.maxH }}
          onKeyDown={onKeyDown}
        >
          <div className="ipick-s">
            <IconSearch size={14} style={{ color: "var(--faint)", flex: "none" }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={kind === "social" ? "github, linkedin, x…" : "react, postgres, docker…"}
            />
          </div>

          <div className="ipick-l">
            {groups.map((g) => (
              <div key={g.group}>
                <div className="ipick-gh">{g.group}</div>
                {g.items.map((o) => {
                  const i = flat.indexOf(o);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      className={cn("ipick-it", i === hot && "hot", o.key === value && "on")}
                      onMouseEnter={() => setHot(i)}
                      onClick={() => commit(o.key)}
                    >
                      {o.node}
                      <span className="ipick-k">{o.label}</span>
                      {o.key === value && <IconCheck size={13} stroke={2} style={{ flex: "none" }} />}
                    </button>
                  );
                })}
              </div>
            ))}

            {showCustom && (
              <>
                <div className="ipick-gh">Custom</div>
                <button type="button" className="ipick-it hot" onClick={() => commit(customKey)}>
                  <span className="ico-sw ink sm" style={{ color: "var(--faint)" }}>
                    <IconAlertTriangle size={13} stroke={1.8} />
                  </span>
                  <span className="ipick-k">Use &ldquo;{customKey}&rdquo; anyway</span>
                </button>
              </>
            )}

            {!showCustom && flat.length === 0 && (
              <div className="ipick-none">Nothing matches &ldquo;{q}&rdquo; — check /icons for the full set.</div>
            )}
          </div>

          <div className="ipick-f">
            <span>↑↓ move · ⏎ pick · esc close</span>
            <span className="sp" />
            {value && (
              <button type="button" className="ipick-clear" onClick={() => commit("")}>clear</button>
            )}
          </div>
        </div>,
        document.body
      )}

      {hint && <div className="f-hint">{hint}</div>}
      {unresolved && (
        <div className="f-hint" style={{ color: "var(--bad)" }}>
          The site has no icon for <code>{value}</code> — this renders blank.
        </div>
      )}
    </div>
  );
}
