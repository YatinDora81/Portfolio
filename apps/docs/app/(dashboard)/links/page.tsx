import { redirect } from "next/navigation";

/**
 * Folded into /hero — the social row and the résumé link are hero controls, and
 * this page's immediate-write social editor lost to the staged one that used to
 * live at /social-links.
 *
 * The stub stays so old bookmarks and any link still pointing here land on the
 * page that now owns those controls rather than on a 404. It is deliberately not
 * in nav.ts: a redirect listed in the sidebar or the palette would offer the
 * reader a choice between a page and its own forwarding address. Note that
 * middleware.ts gates this route, so a logged-out visitor sees /login first and
 * arrives wherever the login flow sends them — the redirect only holds for a
 * session that is already signed in.
 */
export default function LinksRedirect() {
  redirect("/hero");
}
