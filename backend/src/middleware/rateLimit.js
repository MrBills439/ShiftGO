const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function isRateLimitDisabled() {
  return process.env.RATE_LIMIT_DISABLED === 'true';
}

function maxFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function handler(message) {
  return (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message,
      },
      retryAfter: req.rateLimit?.resetTime?.toISOString?.(),
      timestamp: new Date().toISOString(),
    });
  };
}

const commonOptions = {
  windowMs: FIFTEEN_MINUTES,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isRateLimitDisabled,
};

const authLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('AUTH_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 3 : 5),
  handler: handler('Too many auth attempts. Please try again later.'),
});

/**
 * The subject of the bearer token, WITHOUT verifying it — used only to bucket
 * requests for rate limiting, never for authorisation (auth.js verifies).
 * Clerk tokens carry `sub`; test tokens carry `id`.
 */
function tokenSubject(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.decode(header.slice(7));
    const sub = decoded && (decoded.sub || decoded.id);
    return typeof sub === 'string' && sub.length <= 200 ? sub : null;
  } catch {
    return null;
  }
}

const clientIpKey = (req) => ipKeyGenerator(req.ip || '');

// Two layers, because a whole care home's staff usually share ONE public IP
// (the home's Wi-Fi) and every clocked-in phone reports its location once a
// minute. A per-IP limit low enough to stop abuse would lock out the home.
//
// 1. Per-IP ceiling — generous; stops one address flooding the API.
const apiIpLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('API_IP_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 500 : 5000),
  keyGenerator: clientIpKey,
  handler: handler('Rate limit exceeded. Please slow down.'),
});

// 2. Per-user limit — each signed-in person gets their own budget, keyed on the
//    token subject. Requests with no token fall back to the IP. A forged
//    subject only spreads the forger's own traffic, which (1) still caps, and
//    the request is rejected by auth.js anyway.
const apiUserLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('API_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 50 : 300),
  keyGenerator: (req) => {
    const sub = tokenSubject(req);
    return sub ? `user:${sub}` : `ip:${clientIpKey(req)}`;
  },
  handler: handler('Rate limit exceeded. Please slow down.'),
});

const apiLimiter = [apiIpLimiter, apiUserLimiter];

const strictLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('STRICT_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 5 : 10),
  handler: handler('Too many requests. Please try again later.'),
});

module.exports = { authLimiter, apiLimiter, apiIpLimiter, apiUserLimiter, strictLimiter, tokenSubject };
