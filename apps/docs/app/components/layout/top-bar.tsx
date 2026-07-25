"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import {
  IconLogout, IconLock, IconSun, IconMoon, IconMenu2, IconWorld, IconSearch,
  IconRefresh, IconCheck,
} from "@tabler/icons-react";
import { logout, changePassword } from "@/lib/actions/auth";
import { publishSite } from "@/lib/actions/publish";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { matchNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

export function TopBar({ user, onBurger, onPalette, toast }: {
  user: { userId: string; email: string; role: string };
  onBurger: () => void;
  onPalette: () => void;
  toast: (msg: string, tone?: "good" | "bad") => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const nav = matchNav(pathname);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, startPublish] = useTransition();

  function openDialog() {
    setOpen(true);
    setError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData();
    formData.set("targetUserId", user.userId);
    formData.set("currentPassword", currentPassword);
    formData.set("newPassword", newPassword);
    formData.set("confirmPassword", confirmPassword);
    const result = await changePassword(formData);
    setLoading(false);
    if (result?.error) setError(result.error);
    else { setOpen(false); toast("Password updated"); }
  }

  function publish() {
    startPublish(async () => {
      const res = await publishSite();
      if (res.ok) toast(`Published — ${SITE.replace(/^https?:\/\//, "")} revalidated`);
      else toast(res.error || "Publish failed", "bad");
    });
  }

  return (
    <>
      <div className="tb">
        {busy ? <span className="pubbar" aria-hidden="true" /> : null}
        <button className="tb-burger" onClick={onBurger} aria-label="Menu"><IconMenu2 size={18} /></button>

        <div className="tb-crumb" key={pathname}>
          <div className="tb-eyebrow">{nav?.eyebrow ?? "control room"}</div>
          <div className="tb-title">{nav?.label ?? "Admin"}</div>
        </div>

        <div className="tb-right">
          <button
            className="ibtn"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to dark" : "Switch to light"}
            aria-label="Toggle theme"
          >
            {theme === "light" ? <IconMoon size={15} /> : <IconSun size={15} />}
          </button>

          <button className="ibtn" onClick={openDialog} title="Change password" aria-label="Change password">
            <IconLock size={15} />
          </button>

          <a className="tb-live" href={SITE} target="_blank" rel="noreferrer">
            <IconWorld size={14} /><span>View live</span>
          </a>

          <button className="tb-search" onClick={onPalette}>
            <IconSearch size={13} /> <span className="lbl">Search…</span>
            <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
          </button>

          <button className={cn("pub", !busy && "dirty")} onClick={publish} disabled={busy}>
            {busy ? <IconRefresh size={13} className="spin" /> : <span className="pub-dot" />}
            {busy ? "Publishing…" : "Publish"}
          </button>

          <form action={logout} style={{ display: "flex" }}>
            <button className="ibtn warn" type="submit" title="Log out" aria-label="Log out">
              <IconLogout size={15} />
            </button>
          </form>
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Change password"
        icon={IconLock}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" form="change-password" disabled={loading}>
              <IconCheck size={13} /> {loading ? "Updating…" : "Update password"}
            </Button>
          </>
        }
      >
        <form id="change-password" onSubmit={handleChangePassword}>
          <Input
            name="currentPassword" type="password" label="Current password"
            placeholder="Enter current password" required
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Input
            name="newPassword" type="password" label="New password"
            placeholder="At least 6 characters" required minLength={6}
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            name="confirmPassword" type="password" label="Confirm new password"
            placeholder="Repeat it" required minLength={6}
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            error={error || undefined}
          />
        </form>
      </Dialog>
    </>
  );
}
