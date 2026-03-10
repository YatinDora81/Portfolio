import { prisma } from "db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, purpose, message } = body;

    if (!name || !email || !message) {
      return Response.json({ error: "Name, email, and message are required" }, { status: 400 });
    }

    await prisma.contactMessage.create({
      data: { name, email, purpose: purpose || null, message },
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }
}
