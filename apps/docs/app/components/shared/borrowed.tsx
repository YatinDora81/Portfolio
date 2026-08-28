import Link from "next/link";
import { IconArrowUpRight, IconLock } from "@tabler/icons-react";

export function Borrowed({ label, value, empty = "not set", owner, href }: {
  label: string;
  value?: string | null;
  empty?: string;
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
