-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_OPEN';
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_CLAIMED_YOU';
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_CLAIMED_OTHER';

-- AlterEnum
ALTER TYPE "ShiftStatus" ADD VALUE 'OPEN';
ALTER TYPE "ShiftStatus" ADD VALUE 'CLAIMED';

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_workerId_fkey";

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "eligibleRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "workerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ShiftClaim" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftClaim_workerId_idx" ON "ShiftClaim"("workerId");

-- CreateIndex
CREATE INDEX "ShiftClaim_shiftId_idx" ON "ShiftClaim"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftClaim_shiftId_workerId_key" ON "ShiftClaim"("shiftId", "workerId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftClaim" ADD CONSTRAINT "ShiftClaim_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftClaim" ADD CONSTRAINT "ShiftClaim_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
