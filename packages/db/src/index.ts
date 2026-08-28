import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

// without this, every hot reload leaks a client and pool
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
export { Prisma } from "./generated/prisma/client";
