import { after } from "next/server";
import { prisma } from "db";
import { computeVisitorHash, getDailySalt } from "db/analytics-salt";
import { normalizeHost } from "@repo/shared/attribution";
import { logger } from "@repo/shared/logger";
import { extractGeo, extractIp, isBot, parseDevice } from "@repo/shared/request-facts";
import { isValidSlug, safeDestination } from "@repo/shared/slug";

export const dynamic = "force-dynamic";

// 302, never 301: a cached permanent redirect never reaches this server again, so only the first click counts.
function bounce(target: string, base: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(target, base).toString(),
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const base = request.url;

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) return bounce("/", base);

    const link = await prisma.trackedLink.findUnique({
      where: { slug },
      select: { id: true, destination: true, active: true },
    });
    if (!link || !link.active) return bounce("/", base);

    const destination = safeDestination(link.destination);
    if (!destination) {
      logger.warn("tracked-link", "stored destination failed validation", { slug });
      return bounce("/", base);
    }

    const target = new URL(destination, base);
    // Rung 1 of the attribution ladder — /api/collect reads this as `linkSlug`.
    target.searchParams.set("ref", slug);

    const userAgent = request.headers.get("user-agent") ?? "";
    const prefetching = request.headers.get("sec-purpose")?.includes("prefetch") ?? false;
    // Slack and LinkedIn unfurlers fetch a pasted link at once, which would count as a click.
    if (!isBot(userAgent) && !prefetching) {
      const facts = readFacts(request.headers, userAgent);
      after(() => recordClick(link.id, facts));
    }

    return bounce(target.toString(), base);
  } catch (e) {
    logger.error("tracked-link", "redirect failed", { err: String(e) });
    return bounce("/", base);
  }
}

type ClickFacts = {
  ip: string;
  userAgent: string;
  country: string | null;
  deviceType: string;
  referrerHost: string | null;
};

// Read while the request is still here: `after` runs past the response.
function readFacts(headers: Headers, userAgent: string): ClickFacts {
  const referrerHost = normalizeHost(headers.get("referer"));
  const ownHost = normalizeHost(headers.get("host"));

  return {
    ip: extractIp(headers) ?? "unknown",
    userAgent,
    country: extractGeo(headers).country,
    deviceType: parseDevice(userAgent).deviceType,
    referrerHost: referrerHost && referrerHost !== ownHost ? referrerHost : null,
  };
}

async function recordClick(linkId: string, facts: ClickFacts): Promise<void> {
  try {
    const salt = await getDailySalt();
    const visitorHash = computeVisitorHash(salt, facts.ip, facts.userAgent);

    await prisma.$transaction([
      prisma.linkClick.create({
        data: {
          linkId,
          visitorHash,
          country: facts.country,
          deviceType: facts.deviceType,
          referrerHost: facts.referrerHost,
        },
      }),
      prisma.trackedLink.update({
        where: { id: linkId },
        data: { clickCount: { increment: 1 }, lastClickAt: new Date() },
      }),
    ]);
  } catch (e) {
    // An unhandled throw in `after` takes down the whole invocation.
    logger.error("tracked-link", "click not recorded", { linkId, err: String(e) });
  }
}
