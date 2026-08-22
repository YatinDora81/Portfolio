import { draftMode } from "next/headers";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export async function GET() {
  const dm = await draftMode();
  dm.disable();

  // Must stay outside any try/catch — `redirect()` throws NEXT_REDIRECT.
  redirect("/");
}
