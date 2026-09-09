/**
 * Whole-Workforce Phase 1 — organisation structure CRUD.
 *
 *   Writes  (create / update / deactivate / reactivate / delete):  HR only
 *   Reads   (management list / detail):                            MANAGER + HR
 *   Options (id + name picker list of ACTIVE records):             any authed user
 *
 * All three sub-routers are agency-scoped inside the service — every query
 * filters on agencyId, so a user in agency A can never read/mutate agency B.
 */
const auth = require('../middleware/auth');
const { allow, atLeast } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/orgStructureController');

function buildRouter(entity, createValidator, updateValidator) {
  const router = require('express').Router();
  const c = ctrl[entity];
  router.use(auth);

  router.get('/options', asyncHandler(c.options));
  router.get('/', atLeast('MANAGER'), asyncHandler(c.list));
  router.get('/:id', validators.orgIdParam, atLeast('MANAGER'), asyncHandler(c.getOne));

  router.post('/', createValidator, allow('HR'), asyncHandler(c.create));
  router.patch('/:id', updateValidator, allow('HR'), asyncHandler(c.update));
  router.post('/:id/deactivate', validators.orgIdParam, allow('HR'), asyncHandler(c.deactivate));
  router.post('/:id/reactivate', validators.orgIdParam, allow('HR'), asyncHandler(c.reactivate));
  router.delete('/:id', validators.orgIdParam, allow('HR'), asyncHandler(c.remove));

  return router;
}

module.exports = {
  departments: buildRouter('department', validators.createDepartment, validators.updateDepartment),
  jobTitles: buildRouter('jobTitle', validators.createJobTitle, validators.updateJobTitle),
  locations: buildRouter('location', validators.createLocation, validators.updateLocation),
};
