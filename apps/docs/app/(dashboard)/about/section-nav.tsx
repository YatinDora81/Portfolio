import Link from "next/link";
import { cn } from "@/lib/utils";

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
