"use server";

import { prisma } from "db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * The role model, enforced HERE rather than only in the table component.
 *
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so a signed-in browser can invoke them directly and never touch the UI
 * that hides the buttons. Middleware only proves the session cookie is a valid
 * JWT — it never inspects the role it carries. Without these checks the lowest
 * role could promote itself to OWNER, mint a new OWNER, or delete anyone.
 */
type Role = "OWNER" | "ADMIN" | "SUB_ADMIN";

const ROLE_LEVEL: Record<Role, number> = { OWNER: 3, ADMIN: 2, SUB_ADMIN: 1 };

function isRole(v: unknown): v is Role {
  return v === "OWNER" || v === "ADMIN" || v === "SUB_ADMIN";
}

function level(role: string): number {
  return isRole(role) ? ROLE_LEVEL[role] : 0;
}

/** The signed-in actor. Identity always comes from the cookie, never an argument. */
async function requireActor() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/** You may only act on, or hand out, a role strictly below your own. */
function assertOutranks(actorRole: string, targetRole: string, what: string) {
  if (level(actorRole) <= level(targetRole)) {
    throw new Error(`You don't have permission to ${what}`);
  }
}

export async function createAdminUser(formData: FormData) {
  const actor = await requireActor();

  const role = formData.get("role");
  const assigned: Role = isRole(role) ? role : "SUB_ADMIN";
  assertOutranks(actor.role, assigned, `create a ${assigned} account`);

  const password = formData.get("password") as string;
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({
    data: {
      email: formData.get("email") as string,
      username: formData.get("username") as string,
      password: hashedPassword,
      name: formData.get("name") as string,
      role: assigned,
    },
  });
  revalidatePath("/admin-users");
}

export async function updateAdminUser(id: string, formData: FormData) {
  const actor = await requireActor();

  const target = await prisma.adminUser.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw new Error("User not found");

  // Both ends are checked: you must outrank who they are today, AND the role
  // you're assigning must sit below your own — the second is what blocks an
  // actor from editing itself upward.
  assertOutranks(actor.role, target.role, "edit this account");

  const nextRole = formData.get("role");
  if (!isRole(nextRole)) throw new Error("Unknown role");
  assertOutranks(actor.role, nextRole, `assign the ${nextRole} role`);

  const data: {
    email: string;
    username: string;
    name: string;
    role: Role;
    password?: string;
  } = {
    email: formData.get("email") as string,
    username: formData.get("username") as string,
    name: formData.get("name") as string,
    role: nextRole,
  };
  const password = formData.get("password") as string;
  if (password) {
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    data.password = await bcrypt.hash(password, 10);
  }

  await prisma.adminUser.update({ where: { id }, data });
  revalidatePath("/admin-users");
}

export async function deleteAdminUser(id: string) {
  const actor = await requireActor();

  // The old signature took currentUserId as an argument and compared against
  // it, so any value the caller passed defeated this guard.
  if (id === actor.userId) throw new Error("You cannot delete your own account");

  const target = await prisma.adminUser.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw new Error("User not found");
  assertOutranks(actor.role, target.role, "delete this account");

  await prisma.adminUser.delete({ where: { id } });
  revalidatePath("/admin-users");
}
