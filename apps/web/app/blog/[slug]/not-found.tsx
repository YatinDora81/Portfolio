import Link from 'next/link';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import BackgroundLines from '@/components/common/BackgroundLines';
import { getFlags } from '@/lib/flags';
import { getBlogs } from '@/lib/data';
import { FLAG_KEYS, flagValue } from '@repo/shared/flags';

export default async function BlogNotFound() {
  // Async so this can read the flags: a not-found page takes no props, so there
  // is no page above it to pass them down. Same cached lookups the post uses.
  //
  // Both halves of the homepage's own condition have to be repeated here, not
  // just the flag: `page.tsx` renders the section on
  // `flag && blogs.length > 0`, so with every post unpublished — which is the
  // live state today — `#blogs` does not exist even with the flag on. Checking
  // the flag alone would point the one page whose entire job is recovery at a
  // fragment that isn't there.
  const [flags, blogs] = await Promise.all([getFlags(), getBlogs()]);
  const showBlogs = flagValue(flags, FLAG_KEYS.SECTION_BLOGS) && blogs.length > 0;

  return (
    <ThemeProvider>
      <MotionProvider>
      <div className="min-h-screen bg-background text-foreground">
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50" />

        <div className="relative z-[2] flex flex-col items-center justify-center min-h-screen px-5">
          <div className="text-center max-w-md">
            <div className="text-7xl sm:text-8xl font-bold text-border select-none">404</div>
            <h1 className="mt-4 text-xl sm:text-2xl font-semibold">
              Blog not found
            </h1>
            <p className="mt-2 text-sm text-secondary leading-relaxed">
              This blog post doesn&apos;t exist or has been taken down.
            </p>
            <Link
              href={showBlogs ? '/#blogs' : '/'}
              className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2 text-sm font-medium text-secondary hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              {showBlogs ? 'Back to blogs' : 'Back home'}
            </Link>
          </div>
        </div>
      </div>
      </MotionProvider>
    </ThemeProvider>
  );
}
