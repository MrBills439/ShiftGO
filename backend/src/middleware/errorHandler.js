/**
 * Global error handling middleware
 * Should be added to Express app LAST (after all other middleware and routes)
 *
 * Usage: app.use(errorHandler);
 */
const errorHandler = (err, req, res, next) => {
  // Log error server-side for debugging
  const timestamp = new Date().toISOString();
  const path = req.path;
  const method = req.method;
  const userAgent = req.headers['user-agent'];

  // Determine status code
  let statusCode = err.statusCode || 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message || 'Validation failed';
  } else if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Authentication required';
  } else if (err.statusCode === 403) {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = 'Access denied';
  } else if (err.statusCode === 404) {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (err.message && err.message.includes('Invalid token')) {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid or expired token';
  }

  // Production: don't leak stack traces
  const isDev = process.env.NODE_ENV === 'development';

  // Log error for debugging
  console.error(`[${timestamp}] ${method} ${path}`, {
    statusCode,
    errorCode,
    message: err.message,
    stack: isDev ? err.stack : undefined,
  });

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(isDev && { details: err.message, stack: err.stack }),
    },
    timestamp,
  });
};

module.exports = errorHandler;
