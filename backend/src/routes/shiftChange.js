const router = require('express').Router();
const ctrl = require('../controllers/shiftChangeController');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// ─── Worker self-service ───────────────────────────────────────────────────
router.get('/eligible-workers', validators.shiftChangeEligibleWorkers, asyncHandler(ctrl.eligibleWorkers));
router.get('/swap-shifts', validators.shiftChangeSwapShifts, asyncHandler(ctrl.swapShifts));
router.post('/cover', validators.shiftChangeCover, asyncHandler(ctrl.createCover));
router.post('/swap', validators.shiftChangeSwap, asyncHandler(ctrl.createSwap));
router.get('/me', validators.shiftChangeList, asyncHandler(ctrl.mine));

// ─── Manager / HR ─────────────────────────────────────────────────────────
router.get('/pending-approval', atLeast('MANAGER'), validators.shiftChangeList, asyncHandler(ctrl.pendingApproval));
router.post('/:id/approve', atLeast('MANAGER'), validators.shiftChangeApprove, asyncHandler(ctrl.approve));
router.post('/:id/reject', atLeast('MANAGER'), validators.shiftChangeReject, asyncHandler(ctrl.reject));

// ─── Shared (party-scoped inside the service) ─────────────────────────────
router.get('/:id', validators.shiftChangeIdOnly, asyncHandler(ctrl.getOne));
router.post('/:id/respond', validators.shiftChangeRespond, asyncHandler(ctrl.respond));
router.post('/:id/cancel', validators.shiftChangeIdOnly, asyncHandler(ctrl.cancel));

module.exports = router;
