"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCat, IconExternalLink, IconLogout } from "@tabler/icons-react";
import { NAV_GROUPS, navMark, type NavLink as NavLinkType } from "@/lib/nav";
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
  const ord = navMark(x);
  // The badge sits in exactly the part a 58px rail clips away, and silently
  // losing "you have mail" is a real regression — so the rail redraws it as a
  // dot on the glyph, and this class is what tells it there is one to draw.
  const flagged = !!x.badge && unread > 0;
  return (
    <Link
      href={x.href}
      className={cn("nav-item", active && "on", flagged && "has-badge")}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      {ord ? (
        // Decorative: the accessible name is the label, and a screen reader
        // announcing "caret dot dot caret, Cat" helps nobody.
        <span className={cn("nav-num", x.mark && "glyph")} aria-hidden="true">{ord}</span>
      ) : null}
      <Icon size={15} className="nav-ic" stroke={1.7} />
      <span className="nav-txt">{x.label}</span>
      {x.badge && unread > 0 ? (
        <span className="nav-badge" aria-label={`${unread} unread`}>{unread}</span>
      ) : null}
    </Link>
  );
}

export function Sidebar({ user, unread, railed, open, onNavigate }: {
  user: { email: string; role: string };
  unread: number;
  railed: boolean;
  open: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const initials = user.email.slice(0, 2).toUpperCase();
  const roleLabel = user.role === "SUB_ADMIN" ? "Sub-Admin" : user.role === "OWNER" ? "Owner" : "Admin";

  return (
    /**
     * Two boxes, and the reason is the whole trick. `.sb-inner` is ALWAYS 254px
     * and absolutely positioned; railing narrows and clips `.sb` around it.
     * Nothing inside ever reflows, so collapsing costs one width transition
     * instead of relaying out eighteen rows, and hover-peek is a pure overflow
     * and opacity reveal with no layout work at all.
     */
    <aside id="cr-sidebar" className={cn("sb", open && "open", railed && "rail")}>
     <div className="sb-inner">
      <div className="sb-brand">
        <div className="sb-mark"><IconCat size={19} /></div>
        <div>
          <div className="sb-brand-name">Control Room</div>
          <div className="sb-brand-sub">{SITE_HOST}</div>
        </div>
      </div>

      <nav className="sb-nav" aria-label="Control room">
        {NAV_GROUPS.map((g, gi) => {
          const labelId = `nav-g${gi}`;
          // The ordinal rail is drawn only where the ordinals mean something:
          // the run down the public page. The operational and site groups are
          // sets, not sequences, and a rail would claim an order they don't have.
          const run = g.items.some((x) => navMark(x));
          return (
            <div
              key={g.label ?? "top"}
              className={cn("nav-grp", run && "run")}
              role="group"
              aria-labelledby={g.label ? labelId : undefined}
            >
              {g.label ? (
                <div className="nav-label" id={labelId}><span>{g.label}</span></div>
              ) : null}
              <div className="nav-run">
                {g.items.map((x) => (
                  <NavBtn
                    key={x.href}
                    x={x}
                    active={isActive(x.href)}
                    unread={unread}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}
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
     </div>
    </aside>
  );
}
