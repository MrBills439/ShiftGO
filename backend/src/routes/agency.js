const router = require('express').Router();
const ctrl = require('../controllers/agencyController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Read: managers+ can see the configured limits. Write: HR only.
router.get('/', atLeast('MANAGER'), asyncHandler(ctrl.getAgency));
router.patch('/', allow('HR'), asyncHandler(ctrl.updateAgency));

module.exports = router;
