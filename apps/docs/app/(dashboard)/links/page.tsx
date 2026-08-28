import { redirect } from "next/navigation";

// folded into /hero; kept so old bookmarks don't 404
export default function LinksRedirect() {
  redirect("/hero");
}
