-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('DAY', 'WAKE_NIGHT', 'SLEEP_IN', 'EMERGENCY');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "shiftType" "ShiftType" NOT NULL DEFAULT 'DAY';

-- CreateIndex
CREATE INDEX "Shift_shiftType_idx" ON "Shift"("shiftType");
CREATE INDEX "Shift_agencyId_startTime_endTime_idx" ON "Shift"("agencyId", "startTime", "endTime");
CREATE INDEX "Shift_workerId_startTime_endTime_idx" ON "Shift"("workerId", "startTime", "endTime");
