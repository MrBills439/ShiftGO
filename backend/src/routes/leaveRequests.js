const router = require('express').Router();
const ctrl = require('../controllers/leaveRequestController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');

// All routes require authentication
router.use(auth);

// PTO balance breakdown (own, or ?workerId= for manager/HR).
// Declared before "/:id" so "balance" isn't treated as a request id.
router.get('/balance', ctrl.getBalance);

// Configure a worker's accrual policy (manager/HR)
router.put('/accrual-profile/:userId', atLeast('MANAGER'), ctrl.updateAccrualProfile);

// Run the year-end cycle reset for a worker (HR/manager)
router.post('/accrual-profile/:userId/year-end-reset', atLeast('MANAGER'), ctrl.runYearEndReset);

// Get all leave requests (filtered by role)
router.get('/', ctrl.getLeaveRequests);

// Get single leave request
router.get('/:id', ctrl.getLeaveRequest);

// Create leave request (worker can create own, manager/hr can create for workers)
router.post('/', validators.createLeaveRequest, ctrl.createLeaveRequest);

// Approve leave request (manager/hr only)
router.post('/:id/approve', validators.approveLeaveRequest, atLeast('MANAGER'), ctrl.approveLeaveRequest);

// Reject leave request (manager/hr only)
router.post('/:id/reject', validators.rejectLeaveRequest, atLeast('MANAGER'), ctrl.rejectLeaveRequest);

// Cancel leave request (worker own/pending, manager/hr can cancel pending/approved)
router.post('/:id/cancel', validators.cancelLeaveRequest, ctrl.cancelLeaveRequest);

module.exports = router;
