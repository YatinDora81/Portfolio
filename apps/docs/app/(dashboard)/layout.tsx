import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "db";
import { getSession } from "@/lib/session";
import { RAIL_COOKIE } from "@/lib/ui-prefs";
import { Shell } from "@/components/layout/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [unread, jar] = await Promise.all([
    // Drives the Inbox badge in the sidebar.
    prisma.contactMessage.count({ where: { read: false } }),
    cookies(),
  ]);

  // Read here, on the server, so a railed sidebar is 58px in the first paint.
  // Deferring it to the client costs a visible sideways lurch on every load.
  const rail = jar.get(RAIL_COOKIE)?.value;

  return (
    <Shell user={session} unread={unread} rail={rail === "1" ? true : rail === "0" ? false : null}>
      {children}
    </Shell>
  );
}
