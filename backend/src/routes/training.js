const router = require('express').Router();
const ctrl = require('../controllers/trainingController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/me', asyncHandler(ctrl.listMyTraining));
router.get('/user/:userId', validators.userIdParam, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getTrainingForUser));
router.post('/', validators.createTraining, atLeast('MANAGER'), asyncHandler(ctrl.createTraining));
router.patch('/:id', validators.updateTraining, atLeast('MANAGER'), asyncHandler(ctrl.updateTraining));

module.exports = router;
