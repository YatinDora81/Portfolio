import { prisma } from "db";
import type { ContentStatus } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteBlog } from "@/lib/actions/blogs";
import { previewLinkBlockedReason } from "@/lib/actions/preview-link";
import {
  IconPlus, IconPencil, IconArrowUpRight, IconAlertTriangle, IconPhotoOff, IconClock,
} from "@tabler/icons-react";
import { PreviewFrame, BlogsPreview } from "@/components/preview";
import { StatusBadge } from "@/components/lifecycle/status-badge";
import { StatusTabs } from "@/components/lifecycle/status-tabs";
import { RowActions } from "@/components/lifecycle/row-actions";
import { RunDueButton } from "@/components/lifecycle/run-due-button";
import { IST_ZONE, STATUS_LABEL, isContentStatus, istLabel } from "@/lib/lifecycle";
import { cn, cdnUrl } from "@/lib/utils";

/**
 * Every judgement on this page is made against the clock: whether a scheduled
 * post is overdue, whether a published one has reached its own date. A cached
 * render would answer both from whenever the cache was filled, which is exactly
 * the state in which this page is worse than nothing.
 */
export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

// The zone is named so SSR and hydration emit identical characters — same rule
// as the revalidation page. Date only: `publishedAt` is the editorial date the
// article prints, and it has never carried a meaningful time of day.
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_ZONE, day: "2-digit", month: "short", year: "numeric",
});

/** Rough reading time, same 200 wpm rule the site uses. */
const readMins = (content: string) =>
  Math.max(1, Math.round(content.trim().split(/\s+/).filter(Boolean).length / 200));

export default async function BlogsPage({ searchParams }: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: requested } = await searchParams;
  const active: ContentStatus | null = isContentStatus(requested) ? requested : null;

  const [blogs, previewBlocked] = await Promise.all([
    prisma.blog.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    previewLinkBlockedReason(),
  ]);

  const now = new Date();

  /**
   * "Live" is both halves of the public filter, not just the status: a post
   * marked PUBLISHED but dated next Tuesday fails `publishedAt <= now` and is
   * not on the site. The authority is `publicContentWhere` in db/visibility —
   * this is the same predicate applied to rows already in hand rather than a
   * second query, and it must not drift from it.
   */
  const isLive = (b: { status: ContentStatus; publishedAt: Date }) =>
    b.status === "PUBLISHED" && b.publishedAt <= now;

  const live = blogs.filter(isLive);
  const counts: Record<ContentStatus, number> = { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const b of blogs) counts[b.status] += 1;

  /**
   * A row that is still SCHEDULED after its own time has passed means nothing
   * has run the schedule. Worth calling out by name — the alternative is an
   * admin watching a post that says "Scheduled" and quietly assuming it went
   * out.
   */
  const overdue = blogs.filter(
    (b) => b.status === "SCHEDULED" && b.publishAt !== null && b.publishAt <= now
  );

  // Published, but dated ahead — the other way a post can look live and not be.
  const postdated = blogs.filter((b) => b.status === "PUBLISHED" && b.publishedAt > now);

  const rows = active === null ? blogs : blogs.filter((b) => b.status === active);

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 06"
        title="Blogs"
        description="Posts on the portfolio. Status is what decides who can see one: a published post is reachable at /blog/<slug>, and everything else exists only in here."
      >
        <Link href="/blogs/new">
          <Button size="sm"><IconPlus size={14} /> Add blog</Button>
        </Link>
      </PageHeader>

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">06</span>
        <div className="sec-anchor">
          <a href={`${SITE}/#blogs`} target="_blank" rel="noreferrer">
            #blogs <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        {/* Blogs is the one section whose emptiness is felt elsewhere: the
            navbar link and the terminal's `blogs` command are both derived. */}
        <div className="sec-reach">
          <span className="chip">also adds or removes the navbar link</span>
          <span className="chip">also the terminal&rsquo;s <code>blogs</code> command</span>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="rv-banner bad">
          <i><IconClock size={17} stroke={1.7} /></i>
          <div>
            <b>
              {overdue.length} scheduled post{overdue.length === 1 ? " is" : "s are"} past{" "}
              {overdue.length === 1 ? "its" : "their"} publish time and still scheduled
            </b>
            Nothing has run the schedule yet — the time passing does not publish anything by
            itself. Loading any admin page runs the sweep, so a reload of this page should be
            enough; use <b>Publish now</b> on the row if you would rather not wait. If a row is
            still here after a reload, the trigger itself is broken and Revalidation will say so.
            <RunDueButton />
          </div>
        </div>
      )}

      {live.length === 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>Nothing is published, so section 06 does not exist right now</b>
            With zero visible posts the site drops the whole Blogs section, removes{" "}
            <code>Blogs</code> from the navbar, and the About terminal stops offering{" "}
            <code>blogs</code> in <code>help</code>, <code>ls</code> and Tab-completion.
            {counts.DRAFT > 0 && (
              <> Moving one of the {counts.DRAFT} draft{counts.DRAFT === 1 ? "" : "s"} below to
                Published brings all three back.</>
            )}
          </div>
        </div>
      )}

      {postdated.length > 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>
              {postdated.length} post{postdated.length === 1 ? " is" : "s are"} Published but
              dated in the future
            </b>
            A visitor sees a post only when it is Published <em>and</em> its printed date has
            arrived, so {postdated.length === 1 ? "this one is" : "these are"} still invisible.
            That date is editorial — it is what the article and its OpenGraph card print — and
            the lifecycle deliberately never rewrites it, which is why no control here moves it.
            If the intent was to hold the post back, Scheduled is the field that does that.
          </div>
        </div>
      )}

      <Card flush className="wk-in">
        <CardHead title="Posts" count={blogs.length} />

        {blogs.length > 0 && (
          <div className="wk-meter">
            <div className="wk-fig"><b className={live.length ? undefined : "q"}>{live.length}</b><span>live</span></div>
            <div className="wk-fig"><b className={counts.SCHEDULED ? undefined : "q"}>{counts.SCHEDULED}</b><span>scheduled</span></div>
            <div className="wk-fig"><b className="q">{counts.DRAFT}</b><span>drafts</span></div>
            <div className="wk-fig">
              <b className="q">{live.reduce((n, b) => n + readMins(b.content), 0)}</b>
              <span>min of published reading</span>
            </div>
          </div>
        )}

        {blogs.length > 0 && (
          <StatusTabs base="/blogs" active={active} counts={counts} total={blogs.length} />
        )}

        {blogs.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconPencil size={18} stroke={1.5} /></div>
            <b>No posts written yet</b>
            <span>Section 06 and the navbar&rsquo;s Blogs link only appear once a post is published.</span>
            <Link href="/blogs/new">
              <Button size="sm"><IconPlus size={14} /> Write the first post</Button>
            </Link>
          </div>
        ) : active !== null && rows.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconPencil size={18} stroke={1.5} /></div>
            <b>No posts are {STATUS_LABEL[active].toLowerCase()}</b>
            <span>
              All {blogs.length} post{blogs.length === 1 ? " is" : "s are"} under a different tab —{" "}
              <Link href="/blogs" className="lc-link">show all</Link>.
            </span>
          </div>
        ) : (
          <div className="rows">
            {rows.map((b) => {
              const liveNow = isLive(b);
              const isOverdue = b.status === "SCHEDULED" && b.publishAt !== null && b.publishAt <= now;

              return (
                // The whole row used to carry `.dimmed` when it was not live,
                // which with every post a draft meant the entire list sat at
                // 45% — including the overdue warnings and the buttons that
                // answer them. The badge says the status now; only the cover
                // art fades, and only an archived row mutes its title.
                <div key={b.id} className={cn("row", "lc-row", b.status === "ARCHIVED" && "lc-arch")}>
                  {/* The card art the section leads with — a post with no
                      image draws a flat colour block on the site, and that
                      is worth seeing before it ships. */}
                  {b.image ? (
                    <span
                      className={cn("blg-thumb", !liveNow && "dimmed")}
                      style={{ backgroundImage: `url("${cdnUrl(b.image)}")` }}
                      title={`${b.imageOrientation} cover`}
                    />
                  ) : (
                    <span className={cn("blg-thumb", "none", !liveNow && "dimmed")} title="No cover image — the card falls back to its colour">
                      <IconPhotoOff size={13} stroke={1.4} />
                    </span>
                  )}

                  <div className="row-main">
                    <div className="row-t">{b.title}</div>
                    <div className="row-m" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                      /blog/{b.slug} · {dateFmt.format(b.publishedAt)} · {readMins(b.content)} min
                    </div>

                    {b.status === "SCHEDULED" && b.publishAt !== null && !isOverdue && (
                      <div className="lc-line">
                        <IconClock size={12} stroke={1.6} /> goes live {istLabel(b.publishAt)}
                      </div>
                    )}

                    {isOverdue && b.publishAt !== null && (
                      <div className="lc-line bad">
                        <IconAlertTriangle size={12} stroke={1.7} /> was due {istLabel(b.publishAt)} and
                        is still scheduled — nothing has run the schedule
                      </div>
                    )}

                    {b.status === "PUBLISHED" && b.publishedAt > now && (
                      <div className="lc-line bad">
                        <IconAlertTriangle size={12} stroke={1.7} /> dated{" "}
                        {dateFmt.format(b.publishedAt)}, so it is not visible until then
                      </div>
                    )}

                    <RowActions
                      kind="blog"
                      id={b.id}
                      slug={b.slug}
                      title={b.title}
                      status={b.status}
                      previewBlocked={previewBlocked}
                    />
                  </div>

                  <div className="row-acts lc-row-acts">
                    <StatusBadge status={b.status} />
                    {liveNow && (
                      <a
                        className="ibtn"
                        href={`${SITE}/blog/${b.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${b.title} on the site`}
                        title="Open on the site"
                      >
                        <IconArrowUpRight size={14} stroke={1.5} className="nudge" />
                      </a>
                    )}
                    <Link href={`/blogs/${b.id}`} className="ibtn" aria-label={`Edit ${b.title}`}>
                      <IconPencil size={13} stroke={1.5} />
                    </Link>
                    <DeleteButton label={`"${b.title}"`} onDelete={async () => { "use server"; await deleteBlog(b.id); }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* The pane is the public site's answer, so it follows the public filter
          rather than the tab above — a draft selected upstairs must not appear
          down here as if it had shipped. */}
      <PreviewFrame label={`Blogs Preview — the ${live.length} a visitor can see`}>
        <BlogsPreview
          blogs={live.map(b => ({
            title: b.title,
            description: b.description,
            image: b.image,
            imageOrientation: b.imageOrientation,
          }))}
        />
      </PreviewFrame>
    </div>
  );
}
