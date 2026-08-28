'use client';

import { useEffect, type ReactNode } from 'react';

const pending = new Map<string, Promise<void>>();
const HYDRATED = 'data-hydrated';

function waitForVisible(el: Element, rootMargin: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.setAttribute(HYDRATED, '');
      io?.disconnect();
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) finish();
            },
            { rootMargin },
          )
        : null;
    if (io) io.observe(el);
    else finish();
  });
}

export default function HydrateWhenVisible({
  id,
  children,
  rootMargin = '500px 0px',
  timeoutMs = 8000,
}: {
  id: string;
  children: ReactNode;
  rootMargin?: string;
  timeoutMs?: number;
}) {
  if (typeof document !== 'undefined') {
    const el = document.getElementById(id);
    if (el && !el.hasAttribute(HYDRATED)) {
      let p = pending.get(id);
      if (!p) {
        p = waitForVisible(el, rootMargin, timeoutMs);
        pending.set(id, p);
      }
      throw p;
    }
  }

  return (
    // stamped here too, so a soft-nav mount never suspends
    <div id={id} data-hydrated="">
      {children}
      <Hydrated id={id} />
    </div>
  );
}

function Hydrated({ id }: { id: string }) {
  useEffect(() => {
    pending.delete(id);
  }, [id]);
  return null;
}
