import { redirect } from "next/navigation";

// folded into /hero; kept as a stub so bookmarks don't 404
export default function SocialLinksRedirect() {
  redirect("/hero");
}
