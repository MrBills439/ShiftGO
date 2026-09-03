const router = require('express').Router();
const ctrl = require('../controllers/shiftController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', validators.listShifts, asyncHandler(ctrl.listShifts));
router.post('/', validators.createShift, atLeast('TEAM_LEADER'), asyncHandler(ctrl.createShift));
router.get('/open', asyncHandler(ctrl.listOpenShifts));
router.get('/:id', validators.getShift, asyncHandler(ctrl.getShift));
router.patch('/:id', validators.updateShift, atLeast('TEAM_LEADER'), asyncHandler(ctrl.updateShift));
router.delete('/:id', validators.cancelShift, atLeast('MANAGER'), asyncHandler(ctrl.deleteShift));
router.post('/:id/open', validators.openShift, atLeast('MANAGER'), asyncHandler(ctrl.openShift));
router.post('/:id/claim', validators.claimShift, asyncHandler(ctrl.claimShift));
router.post('/:id/drop', validators.dropShift, asyncHandler(ctrl.dropShift));
router.get('/:id/claims', validators.getShift, atLeast('MANAGER'), asyncHandler(ctrl.listShiftClaims));

module.exports = router;
