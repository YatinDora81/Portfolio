export type DeviceType = "mobile" | "tablet" | "desktop";

export type Geo = {
  country: string | null;
  region: string | null;
  city: string | null;
};

export type Device = {
  deviceType: DeviceType;
  browser: string | null;
  os: string | null;
};

/** Platform-written headers only: no Cloudflare proxy here, so an inbound `cf-connecting-ip` is spoofable. */
export function extractIp(h: Headers): string | null {
  const direct = h.get("x-real-ip")?.trim();
  if (direct) return direct;
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

const COUNTRY_RE = /^[A-Za-z]{2}$/;
const REGION_RE = /^[A-Za-z0-9]{1,8}$/;

/** Same rule as the IP: `x-vercel-ip-*` only, never an inbound `cf-*`. */
export function extractGeo(h: Headers): Geo {
  const country = h.get("x-vercel-ip-country")?.trim() ?? "";
  const region = h.get("x-vercel-ip-country-region")?.trim() ?? "";

  return {
    country: COUNTRY_RE.test(country) ? country.toUpperCase() : null,
    region: REGION_RE.test(region) ? region.toUpperCase() : null,
    city: decodeCity(h.get("x-vercel-ip-city")),
  };
}

function decodeCity(raw: string | null): string | null {
  if (!raw) return null;
  try {
    // Vercel percent-encodes the city, and a malformed sequence throws rather than returning "".
    return decodeURIComponent(raw).trim().slice(0, 120) || null;
  } catch {
    return null;
  }
}

const TABLET_RE = /ipad|tablet|kindle|silk|playbook|android(?!.*mobi)/;
const MOBILE_RE = /mobi|iphone|ipod|blackberry|windows phone|opera mini/;

/** Families only, never versions: a full user-agent is close to a fingerprint. */
// Families only, no versions. The raw string is read here and stored nowhere.
export function parseDevice(ua: string): Device {
  const s = ua.toLowerCase();

  const deviceType: DeviceType = TABLET_RE.test(s)
    ? "tablet"
    : MOBILE_RE.test(s)
      ? "mobile"
      : "desktop";

  return { deviceType, browser: browserOf(s), os: osOf(s) };
}

// Order is the trick: every Chromium user-agent also says "Safari", and Edge says both.
function browserOf(s: string): string | null {
  if (!s) return null;
  if (/edg(?:e|a|ios)?\//.test(s)) return "Edge";
  if (/opr\/|opera/.test(s)) return "Opera";
  if (/samsungbrowser/.test(s)) return "Samsung Internet";
  if (/firefox|fxios/.test(s)) return "Firefox";
  if (/chrome|crios|chromium/.test(s)) return "Chrome";
  if (/safari/.test(s)) return "Safari";
  return null;
}

// Android before Linux, Chrome OS before both: those user-agents name every layer.
function osOf(s: string): string | null {
  if (!s) return null;
  if (/iphone|ipad|ipod/.test(s)) return "iOS";
  if (/android/.test(s)) return "Android";
  if (/cros/.test(s)) return "Chrome OS";
  if (/windows/.test(s)) return "Windows";
  if (/mac os x|macintosh/.test(s)) return "macOS";
  if (/linux|x11/.test(s)) return "Linux";
  return null;
}

// `bot` is bounded on both sides and past a literal "cu" (CUBOT ships handsets); in-app browsers stay out, attribution needs them.
const BOT_RE = new RegExp(
  [
    "(?<!cu)bot(?![a-z0-9_])",
    "spider|crawler|crawling|scraper|archiver|slurp|feedfetcher",
    "facebookexternalhit|whatsapp|skypeuripreview|embedly|quora link preview|nuzzel|vkshare",
    "bingpreview",
    "headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix",
    "curl/|wget|python-requests|python-urllib|libwww-perl|go-http-client|okhttp",
    "axios|node-fetch|java/|httpclient|httpurlconnection|postman|insomnia",
    "ahrefs|semrush|mj12|dataprovider|baiduspider|sogou|exabot|ia_archiver",
    "claude-web|anthropic-ai|perplexity|bytespider|google-inspectiontool|googleother",
    "uptime|pingdom|statuscake|checkly|site24x7|newrelic|datadog|monitoring|validator",
  ].join("|"),
  "i",
);

/** An absent user-agent is a script, not a browser. */
export function isBot(ua: string): boolean {
  const s = ua.trim();
  if (!s) return true;
  return BOT_RE.test(s);
}
