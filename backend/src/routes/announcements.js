const router = require('express').Router();
const ctrl = require('../controllers/announcementController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', asyncHandler(ctrl.listAnnouncements));
router.get('/unread', asyncHandler(ctrl.listUnreadAnnouncements));
router.post('/', validators.createAnnouncement, atLeast('MANAGER'), asyncHandler(ctrl.createAnnouncement));
router.post('/:id/read', validators.getAnnouncement, asyncHandler(ctrl.markAnnouncementRead));
router.delete('/:id', validators.getAnnouncement, atLeast('MANAGER'), asyncHandler(ctrl.deleteAnnouncement));

module.exports = router;
