"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_SECTIONS, type NavItem } from "@/lib/constants";
import { IconChevronDown, IconLayoutDashboard } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col h-screen shrink-0 border-r border-white/5">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="size-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 transition-shadow group-hover:shadow-blue-500/30">
            <IconLayoutDashboard size={18} className="text-white" />
          </div>
          <div>
            <span className="font-semibold text-[15px] tracking-tight">Admin</span>
            <p className="text-[10px] text-sidebar-muted leading-none mt-0.5">Portfolio CMS</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-3 mb-2 text-[10px] uppercase tracking-widest font-semibold text-sidebar-muted/50">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) =>
                "children" in item && item.children ? (
                  <NavGroup key={item.label} item={item} pathname={pathname} />
                ) : (
                  <NavLink
                    key={item.label}
                    href={item.href || "#"}
                    icon={item.icon}
                    label={item.label}
                    active={pathname === item.href}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/[0.06]">
        <p className="text-[10px] text-sidebar-muted/40 text-center">v1.0</p>
      </div>
    </aside>
  );
}

function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = item.children?.some((c) => pathname === c.href) || false;
  const [open, setOpen] = useState(isActive);
  const Icon = item.icon;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 cursor-pointer",
          isActive
            ? "text-sidebar-foreground bg-sidebar-accent"
            : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/[0.04]"
        )}
      >
        {Icon && <Icon size={18} stroke={1.5} />}
        <span className="flex-1 text-left">{item.label}</span>
        <IconChevronDown
          size={14}
          className={cn(
            "transition-transform duration-200 text-sidebar-muted/60",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="ml-[30px] mt-1 space-y-0.5 border-l border-white/[0.06] pl-3">
            {item.children?.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block px-2.5 py-1.5 rounded-md text-[13px] transition-all duration-150",
                  pathname === child.href
                    ? "text-sidebar-foreground bg-sidebar-accent font-medium"
                    : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/[0.04]"
                )}
              >
                {child.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: NavItem["icon"];
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 relative",
        active
          ? "text-sidebar-foreground bg-sidebar-accent shadow-sm shadow-black/10"
          : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/[0.04]"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-primary" />
      )}
      {Icon && <Icon size={18} stroke={1.5} />}
      {label}
    </Link>
  );
}
