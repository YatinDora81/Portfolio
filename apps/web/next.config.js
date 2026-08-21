/* global process */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run `ANALYZE=true bun run build` to emit treemap reports under .next/analyze/.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["db", "@repo/ui", "@repo/shared", "@repo/config"],
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
