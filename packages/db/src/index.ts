import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
export type * from "./generated/prisma/models";
export {
  ScoreType,
  ImageOrientation,
  AdminRole,
  NoteKind,
  RevalidationTrigger,
  RevalidationStatus,
} from "./generated/prisma/enums";
/**
 * The generated input types — `Prisma.NoteNodeWhereInput` and friends. Exported
 * so a caller can *build* a query as a value and hand it to a `findMany`, which
 * is what compiling the notes search language to SQL needs; every other model
 * here is queried with an inline literal and never needed it.
 */
export { Prisma } from "./generated/prisma/client";