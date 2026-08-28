import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import Background from '@/components/common/Background';

/** Without this file an unknown path falls back to Next's built-in 404, which
    renders its own <title> INSIDE the root layout — two <title> elements in one
    <head>. The blog's own not-found has always avoided that by owning the page;
    this is the same thing for the root.

    Design: the sleeping oneko sprite takes the missing page's place — it is the
    zero in "4 0 4", napping on a desk keyline the way the live cat naps in
    window corners. Frame coords come from oneko.js (`sleeping: [[-2,0],[-2,-1]]`,
    32px grid, shown here at 3x = 96px). Everything else follows 404 UX basics:
    say plainly what happened, keep the site's voice, and give escape routes
    (home + the three sections people actually come for). */
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

          {/* Scoped styles: the sprite crop and the two-frame sleep loop — the
              sheet's sleeping frames animate their own pixel "z"s, so nothing
              is layered on top. `step-end` holds each frame; background-position
              is interpolable, so a default timing function would smear the
              sheet. Reduced motion gets the static sleeping frame. */}
          <style>{`
            .nf-cat{width:96px;height:96px;background:url('/oneko/oneko.gif') no-repeat -192px 0;background-size:768px 384px;image-rendering:pixelated}
            @media (prefers-reduced-motion: no-preference){
              .nf-cat{animation:nf-sleep 1.8s step-end infinite}
            }
            @keyframes nf-sleep{0%{background-position:-192px 0}50%{background-position:-192px -96px}100%{background-position:-192px 0}}
          `}</style>

          <main className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-5">
            <div className="max-w-md text-center">
              {/* The cat is the zero. Digits stay in the keyline ink so the
                  sprite is the only thing with weight. */}
              <div className="flex items-end justify-center gap-1 select-none" aria-hidden="true">
                <span className="text-8xl font-bold leading-none text-border">4</span>
                <span className="relative -mb-1.5">
                  <span className="nf-cat block" />
                </span>
                <span className="text-8xl font-bold leading-none text-border">4</span>
              </div>
              <div className="mx-auto mt-1 h-px w-56 bg-border" aria-hidden="true" />

              {/* Receipt line, in the site's mono register. The path is filled
                  in client-side (textContent only) so the page stays static.
                  suppressHydrationWarning is load-bearing: the script below
                  rewrites this text during parse, before hydration, and the
                  span hydrates inside the providers' client boundary — without
                  it React 19 treats the changed text as a mismatch, re-renders
                  the page client-side, and reverts it to "this page". */}
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
