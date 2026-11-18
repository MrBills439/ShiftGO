const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', validators.listAuditLogs, allow('HR'), asyncHandler(ctrl.listAuditLogs));

module.exports = router;
