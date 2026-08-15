const router = require('express').Router();
const ctrl = require('../controllers/shiftController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', validators.listShifts, asyncHandler(ctrl.listShifts));
router.post('/', validators.createShift, atLeast('TEAM_LEADER'), asyncHandler(ctrl.createShift));
router.get('/:id', validators.getShift, asyncHandler(ctrl.getShift));
router.delete('/:id', validators.cancelShift, atLeast('MANAGER'), asyncHandler(ctrl.deleteShift));

module.exports = router;
