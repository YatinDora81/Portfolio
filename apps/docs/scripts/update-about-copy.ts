import { prisma } from "db";
import { WHERE, draft, labelOf } from "@/lib/audit";
import { commitAudit } from "@/lib/audit-writer";

/**
 * Rewrites the two About paragraphs and records the edit in the admin's change
 * history, in one transaction — a script that writes content behind the
 * dashboard's back otherwise leaves the log insisting nothing happened.
 *
 * It lives here rather than in `packages/db/scripts` because the audit draft is
 * an apps/docs module: reaching down from the app into the database package is
 * the direction the dependency already runs, and the reverse only resolves by
 * accident.
 *
 * Idempotent: rows are matched on sortOrder, a row already holding the new text
 * is skipped, and an empty draft writes no event — so a second run changes
 * nothing in either the table or the history.
 *
 * It deliberately does NOT publish. The site serves this section from ISR, so
 * the new copy reaches visitors when someone presses Publish in the admin.
 *
 * Run from `apps/docs`:
 *   bun run about:copy
 */

const ENTITY = "aboutParagraph";

const COPY = [
  {
    sortOrder: 0,
    content:
      "I'm a **Software Engineer** who builds production-grade web applications end to end. These days at **Wiingy** — architecting scheduling platforms, modernizing databases, and building the pipelines that ship it all.",
  },
  {
    sortOrder: 1,
    content:
      "I got my start at **Nykaa** on the My Orders team, building features and payment flows used by millions of users.",
  },
];

async function main() {
  // The history has to name somebody. Nobody is signed in here, so the change
  // is attributed to the owner account and `surface` records the door it came
  // through — "script" rather than "staging".
  const owner = await prisma.adminUser.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!owner) throw new Error("no OWNER account to attribute the change to");

  let changed = 0;

  await prisma.$transaction(async (tx) => {
    const d = draft("SAVE", "script", {
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
    });

    for (const { sortOrder, content } of COPY) {
      // Same tiebreak the admin and the site read with, so "row 1" here is the
      // row they both call first.
      const before = await tx.aboutParagraph.findFirst({
        where: { sortOrder },
        orderBy: { id: "asc" },
      });
      if (!before) throw new Error(`no About paragraph at sortOrder ${sortOrder}`);
      if (before.content === content) continue;

      await tx.aboutParagraph.update({ where: { id: before.id }, data: { content } });
      // Read back rather than trusting the payload — the log should record what
      // the column actually holds.
      const after = await tx.aboutParagraph.findUnique({ where: { id: before.id } });

      d.row({
        entity: ENTITY,
        entityLabel: WHERE[ENTITY],
        rowId: before.id,
        rowLabel: labelOf(ENTITY, after),
        kind: "UPDATE",
        before,
        after,
      });
      changed++;
    }

    await commitAudit(tx, d);
  });

  console.log(
    changed === 0
      ? "About copy already up to date — nothing written, no history entry"
      : `${changed} About paragraph${changed === 1 ? "" : "s"} rewritten and logged — open /history to see the diff, then Publish to put it live`
  );
}

main()
  .catch((e) => {
    console.error("update-about-copy failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
