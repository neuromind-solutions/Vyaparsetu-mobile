/**
 * Settings Model
 * Placeholder for settings CRUD operations.
 * Will be expanded in the Settings module.
 */

const { execGet, execRun } = require('../database/db');

/**
 * Get a setting value by key.
 * @param {string} key
 * @returns {string|null}
 */
function getSetting(key) {
  const row = execGet('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

/**
 * Set a setting value by key.
 * @param {string} key
 * @param {string} value
 */
function setSetting(key, value) {
  execRun(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

module.exports = { getSetting, setSetting };
