/**
 * Health Service
 * Business logic for the health check endpoint.
 * Runs a lightweight probe query to verify SQLite connectivity.
 */

const { execSelect } = require('../database/db');

/**
 * Returns the server and database health status.
 * @returns {{ status: string, database: string, timestamp: string, version: string }}
 */
function getHealthStatus() {
  let dbStatus = 'disconnected';

  try {
    // Lightweight probe — a successful SELECT means the connection is live.
    const result = execSelect('SELECT 1 AS probe');
    if (result && result.length > 0) {
      dbStatus = 'connected';
    }
  } catch {
    dbStatus = 'error';
  }

  return {
    status: 'ok',
    database: dbStatus,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  };
}

module.exports = { getHealthStatus };
