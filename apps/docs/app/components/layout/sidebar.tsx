"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCat, IconExternalLink, IconLogout } from "@tabler/icons-react";
import { NAV_TOP, NAV_CONTENT, NAV_SITE, type NavLink as NavLinkType } from "@/lib/nav";
import { logout } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");
const SITE_HOST = SITE.replace(/^https?:\/\//, "");

function NavBtn({ x, active, unread, onNavigate }: {
  x: NavLinkType;
  active: boolean;
  unread: number;
  onNavigate: () => void;
}) {
  const Icon = x.icon;
  return (
    <Link href={x.href} className={cn("nav-item", active && "on")} onClick={onNavigate}>
      {x.n ? <span className="nav-num">{x.n}</span> : null}
      <Icon size={15} className="nav-ic" />
      <span className="nav-txt">{x.label}</span>
      {x.badge && unread > 0 ? <span className="nav-badge">{unread}</span> : null}
    </Link>
  );
}

export function Sidebar({ user, unread, open, onNavigate }: {
  user: { email: string; role: string };
  unread: number;
  open: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const initials = user.email.slice(0, 2).toUpperCase();
  const roleLabel = user.role === "SUB_ADMIN" ? "Sub-Admin" : user.role === "OWNER" ? "Owner" : "Admin";

  return (
    <aside className={cn("sb", open && "open")}>
      <div className="sb-brand">
        <div className="sb-mark"><IconCat size={19} /></div>
        <div>
          <div className="sb-brand-name">Control Room</div>
          <div className="sb-brand-sub">{SITE_HOST}</div>
        </div>
      </div>

      <nav className="sb-nav">
        {NAV_TOP.map((x) => (
          <NavBtn key={x.href} x={x} active={isActive(x.href)} unread={unread} onNavigate={onNavigate} />
        ))}
        <div className="nav-label">Content · page order</div>
        {NAV_CONTENT.map((x) => (
          <NavBtn key={x.href} x={x} active={isActive(x.href)} unread={unread} onNavigate={onNavigate} />
        ))}
        <div className="nav-label">Site</div>
        {NAV_SITE.map((x) => (
          <NavBtn key={x.href} x={x} active={isActive(x.href)} unread={unread} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="sb-foot">
        <div className="live-card">
          <div className="live-top">
            <span className="live-dot" />
            <span className="live-url">{SITE_HOST}</span>
            <a className="live-open" href={SITE} target="_blank" rel="noreferrer" aria-label="Open live site">
              <IconExternalLink size={12} />
            </a>
          </div>
          <div className="live-sub">Signed in as <b>{user.email}</b></div>
        </div>
        <div className="me">
          <div className="ava">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="me-name" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email.split("@")[0]}</div>
            <div className="me-role">{roleLabel}</div>
          </div>
          <form action={logout} style={{ marginLeft: "auto", display: "flex" }}>
            <button className="me-out" type="submit" aria-label="Log out" title="Log out">
              <IconLogout size={15} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
