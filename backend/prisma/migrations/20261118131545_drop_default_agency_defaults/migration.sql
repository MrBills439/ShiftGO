-- AlterTable
ALTER TABLE "AttendanceMonitor" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClockEvent" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DbsCheck" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "House" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LeaveRequest" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ShareCode" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Timesheet" ALTER COLUMN "agencyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Training" ALTER COLUMN "agencyId" DROP DEFAULT;
