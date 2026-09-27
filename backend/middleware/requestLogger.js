/**
 * Request Logger Middleware
 * Logs each incoming HTTP request with method, path, and timestamp.
 */

const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} — ${res.statusCode} (${duration}ms)`);
  });

  next();
}

module.exports = { requestLogger };
