import { prisma } from "db";
import { WHERE, draft, labelOf } from "@/lib/audit";
import { commitAudit } from "@/lib/audit-writer";

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
      const before = await tx.aboutParagraph.findFirst({
        where: { sortOrder },
        orderBy: { id: "asc" },
      });
      if (!before) throw new Error(`no About paragraph at sortOrder ${sortOrder}`);
      if (before.content === content) continue;

      await tx.aboutParagraph.update({ where: { id: before.id }, data: { content } });
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
