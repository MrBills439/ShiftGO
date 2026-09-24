const router = require('express').Router();
const ctrl = require('../controllers/clockController');
const auth = require('../middleware/auth');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

// Every route here is EMPLOYEE SELF-SERVICE attendance: an employee records
// their OWN clock-in/out and monitoring, whatever their system role. System role
// (WORKER / TEAM_LEADER / MANAGER / HR) is a permission concept; attendance
// eligibility comes from elsewhere and is enforced in clockService, never by a
// role gate here:
//   - `auth` -> a real, ACTIVE (non-deactivated) local user in its own agency;
//   - every service call is keyed on req.user.id (never a body/query id) and
//     agency-scoped, so an employee can only ever touch a shift/session whose
//     workerId is themselves — a manager or HR gets no way through these routes
//     to act on someone else's attendance;
//   - FLEXIBLE clock-in additionally requires User.workPatternType === 'FLEXIBLE'
//     read from the database, not from role or the request.
// There is deliberately no administrative attendance operation on this router —
// manager/HR review lives under /timesheets (atLeast('MANAGER')), and the
// auto clock-out runs from attendanceJob, not over HTTP.
router.use(auth);

router.post('/in', validators.manualClockIn, asyncHandler(ctrl.manualClockIn));
router.post('/out', validators.manualClockOut, asyncHandler(ctrl.manualClockOut));

// The caller's open FLEXIBLE session (if any) — lets the app rediscover it after
// a restart, since the flexible shift id is only otherwise known from the
// clock-in response.
router.get('/active-session', asyncHandler(ctrl.getActiveSession));

// Periodic location report while clocked in (shift-aware background monitoring).
router.post('/location', validators.reportLocation, asyncHandler(ctrl.reportLocation));

// "Yes, I'm still working" — from the geofence-exit / shift-end prompts.
router.post('/still-working', validators.attendanceAction, asyncHandler(ctrl.confirmStillWorking));

// Snapshot for the app to reconcile monitoring on launch / resume.
router.get('/state', asyncHandler(ctrl.getState));

module.exports = router;
