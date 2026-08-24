/* global process */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run `ANALYZE=true bun run build` to emit treemap reports under .next/analyze/.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

// ---------------------------------------------------------------------------
// Security headers (fixes the Lighthouse "Trust & Safety" audits in
// Best Practices: CSP, HSTS, COOP, clickjacking/XFO, Trusted Types).
//
// NOTE on CSP: the pages are statically prerendered (ISR), so a nonce-based
// CSP is not possible without switching every route to dynamic rendering —
// Next's own inline flight-data scripts change per build/page and cannot be
// hashed ahead of time. `'unsafe-inline'` for script-src is therefore the
// static-rendering compromise. Everything else (frame-ancestors, object-src,
// base-uri, form-action) is locked down. See FIXES.md for the optional strict
// nonce-based variant via proxy.ts and its trade-off.
// ---------------------------------------------------------------------------
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next's inline bootstrap scripts on static
  // pages and by the theme snippet in layout.tsx.
  // challenges.cloudflare.com is Turnstile (contact-form captcha): it needs
  // script-src for api.js and frame-src for the widget iframe.
  "script-src 'self' 'unsafe-inline' https://www.clarity.ms https://*.clarity.ms https://va.vercel-scripts.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // images.unsplash.com: all current blog covers live there (dashboard-entered
  // absolute URLs pass through cdnUrl() untouched — any new image host needs
  // an entry here, or re-host the cover on cdn.yatindora.in).
  "img-src 'self' data: blob: https://cdn.yatindora.in https://*.clarity.ms https://images.unsplash.com",
  "font-src 'self'",
  "connect-src 'self' https://*.clarity.ms https://vitals.vercel-insights.com",
  "media-src 'self' https://cdn.yatindora.in",
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'", // primary clickjacking defence (XFO is the fallback)
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Strong HSTS: 2 years, subdomains included. Only keep `preload` if every
  // subdomain (cdn., admin., …) is HTTPS-only — they are today.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: csp },
  // Report-only Trusted Types: enforcing today would break React/Motion DOM
  // sinks. This surfaces violations in DevTools without breaking anything.
  {
    key: "Content-Security-Policy-Report-Only",
    value: "require-trusted-types-for 'script'",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["db", "@repo/ui", "@repo/shared", "@repo/config", "@repo/email"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Files in public/ ship with `max-age=0` by default. The cat sprite +
        // script never change without a rename, so cache them for a year
        // (fixes the "Use efficient cache lifetimes" insight).
        source: "/oneko/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  // Next was inferring the workspace root from a stray lockfile in $HOME.
  // Pin it to the monorepo root so output-file tracing / asset resolution
  // are correct (silences the "inferred workspace root" build warning).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // ~31 days — immutable, fingerprinted CDN assets can be cached long.
    minimumCacheTTL: 2678400,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.yatindora.in" },
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
