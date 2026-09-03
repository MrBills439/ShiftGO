-- Add "urgent" flag to Shift (replaces the old EMERGENCY shift type — an
-- emergency is really just an urgently-needed cover, not a distinct
-- scheduling pattern like the other shift types).
ALTER TABLE "Shift" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

-- Rebuild ShiftType: DAY -> LONG_DAY, add MID_DAY, drop EMERGENCY.
-- Existing DAY and EMERGENCY rows both map to LONG_DAY (no data at time of
-- writing had EMERGENCY, but map it defensively rather than erroring).
ALTER TYPE "ShiftType" RENAME TO "ShiftType_old";
CREATE TYPE "ShiftType" AS ENUM ('LONG_DAY', 'MID_DAY', 'WAKE_NIGHT', 'SLEEP_IN');

ALTER TABLE "Shift" ALTER COLUMN "shiftType" DROP DEFAULT;
ALTER TABLE "Shift" ALTER COLUMN "shiftType" TYPE "ShiftType" USING (
  CASE "shiftType"::text
    WHEN 'DAY' THEN 'LONG_DAY'
    WHEN 'EMERGENCY' THEN 'LONG_DAY'
    ELSE "shiftType"::text
  END
)::"ShiftType";
ALTER TABLE "Shift" ALTER COLUMN "shiftType" SET DEFAULT 'LONG_DAY';

DROP TYPE "ShiftType_old";
