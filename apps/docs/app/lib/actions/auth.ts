"use server";

import { prisma } from "db";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { signToken } from "@/lib/auth";
import { getSession, setSessionCookie, clearSessionCookie } from "@/lib/session";
import { sendResetEmail } from "@/lib/mail";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const RESET_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function login(formData: FormData) {
  const identifier = formData.get("identifier") as string;
  const password = formData.get("password") as string;

  if (!identifier || !password) {
    return { error: "Username/email and password are required" };
  }

  // Try email first, then fall back to username
  const user = identifier.includes("@")
    ? await prisma.adminUser.findUnique({ where: { email: identifier } })
    : await prisma.adminUser.findUnique({ where: { username: identifier } });

  if (!user) {
    return { error: "Invalid credentials" };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return { error: "Invalid credentials" };
  }

  const token = await signToken({ userId: user.id, email: user.email, role: user.role });
  await setSessionCookie(token);
  redirect("/dashboard");
}

export async function changePassword(formData: FormData) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const targetUserId = formData.get("targetUserId") as string;
  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;
  const adminOverride = formData.get("adminOverride") === "true";

  const isOwnPassword = session.userId === targetUserId;

  // Only OWNER and ADMIN can change other users' passwords
  if (!isOwnPassword && session.role === "SUB_ADMIN") {
    return { error: "You can only change your own password" };
  }

  if (!newPassword || !confirmPassword) {
    return { error: "New password fields are required" };
  }

  // Current password required only when changing own password without admin override
  if (isOwnPassword && !adminOverride && !currentPassword) {
    return { error: "Current password is required" };
  }

  if (newPassword.length < 6) {
    return { error: "New password must be at least 6 characters" };
  }

  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match" };
  }

  // Verify current password for own password change (skip if admin override)
  if (isOwnPassword && !adminOverride) {
    const user = await prisma.adminUser.findUnique({ where: { id: targetUserId } });
    if (!user) return { error: "User not found" };

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return { error: "Current password is incorrect" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.adminUser.update({
    where: { id: targetUserId },
    data: { password: hashedPassword },
  });

  return { success: true };
}

export async function forgotPassword(formData: FormData) {
  const email = formData.get("email") as string;
  if (!email) return { error: "Email is required" };

  const user = await prisma.adminUser.findUnique({ where: { email } });
  // Always return success to avoid email enumeration
  if (!user) return { success: true };

  const token = await new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(RESET_SECRET);

  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3001";
  const protocol = headersList.get("x-forwarded-proto") || "http";
  const resetUrl = `${protocol}://${host}/reset-password?token=${token}`;

  await sendResetEmail(user.email, resetUrl);
  return { success: true };
}

export async function resetPassword(token: string, newPassword: string, confirmPassword: string) {
  if (!token) return { error: "Invalid reset link" };
  if (!newPassword || !confirmPassword) return { error: "Both fields are required" };
  if (newPassword.length < 6) return { error: "Password must be at least 6 characters" };
  if (newPassword !== confirmPassword) return { error: "Passwords do not match" };

  let payload: { userId: string; email: string };
  try {
    const result = await jwtVerify(token, RESET_SECRET);
    payload = result.payload as { userId: string; email: string };
  } catch {
    return { error: "Reset link has expired or is invalid" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.adminUser.update({
    where: { id: payload.userId },
    data: { password: hashedPassword },
  });

  return { success: true };
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
