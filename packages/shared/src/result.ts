/**
 * The return shape for anything crossing an API or server-action boundary.
 *
 * Throwing across those boundaries loses the type: a server action's rejection
 * reaches the client as a redacted "An error occurred in the Server Components
 * render", and a route handler's becomes a bare 500. A returned union keeps the
 * failure describable, which is the only way the caller can say anything useful
 * to the person who triggered it.
 */
export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E; code?: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(error: string, code?: string): Result<T> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
});
