-- Office Attendance Foundation V1 — additive only.
--
-- NO DROP COLUMN. NO RENAME. NO DROP NOT NULL. NO destructive statement.
-- Every new column is nullable OR carries a DEFAULT, so existing rows need no
-- manual backfill:
--   * Shift.kind       -> 'ROTA' for every existing row (column DEFAULT)
--   * Shift.locationId  -> NULL   for every existing row
--   * ClockEvent.locationId / AttendanceMonitor.locationId / Timesheet.locationId
--                      -> NULL   for every existing row
-- Care attendance (Shift -> House -> House geofence -> ClockEvent ->
-- AttendanceMonitor -> Timesheet) is behaviourally unchanged: houseId stays
-- REQUIRED on Shift, ClockEvent, AttendanceMonitor and Timesheet, and no
-- existing write path is modified. The new locationId columns and the ShiftKind
-- enum are foundation only — nothing in the application reads or sets them yet.

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('ROTA', 'FIXED', 'FLEXIBLE');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "kind" "ShiftKind" NOT NULL DEFAULT 'ROTA',
ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "AttendanceMonitor" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "Shift_agencyId_locationId_idx" ON "Shift"("agencyId", "locationId");

-- CreateIndex
CREATE INDEX "ClockEvent_locationId_idx" ON "ClockEvent"("locationId");

-- CreateIndex
CREATE INDEX "AttendanceMonitor_locationId_idx" ON "AttendanceMonitor"("locationId");

-- CreateIndex
CREATE INDEX "Timesheet_locationId_idx" ON "Timesheet"("locationId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceMonitor" ADD CONSTRAINT "AttendanceMonitor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
