const router = require('express').Router();
const ctrl = require('../controllers/trainingController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');

router.use(auth);

router.get('/me', ctrl.listMyTraining);
router.get('/user/:userId', atLeast('TEAM_LEADER'), ctrl.getTrainingForUser);
router.post('/', atLeast('MANAGER'), ctrl.createTraining);
router.patch('/:id', atLeast('MANAGER'), ctrl.updateTraining);

module.exports = router;
