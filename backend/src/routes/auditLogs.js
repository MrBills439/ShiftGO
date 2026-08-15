const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/', validators.listAuditLogs, atLeast('MANAGER'), asyncHandler(ctrl.listAuditLogs));

module.exports = router;
