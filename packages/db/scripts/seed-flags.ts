import { FLAG_DEFINITIONS } from "@repo/shared/flags";
import { prisma } from "../src/index";

/**
 * Bring the FeatureFlag table in line with the registry. Additive and
 * re-runnable — nothing here deletes, and nothing here reads.
 *
 * Deliberately NOT part of packages/db/seed.ts: that script opens by dropping
 * every content table, and a flag seed has to be safe to run against a live
 * database on any afternoon.
 *
 * **`update` never touches `enabled`.** That is the single rule this script
 * exists to obey. Re-seeding after a deploy must not switch a section back on
 * that somebody turned off on purpose — the registry owns a flag's label,
 * description and initial value, and the admin owns its current one from the
 * moment the row exists.
 */
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

  // Flags the registry no longer declares are reported, never deleted — a stray
  // row is harmless (nothing reads it) and deleting one would throw away the
  // note saying why it was switched off.
  const known = new Set(FLAG_DEFINITIONS.map((d) => d.key as string));
  const orphans = rows.filter((r) => !known.has(r.key));
  if (orphans.length > 0) {
    console.log(`\n${orphans.length} row(s) not in the registry (left alone):`);
    for (const o of orphans) console.log(`  ${o.key}`);
  }
}

await seedFlags();
process.exit(0);
