const rateLimit = require('express-rate-limit');

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

const apiLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('API_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 50 : 300),
  handler: handler('Rate limit exceeded. Please slow down.'),
});

const strictLimiter = rateLimit({
  ...commonOptions,
  max: maxFromEnv('STRICT_RATE_LIMIT_MAX', process.env.NODE_ENV === 'test' ? 5 : 10),
  handler: handler('Too many requests. Please try again later.'),
});

module.exports = { authLimiter, apiLimiter, strictLimiter };
