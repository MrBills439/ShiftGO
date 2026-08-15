const router = require('express').Router();
const ctrl = require('../controllers/houseController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', asyncHandler(ctrl.listHouses));
router.get('/:id', validators.getHouse, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getHouse));
router.post('/', validators.createHouse, allow('HR'), asyncHandler(ctrl.createHouse));
router.patch('/:id', validators.updateHouse, allow('HR'), asyncHandler(ctrl.updateHouse));
router.patch('/:id/geofence', validators.updateGeofence, allow('HR'), asyncHandler(ctrl.updateGeofence));
router.delete('/:id', validators.getHouse, allow('HR'), asyncHandler(ctrl.deleteHouse));

module.exports = router;
