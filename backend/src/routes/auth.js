const router = require('express').Router();
const { login, refresh, register } = require('../controllers/authController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');
const { validators } = require('../middleware/validators');
const { authLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const { forbidden } = require('../utils/response');

const blockProductionRegister = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return forbidden(res, 'Public registration is disabled in production; use protected staff onboarding');
  }
  next();
};

router.post('/login', authLimiter, validators.login, asyncHandler(login));
router.post('/refresh', authLimiter, validators.refresh, asyncHandler(refresh));
router.post('/register', authLimiter, blockProductionRegister, validators.register, auth, allow('HR'), asyncHandler(register));

module.exports = router;
