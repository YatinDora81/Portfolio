/**
 * The bar that says "what you are reading is not live".
 *
 * Bottom of the viewport, not the top. The navbar is `fixed top-0 z-40` and
 * shrinks as you scroll (see resizable-navbar.tsx) — anything pinned above it
 * would either cover the logo or fight that animation for the same 64px. The
 * bottom edge is empty, so the bar can be fixed there without a layout
 * negotiation, and it still ends up in the reader's eye on every page.
 *
 * Inverted rather than tinted, which is the same move the terminal blocks and
 * the text selection make elsewhere on this site: foreground on background,
 * swapped. It reads as system chrome instead of as content, in either theme,
 * without inventing a warning colour the palette does not have.
 *
 * Server component on purpose — it holds no state and the exit is a real
 * navigation to a route handler, which is what has to happen for the cookie to
 * be cleared.
 */
export default function PreviewBanner({ status }: { status: string }) {
  return (
    <>
      {/* Fixed elements are out of flow, so the last line of the footer would
          sit underneath the bar. This reserves the bar's exact height at the
          end of the document instead of asking the layout to add padding. */}
      <div aria-hidden="true" className="h-10 print:hidden" />

      <aside
        aria-label="Preview mode"
        className="mono fixed inset-x-0 bottom-0 z-50 bg-foreground text-background print:hidden"
      >
        <div className="mx-auto flex h-10 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <p className="flex min-w-0 items-center gap-2 text-[0.7rem] tracking-[0.14em] uppercase">
            {/* A terminal caret. Decorative, so it is hidden from assistive tech
                and it stops moving for anyone who asked motion to stop. */}
            <span
              aria-hidden="true"
              className="inline-block h-3 w-[3px] shrink-0 animate-pulse bg-current motion-reduce:animate-none"
            />
            <span className="truncate">
              Preview
              <span aria-hidden="true" className="px-2 opacity-40">
                &mdash;
              </span>
              {/* The status word is the whole point of the bar: DRAFT and
                  SCHEDULED are the reason someone is looking at this page
                  through a preview link rather than at the real URL. */}
              <span className="opacity-80">{status}</span>
            </span>
          </p>

          <a
            href="/api/preview/exit"
            className="shrink-0 rounded-sm text-[0.7rem] tracking-[0.14em] uppercase underline decoration-dotted underline-offset-4 transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
          >
            Exit preview
          </a>
        </div>
      </aside>
    </>
  );
}
