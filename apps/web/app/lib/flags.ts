import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { defaultFlagMap, type FlagMap } from "@repo/shared/flags";
import { tags } from "@repo/shared/tags";

const CACHE_LIFETIME_SECONDS = 86400;

const readFlags = unstable_cache(
  async (): Promise<FlagMap> => {
    try {
      const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
      return { ...defaultFlagMap(), ...Object.fromEntries(rows.map((r) => [r.key, r.enabled])) };
    } catch (error) {
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

export const getFlags = cache(readFlags);
