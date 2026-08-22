/**
 * No `0`/`O`, no `1`/`l`/`I`. These slugs get read off a laptop screen, typed by
 * hand from a printed résumé and recovered from a blurry QR scan, and every one
 * of those failures looks like a dead link rather than a typo.
 */
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export const SLUG_LENGTH = 7;

// Bytes at or above this would wrap the alphabet and make the first few letters
// slightly likelier than the rest; drawing again is cheaper than caring why.
const UNBIASED_CEILING = 256 - (256 % SLUG_ALPHABET.length);

const SLUG_RE = new RegExp(`^[${SLUG_ALPHABET}]{4,16}$`);

export function generateSlug(length = SLUG_LENGTH): string {
  let out = "";
  while (out.length < length) {
    const batch = new Uint8Array(length * 2);
    crypto.getRandomValues(batch);
    for (const byte of batch) {
      if (byte >= UNBIASED_CEILING) continue;
      const char = SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
      if (char === undefined) continue;
      out += char;
      if (out.length === length) break;
    }
  }
  return out;
}

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

const OWN_HOST = "yatindora.in";
const MAX_DESTINATION_LENGTH = 2048;

/**
 * 🚨 The open-redirect gate. A short link on this domain borrows the domain's
 * trust, so `/r/abc` must never be able to land on someone else's login page.
 *
 * Returns the destination to use, or null to send the visitor home. Backslashes
 * are rejected outright rather than parsed: browsers fold `/\evil.com` into the
 * protocol-relative `//evil.com` and leave the origin behind.
 */
export function safeDestination(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_DESTINATION_LENGTH) return null;
  // eslint-disable-next-line no-control-regex -- browsers strip a stray tab or newline out of a URL before resolving it, so this is the only place one can be caught.
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return null;

  if (value.startsWith("/")) return value.startsWith("//") ? null : value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (host !== OWN_HOST && !host.endsWith(`.${OWN_HOST}`)) return null;

  return url.toString();
}
