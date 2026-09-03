-- AlterTable
ALTER TABLE "Agency" ADD COLUMN "clerkOrgId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL,
ALTER COLUMN "agencyId" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Agency_clerkOrgId_key" ON "Agency"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
