/** No `0`/`O`, no `1`/`l`/`I`: these get typed by hand off a printed résumé. */
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export const SLUG_LENGTH = 7;

// Bytes at or above this would wrap the alphabet and bias the first few letters.
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

/** Open-redirect gate. Backslashes are rejected rather than parsed: browsers fold `/\evil.com` into `//evil.com`. */
export function safeDestination(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_DESTINATION_LENGTH) return null;
  // eslint-disable-next-line no-control-regex -- browsers strip a stray tab or newline from a URL before resolving it.
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
