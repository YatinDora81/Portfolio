import { redirect } from "next/navigation";

/**
 * Folded into /hero — the social row is the hero's icon row, so it is edited
 * where it renders. The staged table that lived here moved to /hero; the GitHub
 * refresh control moved to /contact-purposes, beside the contribution tile it
 * actually refreshes.
 *
 * Kept as a stub so bookmarks don't 404, and kept out of nav.ts so the palette
 * doesn't list the same destination twice. Auth-gated by middleware.ts, so a
 * logged-out visitor meets /login before this redirect ever runs.
 */
export default function SocialLinksRedirect() {
  redirect("/hero");
}
