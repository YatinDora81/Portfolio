type Level = "info" | "warn" | "error";

function log(level: Level, scope: string, msg: string, meta?: unknown): void {
  const line = {
    level,
    scope,
    msg,
    ts: new Date().toISOString(),
    ...(meta === undefined ? {} : { meta }),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

/**
 * One JSON object per line, so a log drain can index the fields instead of
 * regex-ing prose.
 *
 * Never pass a secret, a token, a raw IP, a full user-agent string or a message
 * body as `meta`. Logs outlive the request and are readable by anyone with
 * dashboard access; the analytics design in particular spends real effort never
 * writing an IP to disk, and one careless log line would undo it.
 */
export const logger = {
  info: (scope: string, msg: string, meta?: unknown) => log("info", scope, msg, meta),
  warn: (scope: string, msg: string, meta?: unknown) => log("warn", scope, msg, meta),
  error: (scope: string, msg: string, meta?: unknown) => log("error", scope, msg, meta),
};
