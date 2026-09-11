-- Location-Backed Shift V1 — single additive/safe change.
--
-- Makes Shift.houseId nullable so a Shift can target a House (ROTA) OR a
-- Location (FIXED). The House foreign key is NOT dropped or recreated, nothing
-- is renamed, and no existing data is touched or backfilled: every existing
-- Shift row keeps its current houseId, and locationId stays NULL for all of
-- them. "Exactly one target" is enforced at the application layer
-- (shiftService.assertShiftAttendanceTarget), not by a DB constraint.
--
-- ClockEvent.houseId, AttendanceMonitor.houseId and Timesheet.houseId are
-- intentionally left required in this migration.

ALTER TABLE "Shift" ALTER COLUMN "houseId" DROP NOT NULL;
