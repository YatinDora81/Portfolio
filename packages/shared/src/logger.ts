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

// Never pass a secret, token, raw IP, user-agent or message body as `meta`.
export const logger = {
  info: (scope: string, msg: string, meta?: unknown) => log("info", scope, msg, meta),
  warn: (scope: string, msg: string, meta?: unknown) => log("warn", scope, msg, meta),
  error: (scope: string, msg: string, meta?: unknown) => log("error", scope, msg, meta),
};
