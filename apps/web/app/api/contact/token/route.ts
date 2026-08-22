import { signFormTimestamp } from "@repo/shared/form-token";

// A prerendered timestamp would outlive the verifier's two-hour window.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { token: signFormTimestamp() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
