const router = require('express').Router();
const ctrl = require('../controllers/houseController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', asyncHandler(ctrl.listHouses));
router.get('/:id', validators.getHouse, atLeast('TEAM_LEADER'), asyncHandler(ctrl.getHouse));
router.post('/', validators.createHouse, atLeast('MANAGER'), asyncHandler(ctrl.createHouse));
router.patch('/:id', validators.updateHouse, atLeast('MANAGER'), asyncHandler(ctrl.updateHouse));
router.patch('/:id/geofence', validators.updateGeofence, atLeast('MANAGER'), asyncHandler(ctrl.updateGeofence));
router.delete('/:id', validators.getHouse, allow('HR'), asyncHandler(ctrl.deleteHouse));

router.get('/:id/supported-people', validators.listSupportedPeople, atLeast('TEAM_LEADER'), asyncHandler(ctrl.listSupportedPeople));
router.post('/:id/supported-people', validators.createSupportedPerson, atLeast('MANAGER'), asyncHandler(ctrl.createSupportedPerson));
router.delete('/:id/supported-people/:personId', validators.deleteSupportedPerson, atLeast('MANAGER'), asyncHandler(ctrl.deleteSupportedPerson));

module.exports = router;
