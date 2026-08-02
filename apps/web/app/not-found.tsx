import Link from 'next/link';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import BackgroundLines from '@/components/common/BackgroundLines';

/** Without this file an unknown path falls back to Next's built-in 404, which
    renders its own <title> INSIDE the root layout — two <title> elements in one
    <head>. The blog's own not-found has always avoided that by owning the page;
    this is the same thing for the root. */
export default function NotFound() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <div className="min-h-screen bg-background text-foreground">
          <BackgroundLines />
          <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50" />

          <div className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-5">
            <div className="max-w-md text-center">
              <div className="select-none text-7xl font-bold text-border sm:text-8xl">404</div>
              <h1 className="mt-4 text-xl font-semibold sm:text-2xl">Page not found</h1>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                That page doesn&apos;t exist. It may have moved, or the link that
                brought you here may be out of date.
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2 text-sm font-medium text-secondary transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                Back home
              </Link>
            </div>
          </div>
        </div>
      </MotionProvider>
    </ThemeProvider>
  );
}
