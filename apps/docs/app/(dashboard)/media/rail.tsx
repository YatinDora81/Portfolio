"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFoldUp,
  IconLoader2,
} from "@tabler/icons-react";
import { crumbsOf, leafNameOf, sanitizeSegment, type BucketFolderDto } from "@repo/storage/media";
import { browseFolder, createFolder } from "@/lib/actions/media-browser";
import { cn } from "@/lib/utils";
import { hasFiles } from "./dropzone";

const SPRING_MS = 800;
const RAIL_MAX_PAGES = 6;

export interface FolderRailProps {
  prefix: string;
  folders?: BucketFolderDto[];
  dragging?: boolean;
  onNavigate: (prefix: string) => void;
  onDropInto?: (prefix: string, event: React.DragEvent) => void;
  onCreated?: (prefix: string) => void;
}

interface Row {
  prefix: string;
  parent: string | null;
}

function nameOf(prefix: string): string {
  return prefix === "" ? "bucket" : leafNameOf(prefix);
}

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

export function FolderRail({
  prefix,
  folders,
  dragging = false,
  onNavigate,
  onDropInto,
  onCreated,
}: FolderRailProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [kids, setKids] = useState<Map<string, string[]>>(() =>
    folders ? new Map([[prefix, folders.map((f) => f.prefix)]]) : new Map(),
  );
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [fail, setFail] = useState<Map<string, string>>(() => new Map());
  const [focus, setFocus] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [over, setOver] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const treeRef = useRef<HTMLDivElement>(null);
  const inflight = useRef<Set<string>>(new Set());
  const spring = useRef<{ prefix: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const load = useCallback(async (target: string) => {
    if (inflight.current.has(target)) return;
    inflight.current.add(target);
    setBusy((prev) => new Set(prev).add(target));

    const found: string[] = [];
    let cursor: string | null = null;
    let error = "";

    try {
      for (let page = 0; page < RAIL_MAX_PAGES; page += 1) {
        const res = await browseFolder({ prefix: target, cursor });
        if (!res.ok) {
          error = res.error ?? "That folder could not be read.";
          break;
        }
        for (const child of res.folders ?? []) found.push(child.prefix);
        cursor = res.cursor ?? null;
        if (cursor === null) break;
      }
    } catch (e) {
      error = transportError(e);
    }

    inflight.current.delete(target);
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(target);
      return next;
    });

    if (error) {
      setFail((prev) => new Map(prev).set(target, error));
      return;
    }
    setFail((prev) => {
      if (!prev.has(target)) return prev;
      const next = new Map(prev);
      next.delete(target);
      return next;
    });
    setKids((prev) => new Map(prev).set(target, [...new Set(found)].sort()));
  }, []);

  useEffect(() => {
    for (const target of expanded) {
      if (!kids.has(target) && !fail.has(target)) void load(target);
    }
  }, [expanded, kids, fail, load]);

  useEffect(() => {
    if (!folders) return;
    const listed = folders.map((f) => f.prefix);
    setKids((prev) => {
      const have = prev.get(prefix);
      if (have && have.join("\n") === listed.join("\n")) return prev;
      return new Map(prev).set(prefix, listed);
    });
  }, [prefix, folders]);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let grew = false;
      for (const crumb of crumbsOf(prefix)) {
        if (next.has(crumb.prefix)) continue;
        next.add(crumb.prefix);
        grew = true;
      }
      return grew ? next : prev;
    });
  }, [prefix]);

  useEffect(() => {
    if (!focusTick || focus === null) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-np="${CSS.escape(focus)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusTick, focus]);

  const clearSpring = useCallback(() => {
    if (spring.current) clearTimeout(spring.current.timer);
    spring.current = null;
  }, []);

  useEffect(() => clearSpring, [clearSpring]);

  const visible = useMemo(() => {
    const out: Row[] = [];
    const walk = (p: string, parent: string | null) => {
      out.push({ prefix: p, parent });
      if (!expanded.has(p)) return;
      for (const child of kids.get(p) ?? []) walk(child, p);
    };
    walk("", null);
    return out;
  }, [expanded, kids]);

  const roving = useMemo(
    () => (focus !== null && visible.some((r) => r.prefix === focus) ? focus : ""),
    [focus, visible],
  );

  const focusRow = (target: string | null | undefined) => {
    if (target === null || target === undefined) return;
    setFocus(target);
    setFocusTick((t) => t + 1);
  };

  const toggle = useCallback(
    (target: string, want?: boolean) => {
      if (fail.has(target)) {
        setFail((prev) => {
          const next = new Map(prev);
          next.delete(target);
          return next;
        });
        setExpanded((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
        return;
      }
      setExpanded((prev) => {
        const open = want ?? !prev.has(target);
        if (!open && target === "") return prev;
        const next = new Set(prev);
        if (open) next.add(target);
        else next.delete(target);
        return next;
      });
    },
    [fail],
  );

  const armSpring = (target: string) => {
    if (spring.current?.prefix === target) return;
    clearSpring();
    if (expanded.has(target)) return;
    spring.current = {
      prefix: target,
      timer: setTimeout(() => {
        spring.current = null;
        toggle(target, true);
      }, SPRING_MS),
    };
  };

  const accepts = (target: string, e: React.DragEvent): boolean => {
    if (!onDropInto) return false;
    return dragging ? target !== "" : hasFiles(e.dataTransfer);
  };

  const beginCreate = () => {
    setNotice(null);
    setExpanded((prev) => (prev.has(prefix) ? prev : new Set(prev).add(prefix)));
    setCreating(prefix);
  };

  const commitCreate = (name: string) => {
    const into = creating;
    setCreating(null);
    if (into === null || name === "") return;
    startTransition(async () => {
      try {
        const res = await createFolder({ prefix: into, name });
        if (!res.ok) {
          setNotice({ text: res.error ?? "That folder could not be made.", bad: true });
          return;
        }
        setNotice({
          text:
            res.created === false
              ? `“${res.name}” was already there.`
              : `Created “${res.name}” in ${nameOf(into)}.`,
          bad: false,
        });
        await load(into);
        const made = res.prefix ?? into;
        focusRow(made);
        onCreated?.(made);
      } catch (e) {
        setNotice({ text: transportError(e), bad: true });
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-np]");
    const p = el?.getAttribute("data-np");
    if (p === null || p === undefined) return;
    const i = visible.findIndex((r) => r.prefix === p);
    const row = visible[i];
    if (!row) return;
    const open = expanded.has(p);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(visible[i + 1]?.prefix);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(visible[i - 1]?.prefix);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (!open) toggle(p, true);
        else focusRow(visible[i + 1]?.prefix);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (open && p !== "") toggle(p, false);
        else focusRow(row.parent);
        break;
      case "Home":
        e.preventDefault();
        focusRow(visible[0]?.prefix);
        break;
      case "End":
        e.preventDefault();
        focusRow(visible[visible.length - 1]?.prefix);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        toggle(p, true);
        onNavigate(p);
        break;
      case "F2":
        e.preventDefault();
        beginCreate();
        break;
    }
  };

  const renderNode = (p: string, level: number, pos: number, size: number): React.ReactNode => {
    const list = kids.get(p);
    const broken = fail.get(p);
    const loading = busy.has(p);
    const open = expanded.has(p);
    const twisty = p === "" || list === undefined || list.length > 0;
    const Twisty = open ? IconChevronDown : IconChevronRight;
    const Glyph = broken
      ? IconAlertTriangle
      : p === ""
        ? IconDatabase
        : open
          ? IconFolderOpen
          : IconFolder;
    const showGroup = (open && (list?.length ?? 0) > 0) || creating === p;

    return (
      <div
        key={p}
        data-np={p}
        role="treeitem"
        aria-level={level}
        aria-posinset={pos}
        aria-setsize={size}
        aria-selected={p === prefix}
        aria-expanded={twisty ? open : undefined}
        aria-label={p === "" ? "The whole bucket" : `${nameOf(p)}, folder`}
        aria-busy={loading || undefined}
        tabIndex={p === roving ? 0 : -1}
        className={cn(
          "nt-item",
          p === prefix && "sel",
          p === roving && "kfoc",
          over === p && "drop",
        )}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocus(p);
        }}
      >
        <div
          className="nt-row"
          title={broken ?? (p === "" ? "Every folder in the bucket" : p)}
          onClick={(e) => {
            focusRow(p);
            if (broken || (e.target as HTMLElement).closest("[data-tw]")) {
              toggle(p);
              return;
            }
            toggle(p, true);
            onNavigate(p);
          }}
          onDragEnter={(e) => {
            if (!accepts(p, e)) return;
            e.preventDefault();
            setOver(p);
            armSpring(p);
          }}
          onDragOver={(e) => {
            if (!accepts(p, e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = dragging ? "move" : "copy";
            setOver(p);
          }}
          onDragLeave={() => {
            setOver((prev) => (prev === p ? null : prev));
            if (spring.current?.prefix === p) clearSpring();
          }}
          onDrop={(e) => {
            if (!accepts(p, e)) return;
            e.preventDefault();
            e.stopPropagation();
            clearSpring();
            setOver(null);
            onDropInto?.(p, e);
          }}
        >
          <span className="nt-tw" data-tw aria-hidden="true">
            {loading ? (
              <IconLoader2 size={11} className="spin" />
            ) : twisty ? (
              <Twisty size={11} />
            ) : null}
          </span>
          <span className="nt-ic" aria-hidden="true">
            <Glyph size={14} />
          </span>
          <span className="nt-tx">{nameOf(p)}</span>
        </div>

        {showGroup ? (
          <div role="group" className="nt-group">
            {creating === p ? (
              <NewFolder
                into={p}
                onCommit={commitCreate}
                onCancel={() => {
                  setCreating(null);
                  focusRow(p);
                }}
              />
            ) : null}
            {(list ?? []).map((child, i) =>
              renderNode(child, level + 1, i + 1, (list ?? []).length),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mdb-rail">
      <div className="mdb-rail-h">
        <span className="mdb-rail-k">{busy.size || pending ? "reading…" : "folders"}</span>
        <span className="sp" />
        <button
          type="button"
          className="nt-iconbtn"
          title={`New folder in ${nameOf(prefix)} · F2`}
          aria-label={`New folder in ${nameOf(prefix)}`}
          onClick={beginCreate}
        >
          <IconFolderPlus size={15} />
        </button>
        <button
          type="button"
          className="nt-iconbtn"
          title="Collapse every open folder"
          aria-label="Collapse every open folder"
          onClick={() => setExpanded(new Set([""]))}
        >
          <IconFoldUp size={15} />
        </button>
      </div>

      <div className="mdb-rail-s">
        <div
          ref={treeRef}
          className="nt-tree"
          role="tree"
          aria-label="Bucket folders"
          aria-busy={busy.size > 0}
          onKeyDown={onKeyDown}
        >
          {renderNode("", 1, 1, 1)}
        </div>
      </div>

      {notice ? (
        <div className="mdb-rail-foot">
          <span className={cn("f-hint", notice.bad && "nt-bad")}>{notice.text}</span>
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="sr-only">
        {notice?.text ?? ""}
      </div>
    </div>
  );
}

function NewFolder({
  into,
  onCommit,
  onCancel,
}: {
  into: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState("");
  const slug = sanitizeSegment(value);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value.trim());
    else onCancel();
  };

  return (
    <>
      <div className="nt-inline" role="none">
        <span className="nt-tw" aria-hidden="true" />
        <span className="nt-ic" aria-hidden="true">
          <IconFolder size={14} />
        </span>
        <input
          ref={ref}
          className="nt-inline-in"
          value={value}
          placeholder="Folder name…"
          aria-label={`New folder in ${nameOf(into)}`}
          aria-describedby="mdb-rail-slug"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      </div>
      <div className="mdb-slug" id="mdb-rail-slug">
        {slug === "" ? (
          "a folder name needs a letter or a number"
        ) : (
          <>
            → <b>{`${into}${slug}/`}</b>
          </>
        )}
      </div>
    </>
  );
}
