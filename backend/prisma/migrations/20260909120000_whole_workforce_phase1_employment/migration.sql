-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('CARE_SERVICE', 'SUPPORTED_LIVING', 'RESIDENTIAL_HOME', 'OFFICE', 'MAINTENANCE_BASE', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkPatternType" AS ENUM ('ROTA', 'FIXED', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'BANK', 'CONTRACTOR');

-- AlterTable
ALTER TABLE "House" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "employeeNumber" TEXT,
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "jobTitleId" TEXT,
ADD COLUMN     "lineManagerId" TEXT,
ADD COLUMN     "primaryLocationId" TEXT,
ADD COLUMN     "workPatternType" "WorkPatternType" NOT NULL DEFAULT 'ROTA';

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geofenceRadius" INTEGER,
    "timezone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingEmployee" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitationId" TEXT,
    "role" "Role" NOT NULL,
    "employeeNumber" TEXT,
    "departmentId" TEXT,
    "jobTitleId" TEXT,
    "primaryLocationId" TEXT,
    "lineManagerId" TEXT,
    "contractedHours" DOUBLE PRECISION,
    "workPatternType" "WorkPatternType" NOT NULL DEFAULT 'ROTA',
    "employmentType" "EmploymentType",
    "invitedById" TEXT,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Department_agencyId_active_idx" ON "Department"("agencyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Department_agencyId_name_key" ON "Department"("agencyId", "name");

-- CreateIndex
CREATE INDEX "JobTitle_agencyId_active_idx" ON "JobTitle"("agencyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_agencyId_name_key" ON "JobTitle"("agencyId", "name");

-- CreateIndex
CREATE INDEX "Location_agencyId_active_idx" ON "Location"("agencyId", "active");

-- CreateIndex
CREATE INDEX "PendingEmployee_agencyId_consumedAt_idx" ON "PendingEmployee"("agencyId", "consumedAt");

-- CreateIndex
CREATE INDEX "PendingEmployee_expiresAt_idx" ON "PendingEmployee"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingEmployee_agencyId_email_key" ON "PendingEmployee"("agencyId", "email");

-- CreateIndex
CREATE INDEX "House_locationId_idx" ON "House"("locationId");

-- CreateIndex

-- CreateIndex
CREATE INDEX "User_agencyId_departmentId_idx" ON "User"("agencyId", "departmentId");

-- CreateIndex
CREATE INDEX "User_agencyId_jobTitleId_idx" ON "User"("agencyId", "jobTitleId");

-- CreateIndex
CREATE INDEX "User_agencyId_primaryLocationId_idx" ON "User"("agencyId", "primaryLocationId");

-- CreateIndex
CREATE INDEX "User_lineManagerId_idx" ON "User"("lineManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_agencyId_employeeNumber_key" ON "User"("agencyId", "employeeNumber");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lineManagerId_fkey" FOREIGN KEY ("lineManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingEmployee" ADD CONSTRAINT "PendingEmployee_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
--  Whole-Workforce Phase 1 — one-time data backfill (additive, idempotent).
--  Care attendance behaviour is UNCHANGED: nothing below touches Shift,
--  ClockEvent, Timesheet, AttendanceMonitor, or the House geofence columns.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. One Location per existing House (1:1). The Location id is derived
--    deterministically from the House id so House.locationId can be set without
--    a fragile name/address match. Care type: SUPPORTED_LIVING (the House model
--    carries no residential/supported distinction; this is the safe general
--    care type and can be edited by HR afterwards). House keeps its own
--    latitude/longitude/geofenceRadius, which remain authoritative for care
--    clock-in.
INSERT INTO "Location" (
  "id", "agencyId", "name", "type", "address",
  "latitude", "longitude", "geofenceRadius", "active", "createdAt", "updatedAt"
)
SELECT
  md5('shiftgo-house-location:' || h."id"),
  h."agencyId", h."name", 'SUPPORTED_LIVING'::"LocationType", h."address",
  h."latitude", h."longitude", h."geofenceRadius", true, now(), now()
FROM "House" h
WHERE h."locationId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "House" h
SET "locationId" = md5('shiftgo-house-location:' || h."id")
WHERE h."locationId" IS NULL;

-- 2. A 'Care' department per agency that has existing WORKER / TEAM_LEADER
--    staff, unless one already exists. MANAGER / HR are NOT auto-assigned.
INSERT INTO "Department" ("id", "agencyId", "name", "active", "createdAt", "updatedAt")
SELECT md5('shiftgo-care-dept:' || a."id"), a."id", 'Care', true, now(), now()
FROM "Agency" a
WHERE EXISTS (
  SELECT 1 FROM "User" u
  WHERE u."agencyId" = a."id" AND u."role" IN ('WORKER', 'TEAM_LEADER')
)
AND NOT EXISTS (
  SELECT 1 FROM "Department" d WHERE d."agencyId" = a."id" AND d."name" = 'Care'
)
ON CONFLICT ("agencyId", "name") DO NOTHING;

-- 3. Assign existing WORKER / TEAM_LEADER with no department to their agency's
--    'Care' department. Existing rows already have workPatternType = 'ROTA'
--    from the column default above; nothing else changes.
UPDATE "User" u
SET "departmentId" = d."id"
FROM "Department" d
WHERE d."agencyId" = u."agencyId"
  AND d."name" = 'Care'
  AND u."role" IN ('WORKER', 'TEAM_LEADER')
  AND u."departmentId" IS NULL;
