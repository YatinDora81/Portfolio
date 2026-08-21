import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { defaultFlagMap, type FlagMap } from "@repo/shared/flags";
import { tags } from "@repo/shared/tags";

/**
 * Matches the 24h `export const revalidate` the public routes already carry.
 * Next takes the minimum across a render, so anything shorter here would
 * become the whole route's ISR window.
 */
const CACHE_LIFETIME_SECONDS = 86400;

/**
 * The one database read of the flag table, for the whole site.
 *
 * Read it ONCE per render and thread the answers down as props. A section
 * component that reads flags itself turns one lookup into N, and — worse —
 * drags the flag dependency into every subtree that only needed a boolean.
 *
 * Two things about the cache, so the next reader does not have to re-derive
 * them:
 *
 * 1. The `revalidate` here is a backstop, not the mechanism. Flipping a flag in
 *    the admin flushes `tags.flags()`, and the request AFTER the one that
 *    triggered the flush sees it — `revalidateTag(tag, "max")` is
 *    stale-while-revalidate, so the flushing request is still served the old
 *    entry while the re-read happens behind it. Measured, not assumed. The
 *    window only bounds how long a flush that never arrived — a failed POST, a
 *    deploy that rotated the secret — can keep the site wrong.
 *
 *    It matches the 24h the routes already carry, and that is not cosmetic:
 *    Next takes the MINIMUM lifetime across every cache read in a render, so a
 *    shorter one here silently becomes the ISR window for the whole homepage.
 *    An hour was measured doing exactly that — `/` dropped from `1d` to `1h` in
 *    the route table — which would have re-rendered the page, and re-run its
 *    ~10 queries and the GitHub poll, 24 times a day to no purpose.
 *
 * 2. The `unstable_cache` Date hazard that `data.ts` has to work around does
 *    NOT apply here. That hazard exists because the cache stores
 *    `JSON.stringify(...)` and returns `JSON.parse(...)`, so a `Date` comes
 *    back an ISO string on a hit while the type still claims `Date`. A
 *    `FlagMap` is `Record<string, boolean>` — it survives that round trip
 *    unchanged, so there is nothing to revive.
 */
const readFlags = unstable_cache(
  async (): Promise<FlagMap> => {
    try {
      const rows = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
      // Registry defaults first, rows second: a key the seed has not written
      // yet — a flag added to the registry ahead of its migration — still
      // resolves to its declared default instead of vanishing into `undefined`.
      return { ...defaultFlagMap(), ...Object.fromEntries(rows.map((r) => [r.key, r.enabled])) };
    } catch (error) {
      // Fail OPEN, and loudly. One database blip must never blank the
      // portfolio: treating "I could not read the flags" as "everything is
      // off" would turn a few seconds of Neon being unreachable into an empty
      // page. Defaults are all-on, so the worst case is that a section someone
      // deliberately hid stays up until the next successful read.
      //
      // That fallback is what gets cached, for up to the 24 hours above — but any
      // admin write to a flag flushes `tags.flags()`, so the person who cares
      // most about a hidden section staying hidden is also the one whose next
      // action fixes it.
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

/**
 * `cache()` over the top, the same pairing `getSiteConfig` uses in data.ts and
 * for the same reason: the root layout gates the analytics and cat mounts while
 * the page gates the sections, so one render of `/` asks twice. Without the memo
 * a cold cache turns that into two `featureFlag.findMany` queries racing each
 * other. They solve different problems — this one dedupes within a request, the
 * one it wraps persists across them.
 */
export const getFlags = cache(readFlags);
