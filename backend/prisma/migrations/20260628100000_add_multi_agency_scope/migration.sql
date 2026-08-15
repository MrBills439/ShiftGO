-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- Backfill current local/dev data into a single default agency.
INSERT INTO "Agency" ("id", "name", "createdAt", "updatedAt")
VALUES ('default-agency', 'Default Agency', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "House" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "Training" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
ALTER TABLE "DbsCheck" ADD COLUMN "agencyId" TEXT NOT NULL DEFAULT 'default-agency';

-- AlterTable
UPDATE "AuditLog" SET "agencyId" = 'default-agency' WHERE "agencyId" IS NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "agencyId" SET DEFAULT 'default-agency';
ALTER TABLE "AuditLog" ALTER COLUMN "agencyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "User_agencyId_idx" ON "User"("agencyId");

-- CreateIndex
CREATE INDEX "House_agencyId_idx" ON "House"("agencyId");

-- CreateIndex
CREATE INDEX "Shift_agencyId_idx" ON "Shift"("agencyId");

-- CreateIndex
CREATE INDEX "ClockEvent_agencyId_idx" ON "ClockEvent"("agencyId");

-- CreateIndex
CREATE INDEX "Timesheet_agencyId_idx" ON "Timesheet"("agencyId");

-- CreateIndex
CREATE INDEX "Notification_agencyId_idx" ON "Notification"("agencyId");

-- CreateIndex
CREATE INDEX "Training_agencyId_idx" ON "Training"("agencyId");

-- CreateIndex
CREATE INDEX "DbsCheck_agencyId_idx" ON "DbsCheck"("agencyId");

-- CreateIndex
CREATE INDEX "AuditLog_agencyId_idx" ON "AuditLog"("agencyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DbsCheck" ADD CONSTRAINT "DbsCheck_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
