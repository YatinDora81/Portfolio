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

/**
 * Reads the body with a hard ceiling, streaming so an oversized one is dropped
 * rather than buffered. `content-length` alone is not a guard: it is absent on a
 * chunked request, which let any caller skip the check entirely and hand
 * `request.json()` a body of any size.
 */
async function readCapped(request: Request, cap: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > cap) return null;

  const body = request.body;
  if (!body) return request.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array()),
  );
}

export async function POST(request: Request) {
  const raw = await readCapped(request, 64_000);
  if (raw === null) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
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
