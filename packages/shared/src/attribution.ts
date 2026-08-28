export const CHANNELS = [
  "linkedin",
  "github",
  "x",
  "leetcode",
  "resume",
  "email",
  "search",
  "direct",
  "unknown-referred",
  "unknown-shared",
  "other",
] as const;

export type Channel = (typeof CHANNELS)[number];

const HOST_CHANNELS: Record<string, Channel> = {
  "linkedin.com": "linkedin",
  "m.linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "github.com": "github",
  "gist.github.com": "github",
  "x.com": "x",
  "twitter.com": "x",
  "mobile.twitter.com": "x",
  "t.co": "x",
  "leetcode.com": "leetcode",
  "mail.google.com": "email",
  "mail.yahoo.com": "email",
  "mail.proton.me": "email",
  "outlook.live.com": "email",
  "outlook.office.com": "email",
  "outlook.office365.com": "email",
  "bing.com": "search",
  "duckduckgo.com": "search",
  "search.brave.com": "search",
  "search.yahoo.com": "search",
  "ecosia.org": "search",
  "startpage.com": "search",
  "baidu.com": "search",
  "yandex.com": "search",
  "chatgpt.com": "search",
  "chat.openai.com": "search",
  "perplexity.ai": "search",
  "claude.ai": "search",
};

const SOURCE_CHANNELS: Record<string, Channel> = {
  linkedin: "linkedin",
  li: "linkedin",
  github: "github",
  gh: "github",
  x: "x",
  twitter: "x",
  leetcode: "leetcode",
  resume: "resume",
  cv: "resume",
  email: "email",
  newsletter: "email",
  mail: "email",
  gmail: "email",
  google: "search",
  bing: "search",
  duckduckgo: "search",
  search: "search",
  direct: "direct",
};

const MEDIUM_CHANNELS: Record<string, Channel> = {
  email: "email",
  newsletter: "email",
  organic: "search",
  cpc: "search",
  ppc: "search",
};

export type AttributionInput = {
  linkSlug?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  secFetchSite?: string | null;
  landingPath?: string | null;
  ownHost?: string | null;
};

export type Attribution = {
  channel: Channel;
  referrerHost: string | null;
  rawSource: string | null;
  rawMedium: string | null;
  rawCampaign: string | null;
};

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function normalizeHost(referrer: string | null | undefined): string | null {
  const raw = referrer?.trim();
  if (!raw) return null;

  const host = hostOf(raw) ?? hostOf(`https://${raw}`);
  if (!host) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

function channelForHost(host: string | null): Channel | null {
  if (!host) return null;

  const labels = host.split(".");
  for (let i = 0; i + 1 < labels.length; i++) {
    const candidate = labels.slice(i).join(".");
    const mapped = HOST_CHANNELS[candidate];
    if (mapped) return mapped;
    if (candidate.startsWith("google.")) return "search";
  }
  return null;
}

function inAppChannel(userAgent: string | null | undefined): Channel | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  if (/linkedinapp/i.test(ua)) return "linkedin";
  if (/twitter/i.test(ua)) return "x";
  if (/instagram|fbav|fban|fb_iab/i.test(ua)) return "other";
  return null;
}

function isDeepPath(landingPath: string | null | undefined): boolean {
  const path = (landingPath ?? "").split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
  return path.length > 0;
}

function bounded(value: string | null | undefined): string | null {
  const trimmed = value?.trim().slice(0, 200);
  return trimmed || null;
}

/** First match wins. */
export function resolveAttribution(input: AttributionInput): Attribution {
  const raw = {
    rawSource: bounded(input.utmSource),
    rawMedium: bounded(input.utmMedium),
    rawCampaign: bounded(input.utmCampaign),
  };

  const host = normalizeHost(input.referrer);
  const ownHost = normalizeHost(input.ownHost);
  const selfReferred = host !== null && host === ownHost;
  const referrerHost = selfReferred ? null : host;
  const decided = (channel: Channel): Attribution => ({ channel, referrerHost, ...raw });

  if (input.linkSlug?.trim()) return decided("resume");

  const source = raw.rawSource?.toLowerCase();
  if (source) {
    return decided(SOURCE_CHANNELS[source] ?? channelForHost(normalizeHost(source)) ?? "other");
  }

  const medium = raw.rawMedium?.toLowerCase();
  const mediumChannel = medium ? MEDIUM_CHANNELS[medium] : undefined;
  if (mediumChannel) return decided(mediumChannel);

  if (referrerHost) return decided(channelForHost(referrerHost) ?? "other");

  const inApp = inAppChannel(input.userAgent);
  if (inApp) return decided(inApp);

  const site = input.secFetchSite?.trim().toLowerCase();
  // cross-site with no referrer means it was stripped, not absent
  if (site === "cross-site") return decided("unknown-referred");

  const internalNav = selfReferred || site === "same-origin" || site === "same-site";
  if (!internalNav && isDeepPath(input.landingPath)) return decided("unknown-shared");

  return decided("direct");
}
