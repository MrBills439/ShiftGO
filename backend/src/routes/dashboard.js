const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Ops dashboard — workers get their own home screen, so this stays TEAM_LEADER+.
router.get('/today', atLeast('TEAM_LEADER'), asyncHandler(ctrl.today));

module.exports = router;
