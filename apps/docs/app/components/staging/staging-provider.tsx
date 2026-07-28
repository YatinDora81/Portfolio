"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { publishSite } from "@/lib/actions/publish";
import {
  applyStagedChanges,
  type Entity, type StagedFields, type StagedOp,
} from "@/lib/actions/staging";

/**
 * The admin's staging store — every edit, toggle, drag and delete lands here
 * instead of in the database, and leaves only when the save bar commits.
 *
 * Three rules keep the store honest:
 *
 * 1. **One op per user-visible change.** Editing a row twice coalesces into the
 *    single update that already exists; editing a row that is itself a pending
 *    create folds into that create. `count` is therefore just `ops.length`, and
 *    the number the bar shows is provably the number of rows the user changed.
 * 2. **A staged create has no server identity.** Deleting one removes the create
 *    outright rather than adding a delete — `applyStagedChanges` would otherwise
 *    be handed a `tmp_` id no table has ever seen and fail the whole batch. That
 *    is also the one staged delete with no undo behind it, which is why
 *    `DeleteButton` still asks first when the row is new (`newRow`).
 * 3. **Tables render through `overlay()`.** Staged state is visible the instant
 *    it is staged, without the round trip that a server write would need.
 *
 * The provider lives in the Shell, above the routed content, so staged changes
 * survive client-side navigation — the bar follows you to the next page rather
 * than silently dropping what you staged.
 */

type Toast = (msg: string, tone?: "good" | "bad") => void;

export interface StagingApi {
  /** The batch exactly as it will be POSTed. */
  ops: StagedOp[];
  /** Pending changes, matching what the save bar claims. */
  count: number;
  /** True while a commit is in flight. */
  saving: boolean;
  /** Stages a new row and returns the `tempId` it will be keyed by until saved. */
  stageCreate(entity: Entity, fields: StagedFields): string;
  /** Partial: only the keys passed are written. Coalesces onto any pending op for `id`. */
  stageUpdate(entity: Entity, id: string, fields: StagedFields): void;
  stageDelete(entity: Entity, id: string): void;
  /** The row-level undo. */
  unstageDelete(entity: Entity, id: string): void;
  /** `ids` is the full post-drag order, tempIds included. `version` scopes the
      op so a drag on one version's tab doesn't discard the other's. */
  stageReorder(entity: Entity, ids: string[], version?: string | null): void;
  discardAll(): void;
  commit(opts: { publish: boolean }): Promise<void>;
  isDeleted(entity: Entity, id: string): boolean;
  /** This row exists only in the browser so far. */
  isNew(entity: Entity, id: string): boolean;
  /** This row has a pending edit (a staged create counts as new, not edited). */
  isEdited(entity: Entity, id: string): boolean;
  /**
   * Server rows with staged creates, updates and the reorder applied. Staged
   * deletes stay in the list — flag them with `isDeleted` and render the row
   * struck through with its undo; dropping them here would take the undo with
   * them and punch holes in the ids a later reorder has to name.
   *
   * `version` must match the one the tab passes to `stageReorder`, or a
   * version-scoped list picks up the other tab's pending drag instead of its own.
   */
  overlay<T>(entity: Entity, rows: T[], getId: (r: T) => string, version?: string | null): T[];
}

const StagingContext = createContext<StagingApi | null>(null);

export function useStaging(): StagingApi {
  const api = useContext(StagingContext);
  if (!api) throw new Error("useStaging must be used inside <StagingProvider>.");
  return api;
}

/** Browser-only row keys. `tmp_` is also how a table tells a new row apart. */
let seq = 0;

function plural(n: number): string {
  return `${n} change${n === 1 ? "" : "s"}`;
}

/**
 * Staged fields are an untyped column bag; the row types belong to the caller.
 * Both casts are contained here so no table has to write one.
 */
function patched<T>(row: T, fields: StagedFields): T {
  return { ...row, ...fields } as T;
}

function materialise<T>(tempId: string, fields: StagedFields, at: number): T {
  // `sortOrder` first so a staged field of the same name still wins, `id` last so
  // the caller's `getId` finds the tempId whatever else the bag contains.
  return { sortOrder: at, ...fields, id: tempId } as unknown as T;
}

export function StagingProvider({ toast, children }: {
  toast: Toast;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ops, setOps] = useState<StagedOp[]>([]);
  const [saving, setSaving] = useState(false);

  // `commit` must read the batch and the in-flight flag as they are at click
  // time, not as they were when the callback was last created.
  const opsRef = useRef<StagedOp[]>(ops);
  opsRef.current = ops;
  const savingRef = useRef(false);

  const stageCreate = useCallback((entity: Entity, fields: StagedFields) => {
    const tempId = `tmp_${++seq}`;
    setOps((prev) => [...prev, { kind: "create", entity, tempId, fields: { ...fields } }]);
    return tempId;
  }, []);

  const stageUpdate = useCallback((entity: Entity, id: string, fields: StagedFields) => {
    // An update the server recognises nothing in fails the whole batch, so an
    // empty bag stages nothing at all.
    if (Object.keys(fields).length === 0) return;
    setOps((prev) => {
      const i = prev.findIndex(
        (op) =>
          op.entity === entity &&
          ((op.kind === "create" && op.tempId === id) || (op.kind === "update" && op.id === id))
      );
      const target = prev[i];
      if (!target || (target.kind !== "create" && target.kind !== "update")) {
        return [...prev, { kind: "update", entity, id, fields: { ...fields } }];
      }
      const merged = { ...target.fields, ...fields };
      const next = [...prev];
      next[i] = target.kind === "create"
        ? { kind: "create", entity, tempId: target.tempId, fields: merged }
        : { kind: "update", entity, id: target.id, fields: merged };
      return next;
    });
  }, []);

  const stageDelete = useCallback((entity: Entity, id: string) => {
    setOps((prev) => {
      const isStagedCreate = prev.some(
        (op) => op.kind === "create" && op.entity === entity && op.tempId === id
      );

      if (isStagedCreate) {
        // Never existed server-side: drop the create and the edits folded into
        // it, and stage NO delete — that id would blow up the batch.
        return prev
          .filter(
            (op) =>
              !(op.entity === entity &&
                ((op.kind === "create" && op.tempId === id) || (op.kind === "update" && op.id === id)))
          )
          .map((op) =>
            op.kind === "reorder" && op.entity === entity && op.ids.includes(id)
              ? { ...op, ids: op.ids.filter((x) => x !== id) }
              : op
          );
      }

      if (prev.some((op) => op.kind === "delete" && op.entity === entity && op.id === id)) return prev;

      // A pending edit to a row that is on its way out is not a change anyone can
      // see, so it folds into the delete instead of counting twice. The fields go
      // WITH the delete rather than into the bin: "undo" means undo the delete,
      // not undo the delete and the paragraph you rewrote just before it.
      const edit = prev.find(
        (op) => op.kind === "update" && op.entity === entity && op.id === id
      );
      const restore = edit?.kind === "update" ? edit.fields : undefined;
      return [
        ...prev.filter((op) => !(op.kind === "update" && op.entity === entity && op.id === id)),
        restore ? { kind: "delete", entity, id, restore } : { kind: "delete", entity, id },
      ];
    });
  }, []);

  const unstageDelete = useCallback((entity: Entity, id: string) => {
    setOps((prev) => {
      const gone = prev.find(
        (op) => op.kind === "delete" && op.entity === entity && op.id === id
      );
      const rest = prev.filter(
        (op) => !(op.kind === "delete" && op.entity === entity && op.id === id)
      );
      // Whatever the delete folded away comes back with it, so the row returns
      // as the user last left it instead of snapping back to the server's copy.
      const restore = gone?.kind === "delete" ? gone.restore : undefined;
      return restore ? [...rest, { kind: "update", entity, id, fields: restore }] : rest;
    });
  }, []);

  const stageReorder = useCallback(
    (entity: Entity, ids: string[], version?: string | null) => {
      // Only the final order matters, so a second drag replaces the first rather
      // than stacking a second op onto the count. Compared by version too, or
      // dragging on the v2 tab would silently discard a pending v1 drag.
      setOps((prev) => [
        ...prev.filter(
          (op) => !(op.kind === "reorder" && op.entity === entity && op.version === version)
        ),
        { kind: "reorder", entity, ids: [...ids], version },
      ]);
    },
    []
  );

  const discardAll = useCallback(() => setOps([]), []);

  const isDeleted = useCallback(
    (entity: Entity, id: string) =>
      ops.some((op) => op.kind === "delete" && op.entity === entity && op.id === id),
    [ops]
  );

  const isNew = useCallback(
    (entity: Entity, id: string) =>
      ops.some((op) => op.kind === "create" && op.entity === entity && op.tempId === id),
    [ops]
  );

  const isEdited = useCallback(
    (entity: Entity, id: string) =>
      ops.some((op) => op.kind === "update" && op.entity === entity && op.id === id),
    [ops]
  );

  const overlay = useCallback(
    <T,>(entity: Entity, rows: T[], getId: (r: T) => string, version?: string | null): T[] => {
      const mine = ops.filter((op) => op.entity === entity);
      if (mine.length === 0) return rows;

      const edits = new Map<string, StagedFields>();
      for (const op of mine) if (op.kind === "update") edits.set(op.id, op.fields);

      let out = edits.size
        ? rows.map((r) => {
            const f = edits.get(getId(r));
            return f ? patched(r, f) : r;
          })
        : [...rows];

      // Note what is NOT here: a staged delete leaves its row in place. It has to
      // stay on screen for the undo to exist, and leaving it in keeps the reorder
      // ids whole — the server strips the deleted ones itself.
      for (const op of mine) {
        // A create materialises under its tempId, so a brand-new row renders,
        // edits and drags exactly like a saved one.
        if (op.kind === "create") out.push(materialise<T>(op.tempId, op.fields, out.length));
      }

      // Matched on version, not just entity: with a drag pending on both tabs
      // the unmatched one would otherwise win and render the wrong order here.
      const ro = mine.find((op) => op.kind === "reorder" && op.version === version);
      if (ro?.kind === "reorder") {
        const pos = new Map(ro.ids.map((id, i) => [id, i] as const));
        // Rows the drag never saw (created since) keep their relative order at
        // the end rather than colliding on one rank.
        out = out
          .map((r, i) => ({ r, rank: pos.get(getId(r)) ?? ro.ids.length + i }))
          .sort((a, b) => a.rank - b.rank)
          .map((x) => x.r);
      }

      return out;
    },
    [ops]
  );

  /**
   * Retires the batch that just saved — and only that batch.
   *
   * Clearing the whole store would be one line, and would silently destroy
   * anything staged while the request was out. The window is real: the tables
   * stay interactive during a commit, and `Save & Publish` adds a second network
   * hop to the live site on top of the save.
   *
   * Ops are matched by identity, which is exactly right because coalescing
   * *replaces* op objects instead of mutating them — an op the user touched
   * mid-flight is a different object and correctly survives. A create that
   * survives is one of those: the row now exists, so what is left to apply is an
   * update against the real id `idMap` just handed back. Every other surviving
   * op gets the same tempId → real id treatment, or it would name a row the
   * database has never heard of.
   */
  const settle = useCallback((batch: StagedOp[], idMap: Record<string, string>) => {
    const done = new Set<StagedOp>(batch);
    const real = (id: string) => idMap[id] ?? id;
    setOps((prev) =>
      prev
        .filter((op) => !done.has(op))
        .map((op): StagedOp => {
          switch (op.kind) {
            case "create": {
              const id = idMap[op.tempId];
              return id ? { kind: "update", entity: op.entity, id, fields: op.fields } : op;
            }
            case "update":
              return { ...op, id: real(op.id) };
            case "delete":
              return { ...op, id: real(op.id) };
            case "reorder":
              return { ...op, ids: op.ids.map(real) };
          }
        })
    );
  }, []);

  const commit = useCallback(
    async ({ publish }: { publish: boolean }) => {
      // The ref, not `saving`: a second click lands before React has re-rendered
      // the disabled buttons, and must find the guard already closed.
      if (savingRef.current) return;
      const batch = opsRef.current;
      if (batch.length === 0) return;

      savingRef.current = true;
      setSaving(true);
      const n = batch.length;
      let saved = false;
      try {
        const res = await applyStagedChanges(batch);
        if (!res.ok) {
          toast(res.error, "bad");
          return;
        }
        saved = true;
        settle(batch, res.idMap);
        router.refresh();

        if (!publish) {
          toast(`Saved ${plural(n)}.`);
          return;
        }

        // Decision 5: the save has already landed. A publish that fails is a
        // separate, retryable failure — it never rolls the save back.
        const pub = await publishSite();
        if (pub.ok) toast(`Saved and published ${plural(n)}.`);
        else toast(`Saved ${plural(n)}, but publishing failed: ${pub.error ?? "unknown error"}`, "bad");
      } catch (e) {
        // `applyStagedChanges` turns its OWN failures into `{ ok:false }`; a
        // rejection here is the transport underneath it — the network gone, or
        // an expired session redirecting the action POST to /login. Without this
        // the promise dies unhandled: "Saving…" flips back to "Save", nothing is
        // said, and the user has no idea whether the batch landed. A throw in a
        // client event handler reaches no error boundary, so this is the only
        // place it can be reported.
        const why = e instanceof Error && e.message ? e.message : "the server could not be reached";
        toast(
          saved
            ? `Saved ${plural(n)}, but publishing failed: ${why}`
            : `Nothing was saved — ${why}. Your changes are still here; try again.`,
          "bad"
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [router, settle, toast]
  );

  const api = useMemo<StagingApi>(
    () => ({
      ops,
      count: ops.length,
      saving,
      stageCreate,
      stageUpdate,
      stageDelete,
      unstageDelete,
      stageReorder,
      discardAll,
      commit,
      isDeleted,
      isNew,
      isEdited,
      overlay,
    }),
    [
      ops, saving, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
      discardAll, commit, isDeleted, isNew, isEdited, overlay,
    ]
  );

  return (
    <StagingContext.Provider value={api}>
      {children}
      <LeaveGuard count={ops.length} />
    </StagingContext.Provider>
  );
}

/**
 * Warns before the user walks away from a dirty page.
 *
 * `beforeunload` covers reloads and closing the tab. In-app navigation is caught
 * in the capture phase at the document, which fires before React's own delegated
 * listener and so beats both a `<Link>` and the command palette's button to the
 * click. "Leave anyway" replays the very same click with the guard bypassed,
 * which is what lets one handler cover every navigation control without knowing
 * where any of them point.
 */
function LeaveGuard({ count }: { count: number }) {
  const [asking, setAsking] = useState(false);
  const pending = useRef<HTMLElement | null>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (count === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [count]);

  useEffect(() => {
    if (count === 0) return;

    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented) return;
      // Modified clicks open a new tab, which loses nothing.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;

      const el = e.target.closest<HTMLElement>("a[href], button.pal-it");
      if (!el) return;

      if (el instanceof HTMLAnchorElement) {
        if (el.hasAttribute("download")) return;
        if (el.target && el.target !== "_self") return;
        const url = new URL(el.href, window.location.href);
        // Off-site and same-page links leave the staged batch exactly where it is.
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) return;
      } else if (el.querySelector(".pal-k")?.textContent !== "go") {
        // The palette's non-navigating entries (open the live site) aren't leaving.
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      pending.current = el;
      setAsking(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [count]);

  const dismiss = () => {
    pending.current = null;
    setAsking(false);
  };

  const leave = () => {
    const el = pending.current;
    dismiss();
    if (!el) return;
    bypass.current = true;
    el.click();
    bypass.current = false;
  };

  if (!asking) return null;

  // `.pal` sits at z-index 100 and this dialog's veil at 90, so without a raised
  // wrapper the palette would paint straight over the question it just triggered.
  return (
    <div style={{ position: "relative", zIndex: 110 }}>
      <Dialog
        open
        onClose={dismiss}
        title="Leave with unsaved changes?"
        icon={IconAlertTriangle}
        footer={
          <>
            <Button variant="ghost" onClick={dismiss}>Stay here</Button>
            <Button variant="outline" onClick={leave}>Leave anyway</Button>
          </>
        }
      >
        <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
          {plural(count)} on this page {count === 1 ? "is" : "are"} still staged. Nothing is thrown away
          if you leave — the save bar follows you and Save still applies them — but you won&apos;t be able
          to see which rows they belong to until you come back.
        </p>
      </Dialog>
    </div>
  );
}
