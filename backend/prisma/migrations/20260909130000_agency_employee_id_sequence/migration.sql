-- Whole-Workforce: per-agency auto employee IDs.
-- Additive and backwards-compatible. `employeeIdPrefix` stays NULL until HR
-- configures one; existing users keep employeeNumber = NULL (no backfill —
-- we do not silently mint payroll identifiers for existing staff).

ALTER TABLE "Agency" ADD COLUMN "employeeIdPrefix" TEXT;
ALTER TABLE "Agency" ADD COLUMN "employeeIdNextNumber" INTEGER NOT NULL DEFAULT 1;
