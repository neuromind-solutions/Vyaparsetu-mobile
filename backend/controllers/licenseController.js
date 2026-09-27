/**
 * License Controller
 * Thin HTTP layer over licenseService — mirrors settingsController's shape.
 */

const licenseService = require('../services/licenseService');

/**
 * GET /api/license/status
 * Reachable before activation (mounted ahead of the license guard) so the UI can
 * show this PC's Machine ID and whether it is already licensed.
 */
function getStatus(req, res, next) {
  try {
    res.status(200).json({
      success: true,
      data: licenseService.getStatus(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/license/activate  { licenseKey }
 * Validates and stores the key. A bad key surfaces as a 400 (licenseService sets
 * statusCode on the thrown error); success returns the fresh status.
 */
function activate(req, res, next) {
  try {
    const { licenseKey } = req.body;
    if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
      return res.status(400).json({
        success: false,
        message: 'License key is required.',
      });
    }

    const data = licenseService.activate(licenseKey);
    res.status(200).json({
      success: true,
      message: 'App activated successfully.',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStatus,
  activate,
};
