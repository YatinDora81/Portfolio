'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import Background from '@/components/common/Background';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ThemeProvider>
      <MotionProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Background />

          <style>{`
            .er-cat{width:96px;height:96px;background:url('/oneko/oneko.gif') no-repeat -672px -288px;background-size:768px 384px;image-rendering:pixelated}
            @media (prefers-reduced-motion: no-preference){
              .er-cat{animation:er-pop .45s cubic-bezier(.2,1.6,.4,1) both}
            }
            @keyframes er-pop{0%{transform:translateY(6px) scale(.6);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}
          `}</style>

          <main className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-5">
            <div className="max-w-md text-center">
              <div className="relative mx-auto w-fit select-none" aria-hidden="true">
                <span className="er-cat block" />
              </div>
              <div className="mx-auto mt-1 h-px w-56 bg-border" aria-hidden="true" />

              <p className="mt-4 font-mono text-xs text-secondary">
                caught <span aria-hidden="true">→</span>{' '}
                <span className="text-[var(--err)]">runtime_error</span>
                {error.digest ? (
                  <> · digest: <span className="text-foreground/80">{error.digest}</span></>
                ) : null}
              </p>

              <h1 className="mt-3 text-xl font-semibold sm:text-2xl">
                Something broke mid-pounce.
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                An unexpected error crashed this view. It has been logged —
                trying again usually lands it.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-foreground/30 px-5 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground/60"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  Try again
                </button>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2 text-sm font-medium text-secondary transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Back home
                </Link>
              </div>
            </div>
          </main>
        </div>
      </MotionProvider>
    </ThemeProvider>
  );
}
