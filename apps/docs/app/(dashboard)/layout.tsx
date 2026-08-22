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

  /**
   * The scheduled-publish tick. There is no cron in this project, so publishing
   * happens on requests that are already being served — and this layout is the
   * widest net the admin app has: it wraps every dashboard route, so opening the
   * inbox or the projects list ticks the queue, not just landing on /dashboard.
   * Putting it in dashboard/page.tsx instead would mean a post scheduled for
   * Tuesday waits until someone happens to visit that one page, which is the
   * page an admin opens least once they know their way around.
   *
   * It sits after the session check deliberately: an unauthenticated hit
   * redirects before this line and buys no database work.
   *
   * `after()` so the tick never delays a byte of the page — it runs once the
   * response is done. The try/catch is not defensive habit: an unhandled throw
   * inside `after()` takes down the whole invocation, which would turn a dropped
   * database connection during a publish into a dashboard that will not load at
   * all. And no `after()` nested inside this one; `maybePublishDue` does its own
   * work inline.
   *
   * Cheap by construction — `maybePublishDue` keeps a module-scope memo and
   * usually returns without touching the database at all.
   *
   * TODO(phase-06): `/api/collect` becomes the primary trigger, fired by public
   * page views rather than admin visits. This stays as the fallback for a site
   * with no traffic on the day something is due.
   */
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
