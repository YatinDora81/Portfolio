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

  // The scheduled-publish tick. An unhandled throw inside `after()` takes down the
  // whole invocation, so the try/catch is required, not defensive.
  // TODO(phase-06): `/api/collect` becomes the primary trigger, fired by public
  // page views rather than admin visits. This stays as the fallback for a site
  // with no traffic on the day something is due.
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
    // Drives the Inbox badge in the sidebar. Counts the enum, not the legacy
    // `read` boolean, so an archived or spam-filed message stops nagging.
    prisma.contactMessage.count({ where: { status: "UNREAD" } }),
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
