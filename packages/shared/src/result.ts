export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E; code?: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(error: string, code?: string): Result<T> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
});
