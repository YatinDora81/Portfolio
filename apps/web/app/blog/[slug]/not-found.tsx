import Link from 'next/link';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import Background from '@/components/common/Background';
import { getFlags } from '@/lib/flags';
import { getBlogs } from '@/lib/data';
import { FLAG_KEYS, flagValue } from '@repo/shared/flags';

export default async function BlogNotFound() {
  const [flags, blogs] = await Promise.all([getFlags(), getBlogs()]);
  const showBlogs = flagValue(flags, FLAG_KEYS.SECTION_BLOGS) && blogs.length > 0;

  return (
    <ThemeProvider>
      <MotionProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Background />

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
