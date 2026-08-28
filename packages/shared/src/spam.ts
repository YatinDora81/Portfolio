export const SPAM_THRESHOLD = 60;
export const MIN_ELAPSED_MS = 3_000;

export const UNMEASURED_POINTS = 30;
export const MAX_SUBMISSIONS_PER_HOUR = 3;

export const HONEYPOT_FIELD = "company_website";
export const FORM_TOKEN_FIELD = "form_token";

const MAX_URLS = 2;
const MIN_BODY_LENGTH = 10;

const DISPOSABLE_DOMAINS = new Set([
  "0-mail.com",
  "10minutemail.com",
  "20minutemail.com",
  "33mail.com",
  "asdasd.nl",
  "burnermail.io",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamailblock.com",
  "inboxbear.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.org",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
  "yopmail.net",
]);

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const LATIN_NAME = /^[A-Za-z\s'’.-]+$/;
const VOWEL = /[aeiouy]/i;

export type TurnstileState = "ok" | "failed" | "missing" | "unknown";

export type SpamInput = {
  name: string;
  email: string;
  body: string;
  honeypot?: string;
  elapsedMs: number | null | "unconfigured" | "absent";
  turnstile: TurnstileState;
  submissionsThisHour: number;
};

export type SpamVerdict = { score: number; reasons: string[]; isSpam: boolean };

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

function countUrls(body: string): number {
  return body.match(URL_PATTERN)?.length ?? 0;
}

function isShouting(name: string): boolean {
  return name.length >= 4 && name === name.toUpperCase() && name !== name.toLowerCase();
}

// latin-only: a devanagari or han name has no a-e-i-o-u
function isVowelless(name: string): boolean {
  return name.length > 4 && LATIN_NAME.test(name) && !VOWEL.test(name);
}

export function scoreSpam(input: SpamInput): SpamVerdict {
  const reasons: string[] = [];
  let score = 0;

  const add = (points: number, reason: string): void => {
    score += points;
    reasons.push(reason);
  };

  const name = input.name.trim();
  const body = input.body.trim();

  if (input.honeypot && input.honeypot.trim().length > 0) add(100, "honeypot-filled");

  if (input.turnstile === "failed") add(100, "turnstile-failed");

  if (input.elapsedMs === null) add(40, "timing-token-invalid");
  else if (input.elapsedMs !== "unconfigured" && input.elapsedMs !== "absent" && input.elapsedMs < MIN_ELAPSED_MS) {
    add(40, "submitted-too-fast");
  }

  const unmeasured =
    (input.turnstile === "missing" ? 1 : 0) + (input.elapsedMs === "absent" ? 1 : 0);
  if (unmeasured > 0) {
    add(UNMEASURED_POINTS, unmeasured === 2 ? "defenses-unavailable" : input.turnstile === "missing" ? "turnstile-missing" : "timing-token-absent");
  }

  if (countUrls(body) > MAX_URLS) add(25, "too-many-urls");

  if (input.submissionsThisHour > MAX_SUBMISSIONS_PER_HOUR) add(50, "burst-from-sender");

  const domain = domainOf(input.email);
  if (domain && DISPOSABLE_DOMAINS.has(domain)) add(30, "disposable-email");

  if (isShouting(name)) add(15, "all-caps-name");
  if (isVowelless(name)) add(15, "vowelless-name");

  if (body.length < MIN_BODY_LENGTH) add(20, "body-too-short");

  return { score, reasons, isSpam: score >= SPAM_THRESHOLD };
}
