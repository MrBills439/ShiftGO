-- DropIndex
DROP INDEX "Notification_agencyId_idx";

-- DropIndex
DROP INDEX "Shift_shiftType_idx";

-- CreateIndex
CREATE INDEX "HouseTeamLeader_teamLeaderId_idx" ON "HouseTeamLeader"("teamLeaderId");

-- CreateIndex
CREATE INDEX "HouseWorker_workerId_idx" ON "HouseWorker"("workerId");

-- CreateIndex
CREATE INDEX "LeaveRequest_agencyId_workerId_status_idx" ON "LeaveRequest"("agencyId", "workerId", "status");

-- CreateIndex
CREATE INDEX "Notification_agencyId_userId_read_idx" ON "Notification"("agencyId", "userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_type_idx" ON "Notification"("userId", "type");

-- CreateIndex
CREATE INDEX "Shift_startTime_idx" ON "Shift"("startTime");

-- CreateIndex
CREATE INDEX "Timesheet_agencyId_workerId_idx" ON "Timesheet"("agencyId", "workerId");

-- CreateIndex
CREATE INDEX "Timesheet_agencyId_houseId_idx" ON "Timesheet"("agencyId", "houseId");

-- CreateIndex
CREATE INDEX "Timesheet_agencyId_status_idx" ON "Timesheet"("agencyId", "status");

-- CreateIndex
CREATE INDEX "Timesheet_agencyId_needsReview_idx" ON "Timesheet"("agencyId", "needsReview");

-- CreateIndex
CREATE INDEX "Training_agencyId_userId_idx" ON "Training"("agencyId", "userId");
