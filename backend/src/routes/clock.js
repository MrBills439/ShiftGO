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
router.post('/auto-checkin', validators.autoCheckin, asyncHandler(ctrl.autoCheckin));
router.post('/geofence-exit', validators.geofenceExit, asyncHandler(ctrl.geofenceExit));

module.exports = router;
