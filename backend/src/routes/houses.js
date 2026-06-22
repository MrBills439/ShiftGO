const router = require('express').Router();
const ctrl = require('../controllers/houseController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');

router.use(auth);

router.get('/', ctrl.listHouses);
router.get('/:id', atLeast('TEAM_LEADER'), ctrl.getHouse);
router.post('/', allow('HR'), ctrl.createHouse);
router.patch('/:id', allow('HR'), ctrl.updateHouse);
router.patch('/:id/geofence', allow('HR'), ctrl.updateGeofence);
router.delete('/:id', allow('HR'), ctrl.deleteHouse);

module.exports = router;
