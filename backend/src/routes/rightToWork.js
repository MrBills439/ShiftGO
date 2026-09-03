const router = require('express').Router();
const ctrl = require('../controllers/rightToWorkController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const { shareCodeUpload } = require('../middleware/upload');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// ─── Worker self-service ───────────────────────────────────────────────────
router.get('/me', asyncHandler(ctrl.getMine));
router.put('/me', validators.upsertShareCode, asyncHandler(ctrl.updateMine));
router.post('/me/document', shareCodeUpload.single('document'), asyncHandler(ctrl.uploadMyDocument));
router.get('/me/document', asyncHandler(ctrl.getDocument));

// ─── HR / management ──────────────────────────────────────────────────────
router.get('/', atLeast('MANAGER'), asyncHandler(ctrl.list));
router.get('/export', atLeast('MANAGER'), asyncHandler(ctrl.exportZip));
router.get('/user/:userId', validators.userIdParam, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getForUser));
router.put('/user/:userId', validators.upsertShareCodeForUser, atLeast('MANAGER'), asyncHandler(ctrl.updateForUser));
router.post('/user/:userId/document', validators.userIdParam, atLeast('MANAGER'), shareCodeUpload.single('document'), asyncHandler(ctrl.uploadUserDocument));
router.get('/user/:userId/document', validators.userIdParam, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getDocument));

module.exports = router;
