const router = require('express').Router();
const ctrl = require('../controllers/timesheetController');
const auth = require('../middleware/auth');
const { atLeast, allow } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/me', asyncHandler(ctrl.myTimesheets));
router.get('/house/:houseId', validators.houseTimesheets, atLeast('TEAM_LEADER'), asyncHandler(ctrl.houseTimesheets));
router.post('/:id/confirm', validators.confirmTimesheet, atLeast('TEAM_LEADER'), asyncHandler(ctrl.confirmTimesheet));
router.post('/:id/reject', validators.rejectTimesheet, atLeast('MANAGER'), asyncHandler(ctrl.rejectTimesheet));
router.get('/house/:houseId/export', validators.houseTimesheets, atLeast('MANAGER'), asyncHandler(ctrl.exportPDF));

module.exports = router;
