"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useSortable(
  ids: string[],
  onCommit: (ids: string[]) => void,
  { disabled = false }: { disabled?: boolean } = {}
) {
  const [order, setOrder] = useState<string[]>(ids);
  const [dragId, setDragId] = useState<string | null>(null);

  const nodes = useRef(new Map<string, HTMLElement>());
  const startOrder = useRef<string[]>([]);
  const orderRef = useRef<string[]>(ids);
  orderRef.current = order;

  const key = ids.join("\u0000");
  const seededKey = useRef(key);
  useEffect(() => {
    if (key === seededKey.current) return;
    seededKey.current = key;
    setOrder(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const register = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const move = useCallback((id: string, overId: string) => {
    setOrder((prev) => {
      const from = prev.indexOf(id);
      const to = prev.indexOf(overId);
      if (from === to || from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const onPointerDown = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      startOrder.current = orderRef.current;
      setDragId(id);
    },
    [disabled]
  );

  const onPointerMove = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      if (dragId !== id) return;
      e.preventDefault();

      // ignore the dragged node itself when hit-testing
      const self = nodes.current.get(id);
      const prevPointerEvents = self?.style.pointerEvents;
      if (self) self.style.pointerEvents = "none";
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (self) self.style.pointerEvents = prevPointerEvents ?? "";

      const target = hit?.closest<HTMLElement>("[data-sortable-id]");
      const overId = target?.dataset.sortableId;
      if (!overId || overId === id) return;

      move(id, overId);
    },
    [dragId, move]
  );

  const end = useCallback(() => {
    if (!dragId) return;
    setDragId(null);
    const before = startOrder.current;
    const after = orderRef.current;
    if (before.length === after.length && before.every((x, i) => x === after[i])) return;
    onCommit(after);
  }, [dragId, onCommit]);

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: onPointerDown(id),
      onPointerMove: onPointerMove(id),
      onPointerUp: end,
      onPointerCancel: end,
      style: { cursor: disabled ? "default" : dragId === id ? "grabbing" : "grab", touchAction: "none" as const },
    }),
    [onPointerDown, onPointerMove, end, dragId, disabled]
  );

  const itemProps = useCallback(
    (id: string) => ({
      ref: register(id),
      "data-sortable-id": id,
      "data-dragging": dragId === id ? "" : undefined,
    }),
    [register, dragId]
  );

  return { order, dragId, handleProps, itemProps };
}
