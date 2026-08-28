/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["db", "@repo/ui", "@repo/shared", "@repo/storage", "@repo/config", "@repo/email"],
  experimental: {
    serverActions: {
      // a little above MAX_JSON_BYTES in lib/notes/import.ts
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
