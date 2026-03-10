import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

if (!process.env.REVALIDATE_SECRET) throw new Error("REVALIDATE_SECRET environment variable is required");
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

export async function POST(request: NextRequest) {
  const { secret } = await request.json();

  if (secret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  revalidatePath("/");
  return NextResponse.json({ revalidated: true, now: Date.now() });
}
