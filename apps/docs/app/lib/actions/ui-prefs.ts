"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { RAIL_COOKIE } from "@/lib/ui-prefs";

// absent means the route decides; "1" and "0" outrank it
export async function setRailPref(value: "1" | "0" | null) {
  if (!(await getSession())) redirect("/login");
  const jar = await cookies();
  if (value === null) jar.delete(RAIL_COOKIE);
  else jar.set(RAIL_COOKIE, value, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
