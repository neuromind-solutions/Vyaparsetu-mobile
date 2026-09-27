/**
 * Global Error Handler Middleware
 * Catches all errors passed via next(err) and returns structured JSON responses.
 * Must be registered LAST in the Express middleware chain.
 */

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`Error [${statusCode}]: ${message}`);

  if (process.env.NODE_ENV === 'development') {
    logger.error(err.stack);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = { errorHandler };
