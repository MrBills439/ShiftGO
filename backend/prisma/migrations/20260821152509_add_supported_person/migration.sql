-- DropIndex
DROP INDEX "idx_clock_event_house";

-- DropIndex
DROP INDEX "idx_clock_event_shift";

-- DropIndex
DROP INDEX "idx_clock_event_worker";

-- DropIndex
DROP INDEX "idx_house_manager";

-- DropIndex
DROP INDEX "idx_notification_user_created";

-- DropIndex
DROP INDEX "Shift_cancelledById_idx";

-- DropIndex
DROP INDEX "Shift_status_idx";

-- DropIndex
DROP INDEX "idx_shift_created_date";

-- DropIndex
DROP INDEX "idx_shift_house_time";

-- DropIndex
DROP INDEX "idx_timesheet_house";

-- DropIndex
DROP INDEX "idx_timesheet_reviewed_by";

-- DropIndex
DROP INDEX "idx_timesheet_shift";

-- DropIndex
DROP INDEX "idx_timesheet_status";

-- DropIndex
DROP INDEX "idx_timesheet_worker";

-- DropIndex
DROP INDEX "idx_user_email";

-- DropIndex
DROP INDEX "idx_user_role";

-- AlterTable
ALTER TABLE "Agency" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LeaveRequest" ALTER COLUMN "agencyId" SET DEFAULT 'default-agency';

-- CreateTable
CREATE TABLE "SupportedPerson" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportedPerson_agencyId_idx" ON "SupportedPerson"("agencyId");

-- CreateIndex
CREATE INDEX "SupportedPerson_houseId_idx" ON "SupportedPerson"("houseId");

-- AddForeignKey
ALTER TABLE "SupportedPerson" ADD CONSTRAINT "SupportedPerson_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportedPerson" ADD CONSTRAINT "SupportedPerson_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
