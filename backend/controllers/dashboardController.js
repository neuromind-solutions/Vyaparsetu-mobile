/**
 * Dashboard Controller
 * Directs HTTP requests to dashboardService.
 */

const dashboardService = require('../services/dashboardService');

/**
 * GET /api/dashboard/summary
 * Returns the aggregated summary statistics for today and overall metrics.
 */
async function getSummary(req, res, next) {
  try {
    const data = await dashboardService.getDashboardSummary();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
};
