"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import type { Entity } from "@/lib/actions/staging";
import {
  IconPlus, IconEdit, IconLock, IconShieldCheck, IconUserPlus, IconArrowBackUp,
} from "@tabler/icons-react";

interface User { id: string; email: string; username: string; name: string; role: string; createdAt: string }

const ENTITY: Entity = "adminUser";

const ROLE_LEVEL: Record<string, number> = { OWNER: 3, ADMIN: 2, SUB_ADMIN: 1 };

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", SUB_ADMIN: "Sub Admin" };

const ROLE_CLASS: Record<string, string> = { OWNER: "owner", ADMIN: "admin", SUB_ADMIN: "sub" };

function canManage(actorRole: string, targetRole: string) {
  return ROLE_LEVEL[actorRole]! > ROLE_LEVEL[targetRole]!;
}

function getRoleOptions(actorRole: string) {
  return Object.entries(ROLE_LEVEL)
    .filter(([, level]) => level < ROLE_LEVEL[actorRole]!)
    .sort((a, b) => b[1] - a[1])
    .map(([role]) => ({ value: role, label: ROLE_LABEL[role]! }));
}

function initials(name: string, email: string) {
  const src = name?.trim() || email || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0]! + parts[1][0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function AdminUsersTable({ users, currentUser }: { users: User[]; currentUser: { userId: string; role: string } }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [pwNewPassword, setPwNewPassword] = useState("");
  const [pwConfirmPassword, setPwConfirmPassword] = useState("");
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete,
    isDeleted, isNew, isEdited,
  } = useStaging();

  const rows = overlay(ENTITY, users, (u) => u.id);

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

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordTarget) return;
    if (pwNewPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters");
      return;
    }
    if (pwNewPassword !== pwConfirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    stageUpdate(ENTITY, passwordTarget.id, { password: pwNewPassword });
    setPasswordDialogOpen(false);
    setPasswordTarget(null);
  }

  return (
    <Card flush>
      <CardHead
        title="Accounts"
        count={rows.filter((u) => !isDeleted(ENTITY, u.id)).length}
        right={
          canCreateUsers ? (
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <IconPlus size={14} /> Add user
            </Button>
          ) : undefined
        }
      />

      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th style={{ width: 170 }}>Role</th>
              <th style={{ width: 130, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const isSelf = u.id === currentUser.userId;
              const canManageUser = !isSelf && canManage(myRole, u.role);
              const isOwner = u.role === "OWNER";
              const del = isDeleted(ENTITY, u.id);
              const pending = isNew(ENTITY, u.id);
              const mark = del ? "staged-del" : pending ? "staged-new" : isEdited(ENTITY, u.id) ? "staged-edit" : null;

              return (
                <tr key={u.id} className={mark ?? undefined}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <div className="ava">{initials(u.name, u.email)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="row-t" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {u.name}
                          {isSelf && <span className="chip amb">you</span>}
                        </div>
                        <div className="row-m">
                          <span style={{ fontFamily: "var(--mono)" }}>{u.email}</span>
                          {" · @"}{u.username}
                          {" · joined "}{new Date(u.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`role ${ROLE_CLASS[u.role] || "sub"}`}>
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                  </td>
                  <td>
                    <div className="row-acts" style={{ justifyContent: "flex-end" }}>
                      {del ? (
                        <IconButton
                          aria-label={`Keep ${u.name}`}
                          title="Undo delete"
                          onClick={() => unstageDelete(ENTITY, u.id)}
                        >
                          <IconArrowBackUp size={13} stroke={1.5} />
                        </IconButton>
                      ) : isOwner ? (
                        <span className="chip">
                          <IconShieldCheck size={11} stroke={1.7} /> protected
                        </span>
                      ) : canManageUser ? (
                        <>
                          {!pending && (
                            <IconButton
                              onClick={() => openPasswordDialog(u)}
                              title="Change password"
                              aria-label={`Change password for ${u.name}`}
                            >
                              <IconLock size={13} stroke={1.5} />
                            </IconButton>
                          )}
                          <IconButton
                            onClick={() => { setEditing(u); setDialogOpen(true); }}
                            title="Edit user"
                            aria-label={`Edit ${u.name}`}
                          >
                            <IconEdit size={13} stroke={1.5} />
                          </IconButton>
                          <DeleteButton
                            staged
                            newRow={pending}
                            label={`"${u.name}"`}
                            sub="This revokes their access to the control room."
                            onDelete={() => stageDelete(ENTITY, u.id)}
                          />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "11px 16px", borderTop: "1px solid var(--line2)" }}>
        <div className="hint">
          <IconShieldCheck size={13} stroke={1.5} />
          You can only manage — and only assign — roles below your own. The owner account is permanent.
        </div>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit user" : "Add user"}
        icon={IconUserPlus}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="admin-user-form">{editing ? "Update" : "Create"}</Button>
          </>
        }
      >
        <form
          id="admin-user-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const fields = {
              name: String(data.get("name") ?? ""),
              username: String(data.get("username") ?? ""),
              email: String(data.get("email") ?? ""),
              role: String(data.get("role") ?? ""),
            };
            if (editing) stageUpdate(ENTITY, editing.id, fields);
            else stageCreate(ENTITY, {
              ...fields,
              password: String(data.get("password") ?? ""),
              createdAt: new Date().toISOString(),
            });
            setDialogOpen(false);
          }}
        >
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="username" label="Username" defaultValue={editing?.username || ""} required mono placeholder="Unique login username" />
          <Input name="email" label="Email" type="email" defaultValue={editing?.email || ""} required mono />
          {!editing && <Input name="password" label="Password" type="password" required minLength={6} />}
          <Select
            name="role"
            label="Role"
            defaultValue={editing?.role || roleOptions[roleOptions.length - 1]?.value || "SUB_ADMIN"}
            options={roleOptions}
            hint="Only roles below your own are listed."
          />
        </form>
      </Dialog>

      <Dialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        title={`Change password — ${passwordTarget?.name}`}
        icon={IconLock}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPasswordDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="admin-password-form">Update password</Button>
          </>
        }
      >
        <form id="admin-password-form" onSubmit={handleChangePassword}>
          <Input
            name="newPassword"
            type="password"
            label="New password"
            placeholder="Min 6 characters"
            required
            minLength={6}
            value={pwNewPassword}
            onChange={(e) => setPwNewPassword(e.target.value)}
          />
          <Input
            name="confirmPassword"
            type="password"
            label="Confirm new password"
            placeholder="Repeat it"
            required
            minLength={6}
            value={pwConfirmPassword}
            onChange={(e) => setPwConfirmPassword(e.target.value)}
            error={passwordError || undefined}
            hint="Takes effect when you save — the account keeps its old password until then."
          />
        </form>
      </Dialog>
    </Card>
  );
}
