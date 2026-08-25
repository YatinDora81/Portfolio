'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * Defers React hydration of a server-rendered subtree until it is near the
 * viewport.
 *
 * The markup is in the HTML either way — this changes nothing about what a
 * visitor (or a crawler) sees. What changes is when React does the work of
 * walking that markup, attaching handlers and running effects. On a phone,
 * roughly 70% of this page's DOM is below the fold at load, and hydrating all
 * of it was the largest remaining block of main-thread time in the trace.
 *
 * How: during the hydration render on the client, if the section's SSR'd node
 * is not within `rootMargin` of the viewport, this throws a promise. React
 * treats that exactly like a lazy() component that has not loaded — it leaves
 * the boundary's server HTML in place, dehydrated, and retries when the
 * promise resolves. An IntersectionObserver on that node resolves it. Must be
 * wrapped in <Suspense>; the caller does that.
 *
 * Safety rails:
 *  - Only ever suspends when an un-hydrated SSR node with this id exists in
 *    the document, i.e. during initial hydration. Client-side navigations
 *    render fresh (no node yet) and pass straight through.
 *  - A hard timeout hydrates regardless, so nothing can stay inert if an
 *    observer never fires (a section hidden by CSS, a browser without IO).
 *  - Under a dehydrated boundary the buttons are still real DOM; tabbing or
 *    scrolling to them brings them into view, which is what triggers
 *    hydration, so the section is live by the time it can be used.
 */

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
  /** Unique across the page — it becomes the wrapper's DOM id. */
  id: string;
  children: ReactNode;
  /** How far outside the viewport counts as "near". Generous by default, so a
      section is live before a scrolling visitor arrives at it. */
  rootMargin?: string;
  /** Hydrate no matter what after this long. */
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
    // Stamped in the JSX too, not only by waitForVisible: a fresh client-side
    // mount (soft navigation back to the page) commits an already-stamped div,
    // so a later re-render can never mistake its own live output for
    // un-hydrated SSR markup and suspend an update — which would swap in the
    // null fallback and hide the section until the timeout.
    <div id={id} data-hydrated="">
      {children}
      <Hydrated id={id} />
    </div>
  );
}

/** Bookkeeping only: once this subtree has committed, the pending promise is
    no longer needed. */
function Hydrated({ id }: { id: string }) {
  useEffect(() => {
    pending.delete(id);
  }, [id]);
  return null;
}
