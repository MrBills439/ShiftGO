-- Add timesheet review status and rejection metadata.
CREATE TYPE "TimesheetStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Timesheet"
ADD COLUMN "status" "TimesheetStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "Timesheet"
SET
  "status" = 'APPROVED',
  "reviewedById" = "confirmedById",
  "reviewedAt" = "confirmedAt"
WHERE "confirmedAt" IS NOT NULL OR "autoConfirmed" = true;

ALTER TABLE "Timesheet"
ADD CONSTRAINT "Timesheet_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_timesheet_status" ON "Timesheet"("status");
CREATE INDEX "idx_timesheet_reviewed_by" ON "Timesheet"("reviewedById");
