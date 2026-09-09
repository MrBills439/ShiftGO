-- Whole-Workforce Phase 1 hardening: durable "onboarding incomplete" signal.
-- Additive and backwards-compatible. Existing staging rows default to
-- needsReview = false (i.e. treated as fine unless a later webhook flags them).

ALTER TABLE "PendingEmployee" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PendingEmployee" ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "PendingEmployee_agencyId_needsReview_idx" ON "PendingEmployee"("agencyId", "needsReview");
