-- AlterTable: rename passwordHash to password
ALTER TABLE "AdminUser" RENAME COLUMN "passwordHash" TO "password";
