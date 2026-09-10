-- HR Employee Onboarding V1 — additive only. No backfill, no UPDATE, no
-- destructive SQL. Every column is nullable; existing rows are untouched.

ALTER TABLE "User" ADD COLUMN "employmentStartDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emergencyContactName" TEXT;
ALTER TABLE "User" ADD COLUMN "emergencyContactPhone" TEXT;
ALTER TABLE "User" ADD COLUMN "emergencyContactRelationship" TEXT;

ALTER TABLE "PendingEmployee" ADD COLUMN "name" TEXT;
ALTER TABLE "PendingEmployee" ADD COLUMN "phone" TEXT;
ALTER TABLE "PendingEmployee" ADD COLUMN "address" TEXT;
ALTER TABLE "PendingEmployee" ADD COLUMN "employmentStartDate" TIMESTAMP(3);
ALTER TABLE "PendingEmployee" ADD COLUMN "emergencyContactName" TEXT;
ALTER TABLE "PendingEmployee" ADD COLUMN "emergencyContactPhone" TEXT;
ALTER TABLE "PendingEmployee" ADD COLUMN "emergencyContactRelationship" TEXT;
