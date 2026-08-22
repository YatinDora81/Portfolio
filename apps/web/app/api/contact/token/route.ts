import { signFormTimestamp } from "@repo/shared/form-token";

// Signed per request and never prerendered: `/` is static for a day, and a
// timestamp baked into that HTML outlives the verifier's two-hour window.
export const dynamic = "force-dynamic";

/** `{ token: null }` with a 200 when no secret is configured — the scorer reads
    an absent token as "no signal", and an error status would be a lie. */
export function GET() {
  return Response.json(
    { token: signFormTimestamp() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
