-- FLEXIBLE Staff Attendance V1 (foundation) — single additive/safe change.
--
-- Makes Shift.endTime nullable so a FLEXIBLE shift materialised at clock-in
-- can exist while the worker is still clocked in (there is no scheduled end
-- to store yet) and later be set to the real clock-out time on completion.
--
-- ROTA and FIXED shift creation/update continue to REQUIRE endTime — that is
-- enforced at the application layer (validators.createShift / updateShift's
-- `.notEmpty()` on `endTime`) and by shiftService.assertShiftAttendanceTarget,
-- which still rejects `kind: 'FLEXIBLE'` shift creation entirely. No code path
-- in this phase can produce a Shift row with endTime = null: this migration is
-- a pure DROP NOT NULL, additive and inert until FLEXIBLE clock-in is built.
--
-- No data rewrite, no sentinel/backfill values, no other column touched.
-- Shift.date and Shift.startTime remain required, unchanged.

ALTER TABLE "Shift" ALTER COLUMN "endTime" DROP NOT NULL;
