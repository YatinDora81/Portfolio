"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createAdminUser, updateAdminUser, deleteAdminUser } from "@/lib/actions/admin-users";
import { changePassword } from "@/lib/actions/auth";
import { IconPlus, IconEdit, IconLock } from "@tabler/icons-react";

interface User { id: string; email: string; username: string; name: string; role: string; createdAt: string }

const ROLE_LEVEL: Record<string, number> = { OWNER: 3, ADMIN: 2, SUB_ADMIN: 1 };

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", SUB_ADMIN: "Sub Admin" };

const ROLE_BADGE_VARIANT: Record<string, "default" | "success" | "outline"> = {
  OWNER: "default",
  ADMIN: "success",
  SUB_ADMIN: "outline",
};

function canManage(actorRole: string, targetRole: string) {
  return ROLE_LEVEL[actorRole]! > ROLE_LEVEL[targetRole]!;
}

function getRoleOptions(actorRole: string) {
  // Can only assign roles below your own level
  return Object.entries(ROLE_LEVEL)
    .filter(([, level]) => level < ROLE_LEVEL[actorRole]!)
    .sort((a, b) => b[1] - a[1])
    .map(([role]) => ({ value: role, label: ROLE_LABEL[role]! }));
}

export function AdminUsersTable({ users, currentUser }: { users: User[]; currentUser: { userId: string; role: string } }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [pwNewPassword, setPwNewPassword] = useState("");
  const [pwConfirmPassword, setPwConfirmPassword] = useState("");

  const myRole = currentUser.role;
  const roleOptions = getRoleOptions(myRole);
  const canCreateUsers = roleOptions.length > 0;

  function openPasswordDialog(u: User) {
    setPasswordTarget(u);
    setPasswordError("");
    setPwNewPassword("");
    setPwConfirmPassword("");
    setPasswordDialogOpen(true);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordTarget) return;
    setPasswordError("");
    setPasswordLoading(true);
    const formData = new FormData();
    formData.set("targetUserId", passwordTarget.id);
    formData.set("newPassword", pwNewPassword);
    formData.set("confirmPassword", pwConfirmPassword);
    formData.set("adminOverride", "true");
    const result = await changePassword(formData);
    setPasswordLoading(false);
    if (result?.error) {
      setPasswordError(result.error);
    } else {
      setPasswordDialogOpen(false);
      setPasswordTarget(null);
    }
  }

  return (
    <Card>
      {canCreateUsers && (
        <div className="flex justify-end mb-4">
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <IconPlus size={16} /> Add User
          </Button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 px-3 font-medium">Name</th>
            <th className="pb-3 px-3 font-medium">Username</th>
            <th className="pb-3 px-3 font-medium">Email</th>
            <th className="pb-3 px-3 font-medium">Role</th>
            <th className="pb-3 px-3 font-medium">Joined</th>
            <th className="pb-3 px-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUser.userId;
            const canManageUser = !isSelf && canManage(myRole, u.role);

            return (
              <tr key={u.id} className={`border-b border-border last:border-0 ${isSelf ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/15" : ""}`}>
                <td className="py-3 px-3 font-medium">
                  {u.name}
                  {isSelf && <span className="ml-2 text-[10px] bg-primary text-primary-foreground font-semibold px-3 py-0.5 rounded">You</span>}
                </td>
                <td className="py-3 px-3 text-muted-foreground font-mono text-xs">{u.username}</td>
                <td className="py-3 px-3 text-muted-foreground">{u.email}</td>
                <td className="py-3 px-3">
                  <Badge variant={ROLE_BADGE_VARIANT[u.role] || "outline"}>
                    {ROLE_LABEL[u.role] || u.role}
                  </Badge>
                </td>
                <td className="py-3 px-3 text-muted-foreground text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-3 px-3 text-right">
                  <div className="flex justify-end gap-1">
                    {canManageUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openPasswordDialog(u)}
                        title="Change Password"
                      >
                        <IconLock size={16} />
                      </Button>
                    )}
                    {canManageUser && (
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(u); setDialogOpen(true); }}>
                        <IconEdit size={16} />
                      </Button>
                    )}
                    {canManageUser && (
                      <DeleteButton label={`"${u.name}"`} onDelete={async () => { await deleteAdminUser(u.id, currentUser.userId); }} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit User" : "Add User"}>
        <form action={async (formData) => {
          if (editing) await updateAdminUser(editing.id, formData);
          else await createAdminUser(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="username" label="Username" defaultValue={editing?.username || ""} required placeholder="Unique login username" />
          <Input name="email" label="Email" type="email" defaultValue={editing?.email || ""} required />
          {!editing && <Input name="password" label="Password" type="password" required />}
          <Select
            name="role"
            label="Role"
            defaultValue={editing?.role || roleOptions[roleOptions.length - 1]?.value || "SUB_ADMIN"}
            options={roleOptions}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} title={`Change Password — ${passwordTarget?.name}`}>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            name="newPassword"
            type="password"
            label="New Password"
            placeholder="Enter new password (min 6 characters)"
            required
            minLength={6}
            value={pwNewPassword}
            onChange={(e) => setPwNewPassword(e.target.value)}
          />
          <Input
            name="confirmPassword"
            type="password"
            label="Confirm New Password"
            placeholder="Confirm new password"
            required
            minLength={6}
            value={pwConfirmPassword}
            onChange={(e) => setPwConfirmPassword(e.target.value)}
          />
          {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={passwordLoading}>
              {passwordLoading ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
