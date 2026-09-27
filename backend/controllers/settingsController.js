/**
 * Settings Controller
 * Directs HTTP requests to settingsService.
 */

const settingsService = require('../services/settingsService');

/**
 * GET /api/settings
 * Returns all settings as a flat object.
 */
function getAll(req, res, next) {
  try {
    const data = settingsService.getAllSettings();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/settings/:key
 * Returns value of a specific setting key.
 */
function getByKey(req, res, next) {
  try {
    const { key } = req.params;
    const value = settingsService.getSettingByKey(key);
    res.status(200).json({
      success: true,
      data: value,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/settings/:key
 * Updates the value of a specific setting key.
 */
function updateKey(req, res, next) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Setting value is required.',
      });
    }

    const data = settingsService.updateSettingByKey(key, value);
    res.status(200).json({
      success: true,
      message: `Setting ${key} updated successfully.`,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/settings/bulk
 * Updates multiple setting key-value pairs at once.
 */
function updateBulk(req, res, next) {
  try {
    const settingsObj = req.body.settings || req.body;
    if (!settingsObj || typeof settingsObj !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Settings object is required.',
      });
    }

    const data = settingsService.updateSettingsBulk(settingsObj);
    res.status(200).json({
      success: true,
      message: 'All settings updated successfully.',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAll,
  getByKey,
  updateKey,
  updateBulk,
};
