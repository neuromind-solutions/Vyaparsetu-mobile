/**
 * Health Controller
 * Handles HTTP requests for the /api/health endpoint.
 * Delegates business logic to healthService.
 */

const { getHealthStatus } = require('../services/healthService');

/**
 * GET /api/health
 * Returns server and database status.
 */
function checkHealth(req, res, next) {
  try {
    const status = getHealthStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { checkHealth };
