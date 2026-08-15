const router = require('express').Router();
const ctrl = require('../controllers/dbsController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/me', asyncHandler(ctrl.getMyDbs));
router.get('/user/:userId', validators.userIdParam, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getDbsForUser));
router.post('/', validators.upsertDbs, atLeast('HR'), asyncHandler(ctrl.upsertDbs));

module.exports = router;
