import Link from "next/link";
import { IconArrowUpRight, IconLock } from "@tabler/icons-react";

/**
 * A value a section RENDERS but does not OWN.
 *
 * Every SiteConfig key and every table now lives on exactly one page, which is
 * what makes the section split safe — but the site does not respect those
 * boundaries: the hero draws the availability status that Contact writes, the
 * About terminal draws the résumé URL that Hero writes. Hiding those values on
 * the pages that show them would make each page lie about what it controls; an
 * editable second copy would race the owner.
 *
 * So: the real current value, read-only, named, with the way to its owner. It is
 * deliberately NOT a disabled input — a disabled field says "you can't", this
 * says "not here, there", and points at the page that can.
 *
 * Classes are the shared `.borrowed` family in control-room.css.
 */
export function Borrowed({ label, value, empty = "not set", owner, href }: {
  /** The key or row, in the language of the page showing it. */
  label: string;
  value?: string | null;
  /** What to say when the owning page has left it blank. */
  empty?: string;
  /** The section that writes it — "Contact", "Hero", "Experience". */
  owner: string;
  href: string;
}) {
  const shown = (value ?? "").trim();

  return (
    <div className="borrowed">
      <span className="borrowed-lock" aria-hidden="true">
        <IconLock size={12} stroke={1.6} />
      </span>
      <span className="borrowed-k">{label}</span>
      <span className={shown ? "borrowed-v" : "borrowed-v none"} title={shown || undefined}>
        {shown || empty}
      </span>
      <Link className="borrowed-go" href={href}>
        edited in {owner} <IconArrowUpRight size={11} stroke={1.7} className="nudge" />
      </Link>
    </div>
  );
}
