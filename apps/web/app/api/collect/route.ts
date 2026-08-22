import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { EventType, Prisma, prisma } from "db";
import { computeSessionHash, computeVisitorHash, getDailySalt } from "db/analytics-salt";
import { runPeriodicMaintenance } from "db/maintenance";
import { maybePublishDue } from "db/publish-due";
import { checkRateLimit } from "db/rate-limit";
import { catchUpRollups } from "db/rollup";
import { resolveAttribution } from "@repo/shared/attribution";
import { FLAG_KEYS, flagValue } from "@repo/shared/flags";
import { logger } from "@repo/shared/logger";
import { extractGeo, extractIp, isBot, parseDevice } from "@repo/shared/request-facts";
import { blogTags, projectTags, tags } from "@repo/shared/tags";
import { getFlags } from "@/lib/flags";
import { SITE_URL } from "@/lib/site";

const MAX_BODY_BYTES = 8192;
const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 3_600_000;

const eventSchema = z.object({
  type: z.nativeEnum(EventType),
  path: z.string().max(500),
  section: z.string().max(100).optional(),
  label: z.string().max(200).optional(),
  durationMs: z.number().int().min(0).max(300_000).optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(20),
  referrer: z.string().max(500).nullish(),
  utm: z
    .object({
      source: z.string().max(200).nullish(),
      medium: z.string().max(200).nullish(),
      campaign: z.string().max(200).nullish(),
    })
    .nullish(),
  linkSlug: z.string().max(100).nullish(),
  landingPath: z.string().max(500),
});

type Body = z.infer<typeof bodySchema>;

/** Every exit is this. A visitor must never see, or be slowed by, an analytics failure. */
const noContent = () => new Response(null, { status: 204 });

/**
 * Streams with a hard ceiling rather than trusting `content-length`, which is
 * absent on a chunked request — a caller could otherwise hand `JSON.parse` a body
 * of any size on an endpoint that takes no credentials at all.
 */
async function readCapped(request: Request, cap: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > cap) return null;

  const body = request.body;
  if (!body) return request.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function POST(request: Request) {
  try {
    if (!flagValue(await getFlags(), FLAG_KEYS.ANALYTICS)) return noContent();

    const userAgent = request.headers.get("user-agent") ?? "";
    if (isBot(userAgent)) return noContent();
    // A speculative fetch is the browser guessing, not a visit.
    if (request.headers.get("sec-purpose")?.includes("prefetch")) return noContent();

    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw === null) return noContent();

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return noContent();
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return noContent();
    const body = parsed.data;

    const salt = await getDailySalt();
    const visitorHash = computeVisitorHash(salt, extractIp(request.headers) ?? "unknown", userAgent);
    const sessionHash = computeSessionHash(visitorHash);

    // Fails open, which is right: a limiter outage must not blind the analytics.
    const { allowed } = await checkRateLimit(`collect:${visitorHash}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!allowed) return noContent();

    const session = await getOrCreateSession({
      sessionHash,
      visitorHash,
      userAgent,
      headers: request.headers,
      body,
    });
    if (!session) return noContent();

    const pageviews = body.events.filter((e) => e.type === EventType.PAGEVIEW).length;

    await prisma.$transaction([
      prisma.analyticsEvent.createMany({
        data: body.events.map((e) => ({
          sessionId: session.id,
          type: e.type,
          path: e.path,
          section: e.section,
          label: e.label,
          durationMs: e.durationMs,
        })),
      }),
      prisma.analyticsSession.update({
        where: { id: session.id },
        data: {
          lastSeenAt: new Date(),
          ...(pageviews > 0 ? { pageviews: { increment: pageviews } } : {}),
        },
      }),
    ]);

    // Public traffic is the scheduler: the rollup runs here, not only when an admin
    // opens the dashboard. Retention refuses to prune days nothing has summarised, so
    // a site with traffic and no admin visits would otherwise grow without bound.
    // Both calls are idempotent, self-limiting and locked, so concurrent beacons
    // cost one extra read each rather than duplicated work.
    after(async () => {
      try {
        const published = await maybePublishDue();
        for (const item of published) {
          const itemTags =
            item.type === "Blog"
              ? item.slug
                ? blogTags(item.slug)
                : [tags.blogIndex()]
              : projectTags(item.id);
          for (const tag of itemTags) revalidateTag(tag, "max");
        }
        if (published.length > 0) {
          logger.info("collect", "published scheduled content", {
            count: published.length,
            items: published.map((p) => `${p.type}:${p.id}`),
          });
        }
        // Before maintenance, so retention sees the floor this pass just moved.
        await catchUpRollups();
        await runPeriodicMaintenance();
      } catch (e) {
        // An unhandled throw in `after` takes down the whole invocation.
        logger.error("collect", "post-response work failed", { err: String(e) });
      }
    });

    return noContent();
  } catch (e) {
    logger.error("collect", "collection failed", { err: String(e) });
    return noContent();
  }
}

type SessionInput = {
  sessionHash: string;
  visitorHash: string;
  userAgent: string;
  headers: Headers;
  body: Body;
};

/**
 * 🚨 Attribution is written here, on creation, and nowhere else. Re-resolving it
 * on an existing session would rewrite every visitor's source to whichever
 * internal page they clicked next, and every campaign would read as direct.
 */
async function getOrCreateSession(input: SessionInput): Promise<{ id: string } | null> {
  const { sessionHash, visitorHash, userAgent, headers, body } = input;

  const existing = await prisma.analyticsSession.findUnique({
    where: { sessionHash },
    select: { id: true },
  });
  if (existing) return existing;

  const attribution = resolveAttribution({
    linkSlug: body.linkSlug,
    utmSource: body.utm?.source,
    utmMedium: body.utm?.medium,
    utmCampaign: body.utm?.campaign,
    referrer: body.referrer,
    userAgent,
    // 🚨 `secFetchSite` is deliberately not passed. This is a beacon, not the
    // navigation: `sec-fetch-site` on *this* request always reads "same-origin",
    // which would mark every visit an internal nav and collapse `unknown-shared`
    // into `direct`. Absent, the resolver falls through to the landing-path rung.
    landingPath: body.landingPath,
    ownHost: headers.get("host") ?? SITE_URL,
  });
  const geo = extractGeo(headers);
  const device = parseDevice(userAgent);

  try {
    return await prisma.analyticsSession.create({
      data: {
        sessionHash,
        visitorHash,
        channel: attribution.channel,
        rawSource: attribution.rawSource,
        rawMedium: attribution.rawMedium,
        rawCampaign: attribution.rawCampaign,
        referrerHost: attribution.referrerHost,
        landingPath: body.landingPath,
        linkSlug: body.linkSlug ?? null,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        deviceType: device.deviceType,
        browser: device.browser,
        os: device.os,
      },
      select: { id: true },
    });
  } catch (e) {
    // Two events of the same visit landing at once: the loser reads the winner's row.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.analyticsSession.findUnique({
        where: { sessionHash },
        select: { id: true },
      });
    }
    throw e;
  }
}
