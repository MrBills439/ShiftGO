-- CreateIndex for Shift queries (critical for geofencing)
-- Used by: geofence detection, shift assignment, worker schedule lookup
CREATE INDEX "idx_shift_worker_time" ON "Shift"("workerId", "startTime", "endTime");
CREATE INDEX "idx_shift_house_time" ON "Shift"("houseId", "startTime", "endTime");
CREATE INDEX "idx_shift_created_date" ON "Shift"("createdById", "date");

-- CreateIndex for ClockEvent queries (critical for attendance tracking)
-- Used by: clock-in/out detection, duplicate prevention
CREATE INDEX "idx_clock_event_shift" ON "ClockEvent"("shiftId", "type");
CREATE INDEX "idx_clock_event_worker" ON "ClockEvent"("workerId", "timestamp");
CREATE INDEX "idx_clock_event_house" ON "ClockEvent"("houseId", "timestamp");

-- CreateIndex for Timesheet queries (critical for manager dashboard)
-- Used by: approval workflow, export, reporting
CREATE INDEX "idx_timesheet_house" ON "Timesheet"("houseId", "createdAt");
CREATE INDEX "idx_timesheet_shift" ON "Timesheet"("shiftId");
CREATE INDEX "idx_timesheet_worker" ON "Timesheet"("workerId", "createdAt");

-- CreateIndex for User queries (auth, lookups)
CREATE INDEX "idx_user_email" ON "User"("email");
CREATE INDEX "idx_user_role" ON "User"("role");

-- CreateIndex for Notification queries (history, cleanup)
CREATE INDEX "idx_notification_user_created" ON "Notification"("userId", "createdAt");

-- CreateIndex for House queries (location lookups)
CREATE INDEX "idx_house_manager" ON "House"("managerId");
