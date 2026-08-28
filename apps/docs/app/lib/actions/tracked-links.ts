"use server";

import { Prisma, prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHANNELS } from "@repo/shared/attribution";
import { logger } from "@repo/shared/logger";
import { generateSlug, safeDestination } from "@repo/shared/slug";
import { getSession } from "@/lib/session";
import { fullUrl, qrDataUrl, shortUrl } from "@/lib/tracked-links";

const SLUG_ATTEMPTS = 5;

const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null)
    .nullish();

const CreateInput = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give the link a label — it is the only thing that says what it was for.")
    .max(120, "Keep the label under 120 characters."),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: "Pick a channel from the list." }) }),
  campaign: optional(120, "Keep the campaign under 120 characters."),
  destination: z.string().trim().min(1, "A destination is required."),
  notes: optional(500, "Keep the notes under 500 characters."),
});

export interface TrackedLinkDto {
  id: string;
  slug: string;
  label: string;
  channel: string;
  campaign: string | null;
  destination: string;
  shortUrl: string;
  fullUrl: string;
  qr: string | null;
}

export interface CreateTrackedLinkResult {
  ok: boolean;
  link?: TrackedLinkDto;
  error?: string;
}

export async function createTrackedLink(input: {
  label: string;
  channel: string;
  campaign?: string | null;
  destination: string;
  notes?: string | null;
}): Promise<CreateTrackedLinkResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That link cannot be saved." };
  }

  const { label, channel, campaign, destination, notes } = parsed.data;

  const safe = safeDestination(destination);
  if (!safe) {
    return {
      ok: false,
      error:
        "A destination must be a path starting with / or a URL on yatindora.in. Anything else would turn this into an open redirect.",
    };
  }

  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const slug = generateSlug();
    try {
      const row = await prisma.trackedLink.create({
        data: {
          slug,
          label,
          channel,
          campaign: campaign ?? null,
          destination: safe,
          notes: notes ?? null,
          createdById: session.userId,
        },
        select: {
          id: true,
          slug: true,
          label: true,
          channel: true,
          campaign: true,
          destination: true,
        },
      });

      revalidatePath("/tracked-links");

      return { ok: true, link: await decorate(row) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        logger.warn("tracked-link", "slug collision, drawing again", { attempt });
        continue;
      }
      logger.error("tracked-link", "create failed", { err: String(e) });
      return { ok: false, error: "The link was not saved." };
    }
  }

  return { ok: false, error: "Could not find a free short code. Try again." };
}

export async function setTrackedLinkActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z.object({ id: z.string().uuid(), active: z.boolean() }).safeParse({ id, active });
  if (!parsed.success) return { ok: false, error: "That is not a link this server knows." };

  const { count } = await prisma.trackedLink.updateMany({
    where: { id: parsed.data.id },
    data: { active: parsed.data.active },
  });
  if (count === 0) return { ok: false, error: "That link no longer exists." };

  revalidatePath("/tracked-links");
  revalidatePath(`/tracked-links/${parsed.data.id}`);
  return { ok: true };
}

async function decorate(row: {
  id: string;
  slug: string;
  label: string;
  channel: string;
  campaign: string | null;
  destination: string;
}): Promise<TrackedLinkDto> {
  const short = shortUrl(row.slug);
  return { ...row, shortUrl: short, fullUrl: fullUrl(row), qr: await qrDataUrl(short) };
}
