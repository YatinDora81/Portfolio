"use client";

import {
  createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState,
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

type Toast = (msg: string, tone?: "good" | "bad") => void;

export interface StagingApi {
  ops: StagedOp[];
  count: number;
  saving: boolean;
  stageCreate(entity: Entity, fields: StagedFields): string;
  stageUpdate(entity: Entity, id: string, fields: StagedFields): void;
  stageDelete(entity: Entity, id: string): void;
  clearUpdate(entity: Entity, id: string, keys?: string[]): void;
  unstageDelete(entity: Entity, id: string): void;
  stageReorder(entity: Entity, ids: string[], version?: string | null): void;
  discardAll(): void;
  commit(opts: { publish: boolean }): Promise<void>;
  isDeleted(entity: Entity, id: string): boolean;
  isNew(entity: Entity, id: string): boolean;
  isEdited(entity: Entity, id: string): boolean;
  overlay<T>(entity: Entity, rows: T[], getId: (r: T) => string, version?: string | null): T[];
}

const StagingContext = createContext<StagingApi | null>(null);

export function useStaging(): StagingApi {
  const api = useContext(StagingContext);
  if (!api) throw new Error("useStaging must be used inside <StagingProvider>.");
  return api;
}

let seq = 0;

function plural(n: number): string {
  return `${n} change${n === 1 ? "" : "s"}`;
}

function patched<T>(row: T, fields: StagedFields): T {
  return { ...row, ...fields } as T;
}

function materialise<T>(tempId: string, fields: StagedFields, at: number): T {
  // id last so the caller's getId finds the tempId
  return { sortOrder: at, ...fields, id: tempId } as unknown as T;
}

export function StagingProvider({ toast, children }: {
  toast: Toast;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ops, setOps] = useState<StagedOp[]>([]);
  const [saving, setSaving] = useState(false);

  const opsRef = useRef<StagedOp[]>(ops);
  opsRef.current = ops;
  const savingRef = useRef(false);

  const stageCreate = useCallback((entity: Entity, fields: StagedFields) => {
    const tempId = `tmp_${++seq}`;
    setOps((prev) => [...prev, { kind: "create", entity, tempId, fields: { ...fields } }]);
    return tempId;
  }, []);

  const stageUpdate = useCallback((entity: Entity, id: string, fields: StagedFields) => {
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

  const clearUpdate = useCallback((entity: Entity, id: string, keys?: string[]) => {
    setOps((prev) => {
      const i = prev.findIndex(
        (op) => op.kind === "update" && op.entity === entity && op.id === id
      );
      const target = prev[i];
      if (!target || target.kind !== "update") return prev;
      if (!keys) return prev.filter((op) => op !== target);

      const fields = { ...target.fields };
      for (const key of keys) delete fields[key];
      if (Object.keys(fields).length === 0) return prev.filter((op) => op !== target);

      const next = [...prev];
      next[i] = { kind: "update", entity, id, fields };
      return next;
    });
  }, []);

  const stageDelete = useCallback((entity: Entity, id: string) => {
    setOps((prev) => {
      const isStagedCreate = prev.some(
        (op) => op.kind === "create" && op.entity === entity && op.tempId === id
      );

      if (isStagedCreate) {
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
    if (savingRef.current) return;
    setOps((prev) => {
      const gone = prev.find(
        (op) => op.kind === "delete" && op.entity === entity && op.id === id
      );
      const rest = prev.filter(
        (op) => !(op.kind === "delete" && op.entity === entity && op.id === id)
      );
      const restore = gone?.kind === "delete" ? gone.restore : undefined;
      return restore ? [...rest, { kind: "update", entity, id, fields: restore }] : rest;
    });
  }, []);

  const stageReorder = useCallback(
    (entity: Entity, ids: string[], version?: string | null) => {
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

      for (const op of mine) {
        if (op.kind === "create") out.push(materialise<T>(op.tempId, op.fields, out.length));
      }

      const ro = mine.find((op) => op.kind === "reorder" && op.version === version);
      if (ro?.kind === "reorder") {
        const pos = new Map(ro.ids.map((id, i) => [id, i] as const));
        out = out
          .map((r, i) => ({ r, rank: pos.get(getId(r)) ?? ro.ids.length + i }))
          .sort((a, b) => a.rank - b.rank)
          .map((x) => x.r);
      }

      return out;
    },
    [ops]
  );

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
      // ref, not state: clicks land before the buttons disable
      if (savingRef.current) return;
      const batch = opsRef.current;
      if (batch.length === 0) return;

      savingRef.current = true;
      setSaving(true);
      const n = batch.length;
      let saved = false;
      try {
        const res = await applyStagedChanges(batch, publish ? "SAVE_AND_PUBLISH" : "SAVE");
        if (!res.ok) {
          toast(res.error, "bad");
          return;
        }
        saved = true;
        // one transition, or the store empties against pre-save props
        startTransition(() => {
          settle(batch, res.idMap);
          router.refresh();
        });

        if (!publish) {
          toast(`Saved ${plural(n)}.`);
          return;
        }

        const pub = await publishSite({ eventId: res.eventId });
        if (pub.ok) toast(`Saved and published ${plural(n)}.`);
        else toast(`Saved ${plural(n)}, but publishing failed: ${pub.error ?? "unknown error"}`, "bad");
      } catch (e) {
        const why = e instanceof Error && e.message ? e.message : "the server could not be reached";
        toast(
          saved
            ? `Saved ${plural(n)}, but publishing failed: ${why}`
            : `Nothing was saved — ${why}. Your changes are still here; try again.`,
          "bad"
        );
      } finally {
        savingRef.current = false;
        startTransition(() => setSaving(false));
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
      clearUpdate,
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
      ops, saving, stageCreate, stageUpdate, stageDelete, clearUpdate, unstageDelete,
      stageReorder, discardAll, commit, isDeleted, isNew, isEdited, overlay,
    ]
  );

  return (
    <StagingContext.Provider value={api}>
      {children}
      <LeaveGuard count={ops.length} />
    </StagingContext.Provider>
  );
}

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
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;

      const el = e.target.closest<HTMLElement>("a[href], button.pal-it");
      if (!el) return;

      if (el instanceof HTMLAnchorElement) {
        if (el.hasAttribute("download")) return;
        if (el.target && el.target !== "_self") return;
        const url = new URL(el.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) return;
      } else if (el.querySelector(".pal-k")?.textContent !== "go") {
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

  return (
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
  );
}
