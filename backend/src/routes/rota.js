const router = require('express').Router();
const ctrl = require('../controllers/rotaController');
const auth = require('../middleware/auth');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/week', validators.rotaWeek, asyncHandler(ctrl.week));
router.get('/day', validators.rotaDay, asyncHandler(ctrl.day));
router.get('/me', asyncHandler(ctrl.me));

module.exports = router;
