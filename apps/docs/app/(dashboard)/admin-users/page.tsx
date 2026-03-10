import { prisma } from "db";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { AdminUsersTable } from "./table";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div>
      <PageHeader title="Admin Users" description="Manage dashboard access" />
      <AdminUsersTable
        users={users.map(u => ({ id: u.id, email: u.email, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt.toISOString() }))}
        currentUser={{ userId: session.userId, role: session.role }}
      />
    </div>
  );
}
