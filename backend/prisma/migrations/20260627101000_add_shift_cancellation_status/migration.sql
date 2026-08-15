-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Shift"
ADD COLUMN "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" TEXT,
ADD COLUMN "cancellationReason" TEXT;

-- Backfill status from existing timesheet evidence.
UPDATE "Shift" AS s
SET "status" = 'COMPLETED'
FROM "Timesheet" AS t
WHERE t."shiftId" = s."id"
  AND t."clockOutAt" IS NOT NULL;

UPDATE "Shift" AS s
SET "status" = 'IN_PROGRESS'
FROM "Timesheet" AS t
WHERE t."shiftId" = s."id"
  AND t."clockInAt" IS NOT NULL
  AND t."clockOutAt" IS NULL
  AND s."status" = 'SCHEDULED';

-- AddForeignKey
ALTER TABLE "Shift"
ADD CONSTRAINT "Shift_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE INDEX "Shift_cancelledById_idx" ON "Shift"("cancelledById");
