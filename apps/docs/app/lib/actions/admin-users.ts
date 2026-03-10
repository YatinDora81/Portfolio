"use server";

import { prisma } from "db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

export async function createAdminUser(formData: FormData) {
  const password = formData.get("password") as string;
  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({
    data: {
      email: formData.get("email") as string,
      username: formData.get("username") as string,
      password: hashedPassword,
      name: formData.get("name") as string,
      role: (formData.get("role") as "OWNER" | "ADMIN" | "SUB_ADMIN") || "SUB_ADMIN",
    },
  });
  revalidatePath("/admin-users");
}

export async function updateAdminUser(id: string, formData: FormData) {
  const data: {
    email: string;
    username: string;
    name: string;
    role: "OWNER" | "ADMIN" | "SUB_ADMIN";
    password?: string;
  } = {
    email: formData.get("email") as string,
    username: formData.get("username") as string,
    name: formData.get("name") as string,
    role: formData.get("role") as "OWNER" | "ADMIN" | "SUB_ADMIN",
  };
  const password = formData.get("password") as string;
  if (password) data.password = await bcrypt.hash(password, 10);
  await prisma.adminUser.update({ where: { id }, data });
  revalidatePath("/admin-users");
}

export async function deleteAdminUser(id: string, currentUserId: string) {
  if (id === currentUserId) {
    throw new Error("You cannot delete your own account");
  }
  await prisma.adminUser.delete({ where: { id } });
  revalidatePath("/admin-users");
}
