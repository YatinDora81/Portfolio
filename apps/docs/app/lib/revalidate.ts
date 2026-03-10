if (!process.env.PORTFOLIO_URL) throw new Error("PORTFOLIO_URL environment variable is required");
if (!process.env.REVALIDATE_SECRET) throw new Error("REVALIDATE_SECRET environment variable is required");
const PORTFOLIO_URL = process.env.PORTFOLIO_URL;
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

export async function revalidatePortfolio() {
  try {
    await fetch(`${PORTFOLIO_URL}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: REVALIDATE_SECRET }),
    });
  } catch {
    // Silently fail - admin shouldn't break if portfolio is down
  }
}
