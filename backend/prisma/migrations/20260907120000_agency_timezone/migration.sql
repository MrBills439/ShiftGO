-- Additive: every existing agency (the current pilot) defaults to Europe/London.
ALTER TABLE "Agency" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/London';
