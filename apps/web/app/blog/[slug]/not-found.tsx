import Link from 'next/link';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import BackgroundLines from '@/components/common/BackgroundLines';

export default function BlogNotFound() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50 backdrop-blur-[1px]" />

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
              href="/#blogs"
              className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2 text-sm font-medium text-secondary hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to blogs
            </Link>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
