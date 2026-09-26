import "server-only";
import QRCode from "qrcode";
import { prisma } from "db";
import { publicContentWhere } from "db/visibility";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

export function shortUrl(slug: string): string {
  return `${SITE}/r/${slug}`;
}

export function fullUrl(link: {
  destination: string;
  slug: string;
  channel: string;
  campaign: string | null;
}): string {
  const url = new URL(link.destination, SITE);
  url.searchParams.set("ref", link.slug);
  url.searchParams.set("utm_source", link.channel);
  if (link.campaign) url.searchParams.set("utm_campaign", link.campaign);
  return url.toString();
}

export async function qrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

export type DestinationOption = { value: string; label: string };

const PAGE_DESTINATIONS: DestinationOption[] = [
  { value: "/", label: "Home — top of the page" },
  { value: "/#about", label: "About" },
  { value: "/#skills", label: "Skills" },
  { value: "/#experience", label: "Experience" },
  { value: "/#projects", label: "Projects" },
  { value: "/#blogs", label: "Blogs" },
  { value: "/#contact", label: "Contact" },
];

export async function destinationOptions(): Promise<DestinationOption[]> {
  const posts = await prisma.blog.findMany({
    where: publicContentWhere(),
    select: { slug: true, title: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  return [
    ...PAGE_DESTINATIONS,
    ...posts.map((p) => ({ value: `/blog/${p.slug}`, label: `Post — ${p.title}` })),
  ];
}
