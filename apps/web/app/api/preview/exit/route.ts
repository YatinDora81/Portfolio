import { draftMode } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Leave preview: clear the Draft Mode cookie and go home.
 *
 * No token and no secret — the only thing this can do is take an ability away,
 * and there is no attack in making someone see the published site.
 *
 * Home, unconditionally, rather than back to the page the visitor was reading.
 * A `?to=` parameter here would be an open redirect on a route that anyone can
 * hit, and the page they were on is very often a draft that is about to stop
 * existing for them anyway.
 */
export const runtime = "nodejs";

export async function GET() {
  const dm = await draftMode();
  dm.disable();

  // Last statement, outside any try/catch — `redirect()` throws NEXT_REDIRECT.
  redirect("/");
}
