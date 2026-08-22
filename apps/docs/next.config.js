/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["db", "@repo/ui", "@repo/shared", "@repo/config", "@repo/email"],
  experimental: {
    serverActions: {
      // Next buffers an action's body BEFORE the action runs and answers 413 by
      // itself past this limit, so at the 1 MB default `importVault`'s own size
      // check is unreachable and re-importing a vault of a few hundred answered
      // notes fails with a generic error nobody can act on.
      //
      // Deliberately a little above MAX_JSON_BYTES in lib/notes/import.ts, so an
      // oversized paste is refused by that check — with a sentence — rather than
      // by this one. Move the two together, or the sentence disappears again.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
