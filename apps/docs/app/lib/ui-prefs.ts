/**
 * Cookie names for preferences the SERVER has to know before it renders.
 *
 * Separate from `lib/actions/ui-prefs.ts` because a `"use server"` module may
 * only export async functions: a single `export const` there is not a warning,
 * it invalidates every export in the file, and the build fails on the imports
 * rather than on the constant.
 */

/** `"1"` railed · `"0"` pinned open · absent means follow the route. */
export const RAIL_COOKIE = "cr_rail";
