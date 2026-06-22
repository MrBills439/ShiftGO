const router = require('express').Router();
const ctrl = require('../controllers/timesheetController');
const auth = require('../middleware/auth');
const { atLeast, allow } = require('../middleware/roleGuard');

router.use(auth);

router.get('/me', ctrl.myTimesheets);
router.get('/house/:houseId', atLeast('TEAM_LEADER'), ctrl.houseTimesheets);
router.post('/:id/confirm', atLeast('TEAM_LEADER'), ctrl.confirmTimesheet);
router.get('/house/:houseId/export', atLeast('MANAGER'), ctrl.exportPDF);

module.exports = router;
