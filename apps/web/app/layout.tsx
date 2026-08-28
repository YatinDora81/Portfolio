import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL, SITE_NAME } from "./lib/site";
import { getSiteConfig } from "./lib/data";
import { getFlags } from "./lib/flags";
import { FLAG_KEYS, flagValue } from "@repo/shared/flags";
import { BackgroundProvider } from "./components/common/BackgroundProvider";
import AnalyticsTracker from "./components/common/AnalyticsTracker";
import OnekoCat from "./components/OnekoCat";
import ClarityAnalytics from "./components/ClarityAnalytics";
import UtmTrackerBeacon from "./components/UtmTrackerBeacon";
import VercelAnalytics from "./components/VercelAnalytics";

// Self-hosted, preloaded, font-display: swap. Exposes --font-inter, which
// globals.css maps onto --font-sans.
//
// `axes: ['opsz']` is not decorative: next/font ships only the wght axis unless
// asked, so every `font-variation-settings: 'opsz' N` in the display type —
// the thought quote, the channel title, the carrier address — was being parsed
// and then silently dropped against a font with no such axis.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  axes: ["opsz"],
});

// Terminal/metadata voice used by `.mono` (availability chip, role line, tenure
// pills, project hints, the cat-wire divider). Exposes --font-jetbrains-mono,
// which globals.css maps onto the --font-mono theme token.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const DESCRIPTION =
  "Yatin Dora - Software Developer. Building scalable web applications with React, Next.js, TypeScript, Python, Go, and AI/LLM integrations.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The cat rides in the layout, so its nap settings have to be read here too.
  // `getSiteConfig` is memoised per request, so the home page reading it again
  // for everything else costs nothing.
  const [{ catNapStyle, catNapSeconds, background }, flags] = await Promise.all([
    getSiteConfig(),
    getFlags(),
  ]);
  const analytics = flagValue(flags, FLAG_KEYS.ANALYTICS);
  const easterEggs = flagValue(flags, FLAG_KEYS.EASTER_EGGS);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Warm up the asset CDN connection ahead of the first image request. */}
        <link rel="preconnect" href="https://cdn.yatindora.in" crossOrigin="anonymous" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              var theme = localStorage.getItem('theme');
              if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              }
              document.documentElement.classList.add(theme);
            })();`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `html.dark { background-color: #0a0a0a; } html:not(.dark) { background-color: #ffffff; }`,
          }}
        />
      </head>
      <body>
        {/* The background config is handed down from here rather than read per
            page because error.tsx is a client error boundary — it cannot await
            the database, and a boundary that fell back to the wrong layer would
            change the page's whole ground at the exact moment something broke.
            The layout is the one place above it that can still read a row. */}
        <BackgroundProvider value={background}>{children}</BackgroundProvider>
        {easterEggs && <OnekoCat napStyle={catNapStyle} napSeconds={catNapSeconds} />}
        {analytics && <AnalyticsTracker />}
        {analytics && <VercelAnalytics />}
        {analytics && <ClarityAnalytics />}
        {analytics && <UtmTrackerBeacon />}
      </body>
    </html>
  );
}
