const router = require('express').Router();
const ctrl = require('../controllers/fixedWorkPatternController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Recurring Fixed Work Patterns V1 (Phase 1) — HR + MANAGER only, both for
// reads and writes. Reads follow the same "safest existing employee-profile
// visibility" boundary as GET /users/:id (atLeast('MANAGER')) — a
// FixedWorkPattern is per-employee HR data, and TEAM_LEADER cannot view an
// individual employee profile today either, so this does not broaden access.
router.get('/', validators.listFixedWorkPatterns, atLeast('MANAGER'), asyncHandler(ctrl.list));
router.get('/:id', validators.orgIdParam, atLeast('MANAGER'), asyncHandler(ctrl.getOne));
router.post('/', validators.createFixedWorkPattern, atLeast('MANAGER'), asyncHandler(ctrl.create));
router.post('/:id/supersede', validators.supersedeFixedWorkPattern, atLeast('MANAGER'), asyncHandler(ctrl.supersede));
router.post('/:id/end', validators.endFixedWorkPattern, atLeast('MANAGER'), asyncHandler(ctrl.end));

module.exports = router;
