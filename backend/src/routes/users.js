const router = require('express').Router();
const ctrl = require('../controllers/userController');
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { avatarUpload } = require('../middleware/upload');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

router.get('/me', asyncHandler(ctrl.getMe));
router.patch('/me', validators.updateMe, asyncHandler(ctrl.updateMe));
router.post('/me/onboarding', validators.updateMe, asyncHandler(ctrl.completeOnboarding));
router.post('/me/avatar', avatarUpload.single('avatar'), asyncHandler(ctrl.uploadAvatar));
router.delete('/me/avatar', asyncHandler(ctrl.removeAvatar));
router.patch('/me/fcm-token', validators.updateFcmToken, asyncHandler(ctrl.updateFcmToken));

// Team leaders may list workers (needed to assign staff to a house), and —
// Fixed Staff Scheduling V1 — the unfiltered agency roster (needed to pick any
// ACTIVE employee, of any system role, for a FIXED/Location-backed shift they
// create). Filtering explicitly by MANAGER/HR/TEAM_LEADER still stays Manager+;
// this does not add a way to query "all HR" or "all managers" directly.
const listUsersGuard = (req, res, next) => {
  if (req.user?.role === 'TEAM_LEADER' && (req.query.role === 'WORKER' || !req.query.role)) return next();
  return atLeast('MANAGER')(req, res, next);
};

// Whole-Workforce Phase 1 (hardening): onboarding rows the webhook could not
// fully apply. Declared before '/:id' so the literal path is not read as an id.
router.get('/onboarding-review', atLeast('MANAGER'), asyncHandler(ctrl.listOnboardingReview));
router.post('/onboarding-review/:id/resolve', validators.orgIdParam, allow('HR'), asyncHandler(ctrl.resolveOnboardingReview));

router.get('/', validators.listUsers, listUsersGuard, asyncHandler(ctrl.listUsers));
router.post('/', validators.createUser, atLeast('MANAGER'), asyncHandler(ctrl.createUser));
router.post('/:id/deactivate', validators.deactivateUser, atLeast('MANAGER'), asyncHandler(ctrl.deactivateUser));
// Employee Lifecycle V1 — offboarding awareness + reactivation.
router.get('/:id/offboarding-preview', validators.getUser, atLeast('MANAGER'), asyncHandler(ctrl.offboardingPreview));
router.post('/:id/reactivate', validators.reactivateUser, allow('HR'), asyncHandler(ctrl.reactivateUser));
router.get('/:id', validators.getUser, atLeast('MANAGER'), asyncHandler(ctrl.getUser));
router.patch('/:id', validators.updateUser, atLeast('MANAGER'), asyncHandler(ctrl.updateUser));
// System Access / Role Management V1 — HR only; keeps Clerk org role + User.role in sync.
router.patch('/:id/system-access', validators.changeSystemAccess, allow('HR'), asyncHandler(ctrl.changeSystemAccess));
router.post('/assign/worker', validators.assignWorkerToHouse, atLeast('TEAM_LEADER'), asyncHandler(ctrl.assignWorkerToHouse));
router.post('/assign/team-leader', validators.assignTeamLeaderToHouse, allow('HR'), asyncHandler(ctrl.assignTeamLeaderToHouse));

module.exports = router;
