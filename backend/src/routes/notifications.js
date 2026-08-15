const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', validators.listNotifications, asyncHandler(ctrl.listNotifications));
router.get('/unread-count', asyncHandler(ctrl.unreadCount));
router.get('/push/status', atLeast('MANAGER'), asyncHandler(ctrl.pushStatus));
router.post('/push/test', validators.sendTestPush, atLeast('MANAGER'), asyncHandler(ctrl.sendTestPush));
router.patch('/:id/read', validators.notificationId, asyncHandler(ctrl.markRead));
router.patch('/read-all', asyncHandler(ctrl.markAllRead));

module.exports = router;
