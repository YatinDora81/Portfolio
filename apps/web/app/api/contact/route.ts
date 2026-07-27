import { prisma } from "db";

/**
 * Public, unauthenticated write endpoint — the only one that reaches
 * contactMessage — so every field is bounded and typed here. A truthiness
 * check alone let a caller store megabytes, a non-string, or a bogus address
 * that makes the message impossible to reply to.
 */
const MAX = { name: 100, email: 254, purpose: 100, message: 5000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Non-strings collapse to "" so they fail the required check. */
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  // Refuse oversized payloads before buffering them into memory.
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > 64_000) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // A malformed body is the caller's fault — 400, not 500.
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const name = str(b.name);
  const email = str(b.email);
  const message = str(b.message);
  const purpose = str(b.purpose);

  if (!name || !email || !message) {
    return Response.json({ error: "Name, email, and message are required" }, { status: 400 });
  }
  if (
    name.length > MAX.name ||
    email.length > MAX.email ||
    message.length > MAX.message ||
    purpose.length > MAX.purpose
  ) {
    return Response.json({ error: "One or more fields exceed the maximum length" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  try {
    // Only accept a purpose the site actually offers, so the column can't be
    // used as free-form storage.
    let safePurpose: string | null = null;
    if (purpose) {
      const known = await prisma.contactPurpose.findFirst({
        where: { label: purpose },
        select: { label: true },
      });
      safePurpose = known?.label ?? null;
    }

    await prisma.contactMessage.create({
      data: { name, email, purpose: safePurpose, message },
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }
}
