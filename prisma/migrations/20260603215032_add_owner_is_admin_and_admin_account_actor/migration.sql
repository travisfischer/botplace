-- AlterEnum
ALTER TYPE "AuditActorKind" ADD VALUE 'ADMIN_ACCOUNT';

-- AlterTable
ALTER TABLE "owners" ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "owners_is_admin_idx" ON "owners"("is_admin");
