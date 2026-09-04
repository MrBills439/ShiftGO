const router = require('express').Router();
const ctrl = require('../controllers/clockController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);
router.use(allow('WORKER'));

router.post('/in', validators.manualClockIn, asyncHandler(ctrl.manualClockIn));
router.post('/out', validators.manualClockIn, asyncHandler(ctrl.manualClockOut));

// Periodic location report while clocked in (shift-aware background monitoring).
router.post('/location', validators.reportLocation, asyncHandler(ctrl.reportLocation));

// "Yes, I'm still working" — from the geofence-exit / shift-end prompts.
router.post('/still-working', validators.attendanceAction, asyncHandler(ctrl.confirmStillWorking));

// Snapshot for the app to reconcile monitoring on launch / resume.
router.get('/state', asyncHandler(ctrl.getState));

module.exports = router;
