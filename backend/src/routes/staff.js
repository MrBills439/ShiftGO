const router = require('express').Router();
const ctrl = require('../controllers/staffController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Staff Allocation view — same audience as the staff directory (HR / MANAGER /
// TEAM_LEADER); the service applies each role's house scoping.
router.get('/allocation', validators.staffAllocation, atLeast('TEAM_LEADER'), asyncHandler(ctrl.allocation));

module.exports = router;
