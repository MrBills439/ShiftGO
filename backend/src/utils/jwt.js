const jwt = require('jsonwebtoken');
const config = require('../config');

const signAccess = (payload) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const signRefresh = (payload) =>
  jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });

const verifyAccess = (token) => jwt.verify(token, config.jwt.secret);

const verifyRefresh = (token) => jwt.verify(token, config.jwt.refreshSecret);

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
