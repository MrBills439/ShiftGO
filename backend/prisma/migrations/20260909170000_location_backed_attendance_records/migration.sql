-- Location-Backed Attendance Records V1 — additive/safe only.
--
-- Makes houseId nullable on ClockEvent, AttendanceMonitor and Timesheet so an
-- attendance record can target a House (ROTA) OR a Location (FIXED), mirroring
-- the Shift.houseId change from Location-Backed Shift V1. No FK is dropped, no
-- column is renamed, no existing row is touched or backfilled: every existing
-- attendance record keeps its current houseId, and locationId stays NULL for
-- all of them. "Exactly one target" is enforced at the application layer
-- (attendanceTargetFields / shiftTargetRejection in clockService), not by a
-- DB constraint.

ALTER TABLE "ClockEvent" ALTER COLUMN "houseId" DROP NOT NULL;
ALTER TABLE "AttendanceMonitor" ALTER COLUMN "houseId" DROP NOT NULL;
ALTER TABLE "Timesheet" ALTER COLUMN "houseId" DROP NOT NULL;
