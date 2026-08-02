import { redirect } from "next/navigation";

/**
 * Folded into /about with the bio paragraphs — see the sibling stub. The
 * education table itself moved up one level to `about/education-table.tsx`
 * unchanged, so the staged entity and every action behind it are the same.
 */
export default function AboutEducationRedirect() {
  redirect("/about");
}
