import { prisma } from "db";
import { redirect } from "next/navigation";
import { isStorageConfigured, missingStorageVars } from "@repo/storage/r2";
import { PageHeader } from "@/components/shared/page-header";
import { getSession } from "@/lib/session";
import { KEYS } from "@/lib/site-config-keys";
import { MediaLibrary, type MediaRow } from "./library";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

async function referenceSources(): Promise<{ label: string; text: string }[]> {
  const [projects, blogs, experiences, config] = await Promise.all([
    prisma.project.findMany({ select: { title: true, logoUrl: true, images: true } }),
    prisma.blog.findMany({ select: { title: true, image: true, content: true } }),
    prisma.experience.findMany({ select: { company: true, logoUrl: true } }),
    prisma.siteConfig.findMany({ select: { key: true, value: true } }),
  ]);

  return [
    ...projects.map((p) => ({
      label: `Project · ${p.title}`,
      text: [p.logoUrl ?? "", ...p.images].join("\n"),
    })),
    ...blogs.map((b) => ({ label: `Blog · ${b.title}`, text: `${b.image}\n${b.content}` })),
    ...experiences.map((e) => ({ label: `Experience · ${e.company}`, text: e.logoUrl ?? "" })),
    ...config.map((c) => ({
      label: `Site setting · ${KEYS[c.key]?.label ?? c.key}`,
      text: c.value,
    })),
  ].filter((s) => s.text.trim() !== "");
}

export default async function MediaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [assets, sources] = await Promise.all([
    prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" } }),
    referenceSources(),
  ]);

  const rows: MediaRow[] = assets.map((a) => ({
    id: a.id,
    key: a.key,
    url: a.url,
    filename: a.filename,
    mimeType: a.mimeType,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    blurDataUrl: a.blurDataUrl,
    altText: a.altText,
    folder: a.folder,
    createdAt: a.createdAt.toISOString(),
    createdLabel: stamp.format(a.createdAt),
    usedIn: sources.filter((s) => s.text.includes(a.key)).map((s) => s.label),
  }));

  return (
    <div className="view">
      <PageHeader
        eyebrow="library · images"
        title="Media"
        description="Every image uploaded through the admin, what it is described as, and whether anything on the site still points at it. Uploads go from your browser straight to R2 — nothing passes through this app."
      />

      <MediaLibrary
        rows={rows}
        storage={{ configured: isStorageConfigured(), missing: missingStorageVars() }}
        scanned={sources.length}
      />
    </div>
  );
}
