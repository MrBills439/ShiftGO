-- DropIndex
DROP INDEX "Shift_fixedWorkPatternId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Shift_fixedWorkPatternId_date_key" ON "Shift"("fixedWorkPatternId", "date");

