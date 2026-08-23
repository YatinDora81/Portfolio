import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

// Without the global, every hot reload leaks another client and pg pool.
const globalForPrisma = globalThis as { __prisma?: PrismaClient };

const prisma =
  globalForPrisma.__prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

export { prisma };
export type * from "./generated/prisma/models";
export {
  ScoreType,
  ImageOrientation,
  AdminRole,
  NoteKind,
  RevalidationTrigger,
  RevalidationStatus,
  ContentStatus,
  MessageStatus,
  EventType,
} from "./generated/prisma/enums";
/**
 * The generated input types — `Prisma.NoteNodeWhereInput` and friends. Exported
 * so a caller can *build* a query as a value and hand it to a `findMany`, which
 * is what compiling the notes search language to SQL needs; every other model
 * here is queried with an inline literal and never needed it.
 */
export { Prisma } from "./generated/prisma/client";