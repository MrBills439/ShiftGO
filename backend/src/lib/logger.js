/**
 * Structured JSON logger (winston). One line per event: timestamp, level,
 * message, plus whatever structured fields the caller passes. Use this instead
 * of console.* for anything that should be greppable in production logs.
 *
 *   logger.info('shift.created', { shiftId, agencyId });
 *   logger.warn('request.slow', { path, durationMs });
 *
 * Level is controlled by LOG_LEVEL (default: 'info', or 'error' under tests so
 * the suite output stays quiet).
 */
const winston = require('winston');

const isTest = process.env.NODE_ENV === 'test';
const level = process.env.LOG_LEVEL || (isTest ? 'error' : 'info');

const logger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
  silent: process.env.LOG_SILENT === 'true',
});

module.exports = logger;
