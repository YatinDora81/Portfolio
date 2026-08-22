import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@repo/config/env";

/**
 * Preview links: a short-lived signed statement of "show me this one thing as
 * if it were live".
 *
 * The token is a bearer credential for unpublished writing, so it is scoped as
 * tightly as it can be — one subject, thirty minutes — and it is not what grants
 * access. Redeeming it sets the Draft Mode cookie, and the COOKIE is what every
 * later request is judged on. A link that has been read once is spent; a link
 * pasted into a group chat three hours later is expired.
 */

/**
 * What a token is allowed to say.
 *
 * `"Home"` is not a convenience: `Project` has no slug and no detail page, so
 * the only way to look at a draft project is the homepage in draft mode. There
 * is nothing finer-grained to point at.
 */
export type PreviewClaims = { type: "Blog"; slug: string } | { type: "Home" };

const ALG = "HS256";
const TTL = "30m";

/**
 * Mandatory, and checked on the way back in.
 *
 * Every token this repo signs is an HS256 JWT, so the only thing separating a
 * preview link from an admin session cookie is which key verifies it. That
 * separation is one misconfigured environment away from collapsing — the same
 * string pasted into `JWT_SECRET` and `PREVIEW_SECRET` would silently make an
 * admin session token a valid preview token and vice versa. This claim is the
 * second lock: a token minted for any other purpose fails here regardless of
 * which key signed it.
 */
const PURPOSE = "preview";

/**
 * Null, not a throw, and null rather than a fallback to some other secret.
 *
 * `PREVIEW_SECRET` is optional and set nowhere yet, so the whole feature has to
 * degrade to "off" — both minting and verifying refuse — rather than take the
 * site down or, far worse, quietly reach for `JWT_SECRET` because it happens to
 * be present. The admin session secret must never mint preview tokens.
 */
function previewKey(): Uint8Array | null {
  if (!env.PREVIEW_SECRET) return null;
  return new TextEncoder().encode(env.PREVIEW_SECRET);
}

/** Null when `PREVIEW_SECRET` is unset — the caller shows no preview link. */
export async function createPreviewToken(claims: PreviewClaims): Promise<string | null> {
  const key = previewKey();
  if (!key) return null;

  return new SignJWT({ ...claims, purpose: PURPOSE })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

/**
 * Null for every failure — no secret, bad signature, expired, wrong purpose,
 * or a payload that does not describe something previewable. The caller answers
 * 401 and learns nothing more, because every one of those cases is answered the
 * same way and distinguishing them only helps whoever is guessing.
 */
export async function verifyPreviewToken(token: string): Promise<PreviewClaims | null> {
  const key = previewKey();
  if (!key) return null;

  try {
    // `algorithms` pins HS256. Without it, jose would accept whatever the
    // token's own header asks for, which is how alg-confusion attacks start.
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });

    const purpose = payload["purpose"];
    if (typeof purpose !== "string" || purpose !== PURPOSE) return null;

    const type = payload["type"];
    if (typeof type !== "string") return null;
    if (type === "Home") return { type: "Home" };

    const slug = payload["slug"];
    if (type === "Blog" && typeof slug === "string" && slug.length > 0) {
      return { type: "Blog", slug };
    }

    return null;
  } catch {
    // jose throws for expiry and for a bad signature alike; both are "no".
    return null;
  }
}
