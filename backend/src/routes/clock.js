const router = require('express').Router();
const ctrl = require('../controllers/clockController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');

router.use(auth);
router.use(allow('WORKER'));

router.post('/in', ctrl.manualClockIn);
router.post('/out', ctrl.manualClockOut);
router.post('/auto-checkin', ctrl.autoCheckin);
router.post('/geofence-exit', ctrl.geofenceExit);

module.exports = router;
