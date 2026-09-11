-- CreateEnum
CREATE TYPE "FixedWorkPatternStatus" AS ENUM ('ACTIVE', 'ENDED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "fixedWorkPatternId" TEXT;

-- CreateTable
CREATE TABLE "FixedWorkPattern" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "timezone" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "FixedWorkPatternStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersedesId" TEXT,
    "createdById" TEXT NOT NULL,
    "overrideWeeklyLimit" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedWorkPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedWorkPatternDay" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "FixedWorkPatternDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedWorkPattern_supersedesId_key" ON "FixedWorkPattern"("supersedesId");

-- CreateIndex
CREATE INDEX "FixedWorkPattern_agencyId_idx" ON "FixedWorkPattern"("agencyId");

-- CreateIndex
CREATE INDEX "FixedWorkPattern_agencyId_workerId_status_idx" ON "FixedWorkPattern"("agencyId", "workerId", "status");

-- CreateIndex
CREATE INDEX "FixedWorkPattern_agencyId_locationId_idx" ON "FixedWorkPattern"("agencyId", "locationId");

-- CreateIndex
CREATE INDEX "FixedWorkPatternDay_patternId_idx" ON "FixedWorkPatternDay"("patternId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedWorkPatternDay_patternId_weekday_key" ON "FixedWorkPatternDay"("patternId", "weekday");

-- CreateIndex
CREATE INDEX "Shift_fixedWorkPatternId_idx" ON "Shift"("fixedWorkPatternId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_fixedWorkPatternId_fkey" FOREIGN KEY ("fixedWorkPatternId") REFERENCES "FixedWorkPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_overrideById_fkey" FOREIGN KEY ("overrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPattern" ADD CONSTRAINT "FixedWorkPattern_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "FixedWorkPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedWorkPatternDay" ADD CONSTRAINT "FixedWorkPatternDay_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "FixedWorkPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

