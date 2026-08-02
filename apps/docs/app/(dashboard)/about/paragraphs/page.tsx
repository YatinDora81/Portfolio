import { redirect } from "next/navigation";

/**
 * Was its own nav row; the paragraphs and the education timeline are one
 * section on the site, so they are one page here now. Kept as a stub — and out
 * of `nav.ts`, so the palette lists `/about` once — because bookmarks and the
 * dashboard's quick actions still point at this URL.
 *
 * Not seamless when logged out: `middleware.ts` gates this path, so an old
 * bookmark hit cold lands on /login first.
 */
export default function AboutParagraphsRedirect() {
  redirect("/about");
}
