const endpointOf = (u: string) =>
  new URL(u.replace(/^postgres(ql)?:\/\//, "https://")).hostname.split(".")[0]!.replace(/-pooler$/, "");

export function confirmTarget(what: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  let endpoint: string;
  try {
    endpoint = endpointOf(url);
  } catch {
    console.error("DATABASE_URL cannot be parsed as a connection string");
    process.exit(1);
  }

  const given = process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .find(([k]) => k === "i-am-sure")?.[1];

  if (given !== endpoint) {
    console.error(`refusing: ${what} against endpoint ${endpoint}`);
    console.error(`this is destructive and there is no undo. to mean it, pass:`);
    console.error(`  --i-am-sure=${endpoint}`);
    process.exit(1);
  }

  return endpoint;
}
