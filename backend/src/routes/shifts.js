const router = require('express').Router();
const ctrl = require('../controllers/shiftController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');

router.use(auth);

router.get('/', ctrl.listShifts);
router.post('/', atLeast('TEAM_LEADER'), ctrl.createShift);
router.get('/:id', ctrl.getShift);
router.delete('/:id', atLeast('TEAM_LEADER'), ctrl.deleteShift);

module.exports = router;
