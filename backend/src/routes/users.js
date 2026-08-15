const router = require('express').Router();
const ctrl = require('../controllers/userController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { avatarUpload } = require('../middleware/upload');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/me', asyncHandler(ctrl.getMe));
router.patch('/me', validators.updateMe, asyncHandler(ctrl.updateMe));
router.post('/me/avatar', avatarUpload.single('avatar'), asyncHandler(ctrl.uploadAvatar));
router.patch('/me/fcm-token', validators.updateFcmToken, asyncHandler(ctrl.updateFcmToken));

router.get('/', validators.listUsers, atLeast('MANAGER'), asyncHandler(ctrl.listUsers));
router.post('/', validators.createUser, atLeast('MANAGER'), asyncHandler(ctrl.createUser));
router.post('/:id/deactivate', validators.deactivateUser, atLeast('MANAGER'), asyncHandler(ctrl.deactivateUser));
router.get('/:id', validators.getUser, atLeast('MANAGER'), asyncHandler(ctrl.getUser));
router.post('/assign/worker', validators.assignWorkerToHouse, allow('HR'), asyncHandler(ctrl.assignWorkerToHouse));
router.post('/assign/team-leader', validators.assignTeamLeaderToHouse, allow('HR'), asyncHandler(ctrl.assignTeamLeaderToHouse));

module.exports = router;
