import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@repo/config/env";

/** `"Home"` exists because Project has no slug and no detail page to point at. */
export type PreviewClaims = { type: "Blog"; slug: string } | { type: "Home" };

const ALG = "HS256";
const TTL = "30m";

// Checked on verify: the second lock if `JWT_SECRET` and `PREVIEW_SECRET` ever match.
const PURPOSE = "preview";

// Null rather than a fallback to `JWT_SECRET`: no secret means preview is simply off.
function previewKey(): Uint8Array | null {
  if (!env.PREVIEW_SECRET) return null;
  return new TextEncoder().encode(env.PREVIEW_SECRET);
}

export async function createPreviewToken(claims: PreviewClaims): Promise<string | null> {
  const key = previewKey();
  if (!key) return null;

  return new SignJWT({ ...claims, purpose: PURPOSE })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

// Null for every failure — telling them apart only helps whoever is guessing.
export async function verifyPreviewToken(token: string): Promise<PreviewClaims | null> {
  const key = previewKey();
  if (!key) return null;

  try {
    // Pin the alg, or jose accepts whatever the token's own header asks for.
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
