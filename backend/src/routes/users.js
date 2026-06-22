const router = require('express').Router();
const ctrl = require('../controllers/userController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { avatarUpload } = require('../middleware/upload');

router.use(auth);

router.get('/me', ctrl.getMe);
router.patch('/me', ctrl.updateMe);
router.post('/me/avatar', avatarUpload.single('avatar'), ctrl.uploadAvatar);
router.patch('/me/fcm-token', ctrl.updateFcmToken);

router.get('/', atLeast('MANAGER'), ctrl.listUsers);
router.get('/:id', atLeast('MANAGER'), ctrl.getUser);
router.post('/assign/worker', allow('HR'), ctrl.assignWorkerToHouse);
router.post('/assign/team-leader', allow('HR'), ctrl.assignTeamLeaderToHouse);

module.exports = router;
