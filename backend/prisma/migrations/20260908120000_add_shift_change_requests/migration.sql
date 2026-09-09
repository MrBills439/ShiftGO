-- CreateEnum
CREATE TYPE "ShiftChangeType" AS ENUM ('COVER', 'SWAP');

-- CreateEnum
CREATE TYPE "ShiftChangeStatus" AS ENUM ('PENDING_RECIPIENT', 'PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShiftChangeRecipientResponse" AS ENUM ('ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "ShiftChangeRequest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "type" "ShiftChangeType" NOT NULL,
    "status" "ShiftChangeStatus" NOT NULL DEFAULT 'PENDING_RECIPIENT',
    "requesterId" TEXT NOT NULL,
    "primaryShiftId" TEXT NOT NULL,
    "targetWorkerId" TEXT,
    "swapShiftId" TEXT,
    "requesterReason" TEXT,
    "recipientRespondedAt" TIMESTAMP(3),
    "recipientResponse" "ShiftChangeRecipientResponse",
    "managerId" TEXT,
    "managerDecisionAt" TIMESTAMP(3),
    "managerReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_agencyId_status_idx" ON "ShiftChangeRequest"("agencyId", "status");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_requesterId_status_idx" ON "ShiftChangeRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_targetWorkerId_status_idx" ON "ShiftChangeRequest"("targetWorkerId", "status");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_primaryShiftId_idx" ON "ShiftChangeRequest"("primaryShiftId");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_swapShiftId_idx" ON "ShiftChangeRequest"("swapShiftId");

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_targetWorkerId_fkey" FOREIGN KEY ("targetWorkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_primaryShiftId_fkey" FOREIGN KEY ("primaryShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_swapShiftId_fkey" FOREIGN KEY ("swapShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

