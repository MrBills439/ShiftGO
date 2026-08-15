-- CreateEnum
CREATE TYPE "GpsConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNRELIABLE');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'MANUAL', 'OFFLINE_SYNC');

-- AlterTable
ALTER TABLE "ClockEvent"
ADD COLUMN "accuracy" DOUBLE PRECISION,
ADD COLUMN "gpsConfidence" "GpsConfidence",
ADD COLUMN "locationSource" "LocationSource";
