-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ONSITE', 'OFFSITE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ClockEvent" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "distanceMeters" DOUBLE PRECISION,
ADD COLUMN     "geofenceRadius" INTEGER,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationStatusResult" "LocationStatus",
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mockLocationSuspected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verification" TEXT,
ADD COLUMN     "withinGeofence" BOOLEAN;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "clockInLocationStatus" "LocationStatus",
ADD COLUMN     "clockOutLocationStatus" "LocationStatus",
ADD COLUMN     "clockOutMethod" "ClockMethod",
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- CreateTable
CREATE TABLE "AttendanceMonitor" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL DEFAULT 'default-agency',
    "shiftId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "locationStatus" "LocationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastAccuracy" DOUBLE PRECISION,
    "lastDistanceMeters" DOUBLE PRECISION,
    "lastReadingAt" TIMESTAMP(3),
    "consecutiveOutsideCount" INTEGER NOT NULL DEFAULT 0,
    "geofenceExitConfirmedAt" TIMESTAMP(3),
    "stillWorkingConfirmedAt" TIMESTAMP(3),
    "exitPromptSnoozedUntil" TIMESTAMP(3),
    "shiftEndPromptedAt" TIMESTAMP(3),
    "shiftEndAckAt" TIMESTAMP(3),
    "autoClockOutGraceStartedAt" TIMESTAMP(3),
    "autoClockOutReminderSentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonitor_shiftId_key" ON "AttendanceMonitor"("shiftId");

-- CreateIndex
CREATE INDEX "AttendanceMonitor_agencyId_idx" ON "AttendanceMonitor"("agencyId");

-- CreateIndex
CREATE INDEX "AttendanceMonitor_closedAt_idx" ON "AttendanceMonitor"("closedAt");

-- CreateIndex
CREATE INDEX "ClockEvent_shiftId_type_idx" ON "ClockEvent"("shiftId", "type");

-- AddForeignKey
ALTER TABLE "AttendanceMonitor" ADD CONSTRAINT "AttendanceMonitor_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceMonitor" ADD CONSTRAINT "AttendanceMonitor_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceMonitor" ADD CONSTRAINT "AttendanceMonitor_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceMonitor" ADD CONSTRAINT "AttendanceMonitor_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
