import { redirect } from "next/navigation";
import { prisma } from "db";
import { getSession } from "@/lib/session";
import { Shell } from "@/components/layout/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Drives the Inbox badge in the sidebar.
  const unread = await prisma.contactMessage.count({ where: { read: false } });

  return (
    <Shell user={session} unread={unread}>
      {children}
    </Shell>
  );
}
