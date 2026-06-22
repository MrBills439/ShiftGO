const router = require('express').Router();
const ctrl = require('../controllers/dbsController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');

router.use(auth);

router.get('/me', ctrl.getMyDbs);
router.get('/user/:userId', atLeast('TEAM_LEADER'), ctrl.getDbsForUser);
router.post('/', atLeast('HR'), ctrl.upsertDbs);

module.exports = router;
