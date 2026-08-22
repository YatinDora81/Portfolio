export default function PreviewBanner({ status }: { status: string }) {
  return (
    <>
      {/* Reserves the fixed bar's height so it cannot sit on top of the footer. */}
      <div aria-hidden="true" className="h-10 print:hidden" />

      <aside
        aria-label="Preview mode"
        className="mono fixed inset-x-0 bottom-0 z-50 bg-foreground text-background print:hidden"
      >
        <div className="mx-auto flex h-10 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <p className="flex min-w-0 items-center gap-2 text-[0.7rem] tracking-[0.14em] uppercase">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-[3px] shrink-0 animate-pulse bg-current motion-reduce:animate-none"
            />
            <span className="truncate">
              Preview
              <span aria-hidden="true" className="px-2 opacity-40">
                &mdash;
              </span>
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
