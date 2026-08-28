import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import Background from '@/components/common/Background';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Background />

          <style>{`
            .nf-cat{width:96px;height:96px;background:url('/oneko/oneko.gif') no-repeat -192px 0;background-size:768px 384px;image-rendering:pixelated}
            @media (prefers-reduced-motion: no-preference){
              .nf-cat{animation:nf-sleep 1.8s step-end infinite}
            }
            @keyframes nf-sleep{0%{background-position:-192px 0}50%{background-position:-192px -96px}100%{background-position:-192px 0}}
          `}</style>

          <main className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-5">
            <div className="max-w-md text-center">
              <div className="flex items-end justify-center gap-1 select-none" aria-hidden="true">
                <span className="text-8xl font-bold leading-none text-border">4</span>
                <span className="relative -mb-1.5">
                  <span className="nf-cat block" />
                </span>
                <span className="text-8xl font-bold leading-none text-border">4</span>
              </div>
              <div className="mx-auto mt-1 h-px w-56 bg-border" aria-hidden="true" />

              <p className="mt-4 font-mono text-xs text-secondary">
                GET <span id="nf-path" suppressHydrationWarning className="text-foreground/80">this page</span>{' '}
                <span aria-hidden="true">→</span> <span className="text-[var(--err)]">404</span> not_found
              </p>

              <h1 className="mt-3 text-xl font-semibold sm:text-2xl">
                This page wandered off.
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                Whatever lived at this address was moved, renamed, or never
                existed. The only witness is asleep.
              </p>

              <div className="mt-6 flex flex-col items-center gap-4">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2 text-sm font-medium text-secondary transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Back home
                </Link>
                <nav aria-label="Site sections" className="font-mono text-xs text-secondary">
                  <Link href="/#projects" className="transition-colors hover:text-foreground">projects</Link>
                  <span aria-hidden="true" className="mx-2 text-border">·</span>
                  <Link href="/#blogs" className="transition-colors hover:text-foreground">blogs</Link>
                  <span aria-hidden="true" className="mx-2 text-border">·</span>
                  <Link href="/#contact" className="transition-colors hover:text-foreground">contact</Link>
                </nav>
              </div>
            </div>
          </main>

          <script
            dangerouslySetInnerHTML={{
              __html:
                "try{var p=location.pathname;if(p.length>40)p=p.slice(0,39)+'\\u2026';var e=document.getElementById('nf-path');if(e)e.textContent=p;}catch(_){}",
            }}
          />
        </div>
      </MotionProvider>
    </ThemeProvider>
  );
}
