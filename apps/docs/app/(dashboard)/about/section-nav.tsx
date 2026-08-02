import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Section 02 is two routes and one place.
 *
 * `/about` holds the rows the section is built from; `/terminal` is the
 * read-only reference for the shell those rows print inside. Nothing links them
 * in the data — the terminal has no model — so this pair is what says they are
 * the same section. Both pages render it directly under their `.sec-strip`, in
 * the same position, which is the whole trick.
 *
 * Plain links, not a tab widget: each half is a real route with its own URL and
 * its own back-button entry, so `aria-current="page"` is the correct state and
 * there is no roving tabindex to get wrong.
 */
export function AboutSectionNav({ active }: { active: "about" | "terminal" }) {
  return (
    <nav className="abt-nav" aria-label="About section">
      <Link
        href="/about"
        className={cn("abt-tab", active === "about" && "on")}
        aria-current={active === "about" ? "page" : undefined}
      >
        <span className="abt-tab-g" aria-hidden="true">02</span>
        Bio &amp; education
        <span className="abt-tab-s">editable</span>
      </Link>
      <Link
        href="/terminal"
        className={cn("abt-tab", active === "terminal" && "on")}
        aria-current={active === "terminal" ? "page" : undefined}
      >
        <span className="abt-tab-g" aria-hidden="true">&gt;_</span>
        Terminal
        <span className="abt-tab-s">reference</span>
      </Link>
    </nav>
  );
}
