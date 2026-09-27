const { execSelect, execRun, transaction } = require('../database/db');
const logger = require('../utils/logger');

/**
 * Returns all settings as a flat key-value object (e.g. { language: 'en', commission_rate: '8' })
 */
function getAllSettings() {
  const rows = execSelect('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
}

/**
 * Returns the value of a specific setting key.
 * Returns null if the setting does not exist.
 */
function getSettingByKey(key) {
  const rows = execSelect('SELECT value FROM settings WHERE key = ?', [key]);
  return rows.length > 0 ? rows[0].value : null;
}

/**
 * Updates or inserts a setting key-value pair.
 * Updates description only if it's explicitly provided.
 */
function updateSettingByKey(key, value, description = null) {
  const existing = getSettingByKey(key);

  if (existing !== null) {
    if (description !== null) {
      execRun(
        'UPDATE settings SET value = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
        [String(value), description, key]
      );
    } else {
      execRun(
        'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
        [String(value), key]
      );
    }
  } else {
    execRun(
      'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
      [key, String(value), description || '']
    );
  }

  logger.info(`Setting updated: ${key} = ${value}`);
  return { key, value };
}

/**
 * Bulk updates multiple settings keys in a single transaction.
 */
function updateSettingsBulk(settingsObj) {
  try {
    transaction(() => {
      for (const [key, value] of Object.entries(settingsObj)) {
        // Use existing update logic inside transaction
        const existing = getSettingByKey(key);
        if (existing !== null) {
          execRun(
            'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
            [String(value), key]
          );
        } else {
          execRun(
            'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
            [key, String(value), '']
          );
        }
      }
    });
    logger.info('Bulk settings updated successfully');
    return getAllSettings();
  } catch (err) {
    logger.error('Failed bulk settings update:', err);
    throw err;
  }
}

module.exports = {
  getAllSettings,
  getSettingByKey,
  updateSettingByKey,
  updateSettingsBulk,
};
