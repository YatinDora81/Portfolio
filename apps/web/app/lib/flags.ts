import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { defaultFlagMap, type FlagMap } from "@repo/shared/flags";
import { tags } from "@repo/shared/tags";

// Next takes the minimum cache lifetime across a render, so anything shorter here shortens the whole route's ISR window.
const CACHE_LIFETIME_SECONDS = 86400;

const readFlags = unstable_cache(
  async (): Promise<FlagMap> => {
    try {
      const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
      return { ...defaultFlagMap(), ...Object.fromEntries(rows.map((r) => [r.key, r.enabled])) };
    } catch (error) {
      // Fail open — defaults are all-on, so a database blip cannot blank the site.
      console.error("[flags] read failed — falling back to registry defaults", error);
      return defaultFlagMap();
    }
  },
  ["feature-flags"],
  {
    tags: [tags.flags()],
    revalidate: CACHE_LIFETIME_SECONDS,
  },
);

// `cache` dedupes within a render; `unstable_cache` persists across requests and is what `revalidateTag` can reach.
export const getFlags = cache(readFlags);
