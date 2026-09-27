/**
 * Backup Controller
 * Exposes API handlers for local backups, listing backups, restores, status checking, and internet status.
 */

const backupService = require('../services/backupService');

/**
 * POST /api/backup/local
 * Creates a local manual backup of the current database.
 */
async function createLocalBackup(req, res, next) {
  try {
    const backupInfo = await backupService.createBackup();
    res.status(201).json({
      success: true,
      message: 'Backup created successfully.',
      data: backupInfo,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/list
 * Returns the history list of all local backups.
 */
async function listBackups(req, res, next) {
  try {
    const backups = await backupService.listBackups();
    res.status(200).json({
      success: true,
      data: backups,
      count: backups.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/backup/restore
 * Restores the SQLite database from a selected local backup.
 */
async function restoreBackup(req, res, next) {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: 'Filename is required for restore.',
      });
    }

    const restoreInfo = await backupService.restoreBackup(filename);
    res.status(200).json({
      success: true,
      message: 'Database restored successfully.',
      data: restoreInfo,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/status
 * Returns the timestamp and info of the most recent local backup.
 */
async function getBackupStatus(req, res, next) {
  try {
    const latest = await backupService.getLatestBackupStatus();
    res.status(200).json({
      success: true,
      data: latest,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/internet-status
 * Detects whether the server has active internet connectivity.
 */
async function checkInternetStatus(req, res, next) {
  try {
    const online = await backupService.checkInternetStatus();
    res.status(200).json({
      success: true,
      data: {
        online,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/export
 * Creates an instant snapshot and streams it as a download attachment.
 */
async function exportBackup(req, res, next) {
  try {
    const { filePath, filename } = await backupService.exportCurrentSnapshot();
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/download/:filename
 * Downloads a specific existing backup file from history.
 */
async function downloadBackup(req, res, next) {
  try {
    const { filename } = req.params;
    const filePath = backupService.getBackupFilePath(filename);
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/backup/import
 * Accepts uploaded database file (base64 in JSON or raw binary) and safely restores it.
 */
async function importBackup(req, res, next) {
  try {
    let buffer = null;
    let originalName = 'imported-backup.db';

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      buffer = req.body;
    } else if (req.body && req.body.fileData) {
      // Base64 payload: { fileData: '...', filename: 'backup.db' }
      buffer = Buffer.from(req.body.fileData, 'base64');
      if (req.body.filename) originalName = req.body.filename;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No backup file payload provided. Send fileData (base64) or raw binary.',
      });
    }

    const restoreInfo = await backupService.restoreFromBuffer(buffer, originalName);
    res.status(200).json({
      success: true,
      message: 'Database imported and restored successfully.',
      data: restoreInfo,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/backup/config
 * Retrieves current backup folder paths, cloud detection, and auto-sync toggle.
 */
function getConfig(req, res, next) {
  try {
    const config = backupService.getBackupConfig();
    res.status(200).json({
      success: true,
      data: config,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/backup/config
 * Updates custom backup folder path and auto-backup toggle.
 */
function saveConfig(req, res, next) {
  try {
    const { customDir, autoBackupEnabled } = req.body;
    const updated = backupService.saveBackupConfig({ customDir, autoBackupEnabled });
    res.status(200).json({
      success: true,
      message: 'Backup configuration saved successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/backup/auto-sync
 * Executes an immediate automated backup snapshot to configured destinations.
 */
async function performAutoSync(req, res, next) {
  try {
    const result = await backupService.performAutoSync();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createLocalBackup,
  listBackups,
  restoreBackup,
  getBackupStatus,
  checkInternetStatus,
  exportBackup,
  downloadBackup,
  importBackup,
  getConfig,
  saveConfig,
  performAutoSync,
};
