"use client";

import { useState } from "react";
import { logout, changePassword } from "@/lib/actions/auth";
import { IconLogout, IconLock, IconSun, IconMoon } from "@tabler/icons-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function TopBar({ user }: { user: { userId: string; email: string; role: string } }) {
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
    if (result?.error) {
      setError(result.error);
    } else {
      setOpen(false);
    }
  }

  return (
    <>
      <header className="h-14 border-b border-border/60 bg-card/80 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
        <div />
        <div className="flex items-center gap-1">
          <span className="text-[13px] text-muted-foreground mr-2">{user.email}</span>
          <span className="text-[10px] bg-primary/10 text-primary font-semibold px-2.5 py-1 rounded-full mr-2 uppercase tracking-wide">
            {user.role === "SUB_ADMIN" ? "Sub Admin" : user.role === "OWNER" ? "Owner" : "Admin"}
          </span>

          <button
            type="button"
            onClick={toggleTheme}
            className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 cursor-pointer"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? <IconMoon size={16} stroke={1.5} /> : <IconSun size={16} stroke={1.5} />}
          </button>

          <button
            type="button"
            onClick={openDialog}
            className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 cursor-pointer"
            title="Change password"
          >
            <IconLock size={16} stroke={1.5} />
          </button>

          <form action={logout}>
            <button
              type="submit"
              className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150 cursor-pointer"
              title="Logout"
            >
              <IconLogout size={16} stroke={1.5} />
            </button>
          </form>
        </div>
      </header>

      <Dialog open={open} onClose={() => setOpen(false)} title="Change Password">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            name="currentPassword"
            type="password"
            label="Current Password"
            placeholder="Enter current password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Input
            name="newPassword"
            type="password"
            label="New Password"
            placeholder="Enter new password (min 6 characters)"
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            name="confirmPassword"
            type="password"
            label="Confirm New Password"
            placeholder="Confirm new password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
