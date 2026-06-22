const router = require('express').Router();
const { login, refresh, register } = require('../controllers/authController');
const auth = require('../middleware/auth');
const { allow } = require('../middleware/roleGuard');

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/register', auth, allow('HR'), register);

module.exports = router;
