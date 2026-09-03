-- CreateEnum
CREATE TYPE "AccrualMethod" AS ENUM ('FLAT_RATE', 'HOURLY', 'LUMP_SUM');

-- CreateEnum
CREATE TYPE "PayPeriod" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "LeaveLedgerType" AS ENUM ('ACCRUAL', 'CARRY_OVER', 'ADJUSTMENT', 'RESET');

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeaveAccrualProfile" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "AccrualMethod" NOT NULL DEFAULT 'FLAT_RATE',
    "payPeriod" "PayPeriod" NOT NULL DEFAULT 'MONTHLY',
    "flatRateHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourlyAccrualRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lumpSumHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accrualStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balanceCeilingHours" DOUBLE PRECISION,
    "carryOverCapHours" DOUBLE PRECISION,
    "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveAccrualProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleStartDate" TIMESTAMP(3) NOT NULL,
    "carriedOverHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accruedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastAccrualAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedgerEntry" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LeaveLedgerType" NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAccrualProfile_userId_key" ON "LeaveAccrualProfile"("userId");

-- CreateIndex
CREATE INDEX "LeaveAccrualProfile_agencyId_idx" ON "LeaveAccrualProfile"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_userId_key" ON "LeaveBalance"("userId");

-- CreateIndex
CREATE INDEX "LeaveBalance_agencyId_idx" ON "LeaveBalance"("agencyId");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_agencyId_idx" ON "LeaveLedgerEntry"("agencyId");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_userId_idx" ON "LeaveLedgerEntry"("userId");

-- AddForeignKey
ALTER TABLE "LeaveAccrualProfile" ADD CONSTRAINT "LeaveAccrualProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAccrualProfile" ADD CONSTRAINT "LeaveAccrualProfile_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
