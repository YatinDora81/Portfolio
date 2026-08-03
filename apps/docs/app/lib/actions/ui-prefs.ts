"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { RAIL_COOKIE } from "@/lib/ui-prefs";

/**
 * Whether the sidebar is railed, as a cookie rather than as client state.
 *
 * The rule this exists to satisfy: the collapsed width has to be known by the
 * SERVER render. Reading it in a `useEffect` means every load of a railed route
 * paints a 254px sidebar and snaps to 58px after hydration — the same class of
 * flash that the inline theme script in apps/web/app/layout.tsx exists to
 * prevent, and far more visible, because it shoves the entire page sideways.
 *
 * Three states, not two. Absent means "follow whatever the route wants", which
 * is how /notes gets a railed sidebar without anyone having chosen it and
 * without that choice sticking to the rest of the admin. "1" and "0" are an
 * explicit decision and outrank the route.
 */
export async function setRailPref(value: "1" | "0" | null) {
  if (!(await getSession())) redirect("/login");
  const jar = await cookies();
  if (value === null) jar.delete(RAIL_COOKIE);
  else jar.set(RAIL_COOKIE, value, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
