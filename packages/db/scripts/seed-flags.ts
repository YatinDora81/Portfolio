import { FLAG_DEFINITIONS } from "@repo/shared/flags";
import { prisma } from "../src/index";

async function seedFlags() {
  let created = 0;
  let updated = 0;

  for (const def of FLAG_DEFINITIONS) {
    const before = await prisma.featureFlag.findUnique({
      where: { key: def.key },
      select: { key: true },
    });

    await prisma.featureFlag.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        label: def.label,
        description: def.description,
        enabled: def.defaultEnabled,
      },
      update: { label: def.label, description: def.description },
    });

    if (before) updated += 1;
    else created += 1;
  }

  const rows = await prisma.featureFlag.findMany({
    orderBy: { key: "asc" },
    select: { key: true, enabled: true },
  });

  console.log(`flags: ${created} created, ${updated} refreshed`);
  for (const r of rows) console.log(`  ${r.enabled ? "on " : "off"}  ${r.key}`);

  const known = new Set(FLAG_DEFINITIONS.map((d) => d.key as string));
  const orphans = rows.filter((r) => !known.has(r.key));
  if (orphans.length > 0) {
    console.log(`\n${orphans.length} row(s) not in the registry (left alone):`);
    for (const o of orphans) console.log(`  ${o.key}`);
  }
}

await seedFlags();
process.exit(0);
