import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteExperience } from "@/lib/actions/experiences";
import { cn, cdnUrl } from "@/lib/utils";
import {
  IconPlus, IconPencil, IconBriefcase, IconArrowUpRight, IconBuilding,
} from "@tabler/icons-react";
import { PreviewFrame, ExperiencePreview } from "@/components/preview";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

const DEFAULT_VISIBLE_BULLETS = 4;

function renderBullet(text: string) {
  return text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>
  );
}

export default async function ExperiencesPage() {
  const experiences = await prisma.experience.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, skills: { select: { name: true } } },
  });

  const withMark = experiences.filter(e => e.logoUrl).length;
  const current = experiences.find(e => e.isCurrent);

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 04"
        title="Experience"
        description="The career rail — roles in the order they appear, each showing the bullets the site keeps in its scan layer before it folds the rest away."
      >
        <Link href="/experiences/new">
          <Button size="sm"><IconPlus size={14} stroke={1.7} /> Add role</Button>
        </Link>
      </PageHeader>

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">04</span>
        <div className="sec-anchor">
          <a href={`${SITE}/#experience`} target="_blank" rel="noreferrer">
            #experience <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">also draws the About terminal&rsquo;s company marks</span>
        </div>
      </div>

      {experiences.length === 0 ? (
        <Card flush className="wk-in">
          <div className="empty">
            <div className="empty-ic"><IconBriefcase size={19} stroke={1.5} /></div>
            <b>The career rail is empty</b>
            <span>Visitors reach section 04 and find its heading and rail over nothing at all.</span>
            <Link href="/experiences/new" style={{ marginTop: 4 }}>
              <Button size="sm"><IconPlus size={14} stroke={1.7} /> Add the first role</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <Card flush className="wk-in">
            <div className="wk-meter" style={{ borderBottom: "none" }}>
              <div className="wk-fig"><b>{experiences.length}</b><span>roles</span></div>
              <div className="wk-fig">
                <b className={withMark === experiences.length ? undefined : "q"}>{withMark}</b>
                <span>with a company mark</span>
              </div>
              <div className="wk-fig">
                <b className={current ? undefined : "q"}>{current ? "1" : "0"}</b>
                <span>{current ? `current · ${current.company}` : "no current role"}</span>
              </div>
            </div>
          </Card>

          <div className="xp wk-in s1" style={{ marginTop: 14 }}>
            {experiences.map((exp) => {
              const fold = exp.visibleBullets > 0 ? exp.visibleBullets : DEFAULT_VISIBLE_BULLETS;
              const folded = Math.max(0, exp.bullets.length - fold);

              return (
                <div key={exp.id} className={cn("xp-item", exp.isCurrent && "now")}>
                  <Card>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      {exp.logoUrl ? (
                        <span className="xpr-mark" title="Company mark — also printed in the About terminal">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={cdnUrl(exp.logoUrl)} alt="" />
                        </span>
                      ) : (
                        <span className="xpr-mark none" title="No logo — the About terminal prints the name unadorned">
                          <IconBuilding size={16} stroke={1.4} />
                        </span>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="xpr-role">{exp.position}</div>
                        <div className="row-m">
                          {exp.company}{exp.location ? ` · ${exp.location}` : ""}
                        </div>
                      </div>

                      <span
                        className={cn("chip", exp.isCurrent && "amb")}
                        style={{ marginTop: 2, flex: "none", whiteSpace: "nowrap" }}
                      >
                        {exp.isCurrent && <span className="dot" />}
                        {exp.startDate} — {exp.endDate}
                      </span>

                      <div className="row-acts">
                        {exp.website && (
                          <a
                            className="ibtn"
                            href={exp.website}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${exp.company}`}
                          >
                            <IconArrowUpRight size={14} stroke={1.5} />
                          </a>
                        )}
                        <Link className="ibtn" href={`/experiences/${exp.id}`} aria-label={`Edit ${exp.company}`}>
                          <IconPencil size={13} stroke={1.5} />
                        </Link>
                        <DeleteButton
                          label={`"${exp.company}"`}
                          sub="Deleting the role removes its bullet points too, and its logo stops appearing in the About terminal. There's no undo here."
                          onDelete={async () => { "use server"; await deleteExperience(exp.id); }}
                        />
                      </div>
                    </div>

                    {exp.skills.length > 0 && (
                      <div className="pskills" style={{ marginTop: 11 }}>
                        {exp.skills.map((s) => (
                          <Badge key={s.name} variant="outline">{s.name}</Badge>
                        ))}
                      </div>
                    )}

                    {exp.bullets.length > 0 && (
                      <ul style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 5 }}>
                        {exp.bullets.map((b, i) => (
                          <li key={b.id} className={cn("xpr-b", i >= fold && "fold")}>
                            {renderBullet(b.content)}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="wk-cut" style={{ marginBottom: 0 }}>
                      {exp.bullets.length === 0
                        ? <>no bullets <span className="n">· the card is a heading only</span></>
                        : folded > 0
                          ? <>scan layer {fold} <span className="n">· {folded} more behind the toggle</span></>
                          : <>all {exp.bullets.length} shown <span className="n">· no toggle</span></>}
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        </>
      )}

      <PreviewFrame label="Experience Preview">
        <ExperiencePreview experiences={experiences.map(exp => ({ company: exp.company, position: exp.position, location: exp.location, startDate: exp.startDate, endDate: exp.endDate, isCurrent: exp.isCurrent, bullets: exp.bullets.map(b => b.content), technologies: exp.skills.map(s => s.name), visibleBullets: exp.visibleBullets, logoUrl: exp.logoUrl }))} />
      </PreviewFrame>
    </div>
  );
}
