import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "db";
import { maybePublishDue } from "db/publish-due";
import { logger } from "@repo/shared/logger";
import { getSession } from "@/lib/session";
import { RAIL_COOKIE } from "@/lib/ui-prefs";
import { Shell } from "@/components/layout/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // an unhandled throw inside after() takes down the whole invocation
  after(async () => {
    try {
      const published = await maybePublishDue();
      if (published.length > 0) {
        logger.info("publish-due", "published scheduled content", {
          count: published.length,
          items: published.map((p) => `${p.type}:${p.id}`),
        });
      }
    } catch (e) {
      logger.error("publish-due", "scheduled publish tick failed", { err: String(e) });
    }
  });

  const [unread, jar] = await Promise.all([
    prisma.contactMessage.count({ where: { status: "UNREAD" } }),
    cookies(),
  ]);

  const rail = jar.get(RAIL_COOKIE)?.value;

  return (
    <Shell user={session} unread={unread} rail={rail === "1" ? true : rail === "0" ? false : null}>
      {children}
    </Shell>
  );
}
