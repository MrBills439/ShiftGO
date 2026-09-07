-- Additive: existing agencies default to a 60h weekly scheduled-hours ceiling.
ALTER TABLE "Agency" ADD COLUMN "maxWeeklyScheduledHours" INTEGER NOT NULL DEFAULT 60;
