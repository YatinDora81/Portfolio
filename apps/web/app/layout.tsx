import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SITE_URL, SITE_NAME } from "./lib/site";
import OnekoCat from "./components/OnekoCat";
import ClarityAnalytics from "./components/ClarityAnalytics";
import UtmTrackerBeacon from "./components/UtmTrackerBeacon";
import VercelAnalytics from "./components/VercelAnalytics";

// Self-hosted, preloaded, font-display: swap. Exposes --font-inter, which
// globals.css maps onto --font-sans.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const DESCRIPTION =
  "Yatin Dora - Software Developer. Building scalable web applications with React, Next.js, Node.js, TypeScript, and Go.";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
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
        {children}
        <OnekoCat />
        <VercelAnalytics />
        <ClarityAnalytics />
        <UtmTrackerBeacon />
      </body>
    </html>
  );
}
