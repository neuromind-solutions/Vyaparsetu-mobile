/**
 * Local & Cloud Auto-Backup Service
 * Handles WAL-safe SQLite snapshots, cloud folder auto-detection (Google Drive, OneDrive),
 * custom destination mirroring, backup history listing, buffer verification,
 * and fail-safe transactional restorations.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const dns = require('dns').promises;
const crypto = require('crypto');
const os = require('os');
const { DB_PATH, reloadDb, serialize, backupTo, checkpoint, execGet, execRun } = require('../database/db');
const logger = require('../utils/logger');

// Repo-root backups/ by default; the packaged app overrides this to a writable
// per-user dir, since a program installed under Program Files cannot write beside
// its own files.
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(__dirname, '../../backups');

// Ensure default backups directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Reads setting value from SQLite settings table
 */
function getSetting(key) {
  try {
    const row = execGet('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch (err) {
    logger.warn(`Could not read setting '${key}': ${err.message}`);
    return null;
  }
}

/**
 * Writes setting value to SQLite settings table
 */
function setSetting(key, value) {
  try {
    execRun(`
      INSERT INTO settings(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `, [key, value, value]);
  } catch (err) {
    logger.warn(`Could not set setting '${key}': ${err.message}`);
  }
}

/**
 * Scans standard Windows drive letters and user profile paths for Google Drive & OneDrive
 * @returns {Array<{ provider: string, path: string, exists: boolean }>}
 */
function detectCloudFolders() {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const candidates = [];

  // 1. Scan drive letters (G:, F:, H:, I:, D:, E:) for Google Drive for Desktop
  const driveLetters = ['G', 'F', 'H', 'I', 'D', 'E'];
  for (const letter of driveLetters) {
    const root = `${letter}:\\`;
    const myDrive = path.join(root, 'My Drive');
    const googleDrive = path.join(root, 'Google Drive');
    if (fs.existsSync(myDrive)) {
      candidates.push({
        provider: `Google Drive (${letter}: Drive)`,
        path: path.join(myDrive, 'VyapaarSetu_Backups'),
        exists: true,
      });
      break;
    } else if (fs.existsSync(googleDrive)) {
      candidates.push({
        provider: `Google Drive (${letter}: Drive)`,
        path: path.join(googleDrive, 'VyapaarSetu_Backups'),
        exists: true,
      });
      break;
    }
  }

  // 2. Scan User Profile for Google Drive
  const userGooglePaths = [
    path.join(userProfile, 'Google Drive'),
    path.join(userProfile, 'My Drive'),
    path.join(userProfile, 'GoogleDrive'),
  ];
  for (const ugp of userGooglePaths) {
    if (fs.existsSync(ugp)) {
      candidates.push({
        provider: 'Google Drive',
        path: path.join(ugp, 'VyapaarSetu_Backups'),
        exists: true,
      });
      break;
    }
  }

  // 3. Scan Microsoft OneDrive
  const oneDriveEnv = process.env.OneDrive || process.env.OneDriveCommercial;
  if (oneDriveEnv && fs.existsSync(oneDriveEnv)) {
    candidates.push({ provider: 'Microsoft OneDrive', path: path.join(oneDriveEnv, 'VyapaarSetu_Backups'), exists: true });
  } else {
    const oneDriveUser = path.join(userProfile, 'OneDrive');
    if (fs.existsSync(oneDriveUser)) {
      candidates.push({ provider: 'Microsoft OneDrive', path: path.join(oneDriveUser, 'VyapaarSetu_Backups'), exists: true });
    }
  }

  return candidates;
}

/**
 * Retrieves the current auto-backup configuration
 */
function getBackupConfig() {
  const customDir = getSetting('custom_backup_folder')?.trim() || '';
  const autoBackupEnabled = getSetting('auto_backup_enabled') !== '0';
  const lastAutoBackup = getSetting('last_cloud_sync') || getSetting('last_backup_sync') || null;
  const isDirty = getSetting('db_dirty') === '1';
  const detected = detectCloudFolders();

  const activeDir = (customDir && fs.existsSync(customDir)) ? customDir : BACKUP_DIR;

  return {
    defaultDir: BACKUP_DIR,
    customDir,
    activeDir,
    autoBackupEnabled,
    detectedCloudPaths: detected,
    lastAutoBackup,
    isDirty,
  };
}

/**
 * Saves the auto-backup directory configuration
 */
function saveBackupConfig({ customDir, autoBackupEnabled }) {
  if (customDir !== undefined) {
    const trimmed = (customDir || '').trim();
    if (trimmed) {
      // Ensure target directory exists
      if (!fs.existsSync(trimmed)) {
        fs.mkdirSync(trimmed, { recursive: true });
      }
    }
    setSetting('custom_backup_folder', trimmed);
  }

  if (autoBackupEnabled !== undefined) {
    setSetting('auto_backup_enabled', autoBackupEnabled ? '1' : '0');
  }

  return getBackupConfig();
}

/**
 * Validates SQLite magic header bytes ('SQLite format 3')
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isValidSqliteBuffer(buffer) {
  if (!buffer || buffer.length < 100) return false;
  const header = buffer.subarray(0, 16).toString();
  return header.includes('SQLite format 3');
}

/**
 * Flushes all uncommitted WAL transactions into the main .db file.
 * Must be executed before copying, hashing, or restoring the SQLite database.
 */
function checkpointDatabase() {
  try {
    checkpoint();
  } catch (err) {
    logger.warn(`[DB] WAL Checkpoint warning: ${err.message}`);
  }
}

const CANONICAL_BACKUP_NAME = 'vyapaarsetu_backup.db';
const ROLLBACK_BACKUP_NAME = 'vyapaarsetu_backup.previous.bak';
const LEGACY_LATEST_NAME = 'vyapaarsetu-latest.db';

/**
 * Formats canonical backup filename
 */
function generateBackupFilename() {
  return CANONICAL_BACKUP_NAME;
}

/**
 * Cleans up old historical redundant snapshots, keeping storage lean and un-duplicated
 */
function pruneLegacySnapshots(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) return;
    const files = fs.readdirSync(folderPath);
    for (const f of files) {
      if (
        (f.startsWith('backup-20') || f.startsWith('drive-upload-') || f.startsWith('temp_drive_')) &&
        (f.endsWith('.db') || f.endsWith('.sqlite'))
      ) {
        try {
          fs.unlinkSync(path.join(folderPath, f));
          logger.info(`Pruned redundant legacy snapshot: ${f}`);
        } catch (_) {}
      }
    }
  } catch (err) {
    logger.warn(`Legacy snapshot cleanup warning for ${folderPath}: ${err.message}`);
  }
}

function rotateBackups(folderPath) {
  pruneLegacySnapshots(folderPath);
}

/**
 * Updates/creates the single master local backup of the current SQLite database.
 * Preserves one previous rollback copy (.bak) before updating, preventing data clutter.
 * @returns {Promise<object>} Metadata of the master backup
 */
async function createBackup() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Database file does not exist to backup.');
  }

  // 1. Flush WAL to ensure complete integrity
  checkpointDatabase();

  const destPath = path.join(BACKUP_DIR, CANONICAL_BACKUP_NAME);
  const rollbackPath = path.join(BACKUP_DIR, ROLLBACK_BACKUP_NAME);
  const legacyLatestPath = path.join(BACKUP_DIR, LEGACY_LATEST_NAME);

  // 2. If a master backup already exists, preserve 1 previous rollback copy before replacing
  if (fs.existsSync(destPath)) {
    try {
      fs.copyFileSync(destPath, rollbackPath);
    } catch (_) {}
  }

  // 3. Write new master backup
  try {
    await backupTo(destPath);
  } catch (err) {
    logger.warn(`Native backupTo failed, falling back to file copy after checkpoint: ${err.message}`);
    checkpointDatabase();
    fs.copyFileSync(DB_PATH, destPath);
  }
  logger.info(`Master database backup saved at: ${destPath}`);

  // 4. Maintain canonical latest file alias for backward compatibility
  try { fs.copyFileSync(destPath, legacyLatestPath); } catch (_) {}

  // 5. Mirror to custom cloud folder if configured
  const customDir = getSetting('custom_backup_folder')?.trim();
  if (customDir && fs.existsSync(customDir) && path.resolve(customDir) !== path.resolve(BACKUP_DIR)) {
    try {
      const customDest = path.join(customDir, CANONICAL_BACKUP_NAME);
      const customRollback = path.join(customDir, ROLLBACK_BACKUP_NAME);
      const customLatest = path.join(customDir, LEGACY_LATEST_NAME);
      if (fs.existsSync(customDest)) {
        try { fs.copyFileSync(customDest, customRollback); } catch (_) {}
      }
      fs.copyFileSync(destPath, customDest);
      fs.copyFileSync(destPath, customLatest);
      pruneLegacySnapshots(customDir);
      logger.info(`Mirrored master backup to custom folder: ${customDest}`);
    } catch (mirrorErr) {
      logger.warn(`Could not mirror backup to custom folder: ${mirrorErr.message}`);
    }
  }

  // 6. Clean up any older legacy timestamped snapshots to remove redundancy
  pruneLegacySnapshots(BACKUP_DIR);

  const stats = fs.statSync(destPath);
  setSetting('last_cloud_sync', new Date().toISOString());
  setSetting('db_dirty', '0');

  return {
    filename: CANONICAL_BACKUP_NAME,
    size: stats.size,
    createdAt: stats.mtime.toISOString(),
  };
}

/**
 * Executes automatic background sync to local and cloud/custom destinations.
 * Checks if auto-backup is enabled, if database has dirty changes (db_dirty === '1'),
 * and enforces a minimum throttle between automated snapshot files.
 *
 * @param {{ force?: boolean }} options
 */
async function performAutoSync(options = {}) {
  const { force = false } = options;
  const isEnabled = getSetting('auto_backup_enabled') !== '0';
  if (!isEnabled && !force) {
    return { success: true, skipped: true, reason: 'Auto-backup disabled by user' };
  }

  const isDirty = getSetting('db_dirty') === '1';
  if (!isDirty && !force) {
    return { success: true, skipped: true, reason: 'No new data changes since last backup' };
  }

  // Throttle automatic background snapshots (min 5 minutes between automated files)
  if (!force) {
    const lastSync = getSetting('last_cloud_sync') || getSetting('last_backup_sync');
    if (lastSync) {
      const elapsedMs = Date.now() - new Date(lastSync).getTime();
      const minIntervalMs = 5 * 60 * 1000; // 5 minutes
      if (elapsedMs < minIntervalMs) {
        return { success: true, skipped: true, reason: 'Throttled: recent backup snapshot already exists' };
      }
    }
  }

  const result = await createBackup();
  logger.info(`[AutoSync] ✓ Backup snapshot successfully created (${result.filename})`);
  return {
    success: true,
    data: result,
  };
}


/**
 * Lists all backups from the default and custom history folders.
 * Prioritizes the Master Database and its previous rollback version.
 * @returns {Promise<Array>} List of backup metadata
 */
async function listBackups() {
  const seen = new Map();

  const scanFolder = (folderPath, isCustom = false) => {
    if (!fs.existsSync(folderPath)) return;
    try {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const isMaster = file === CANONICAL_BACKUP_NAME;
        const isRollback = file === ROLLBACK_BACKUP_NAME;
        const isLegacy = file.startsWith('backup-') && (file.endsWith('.db') || file.endsWith('.sqlite'));
        const isSafety = file === 'vyapaarsetu_safety_pre_restore.bak';

        if (isMaster || isRollback || isLegacy || isSafety) {
          const filePath = path.join(folderPath, file);
          try {
            const stats = fs.statSync(filePath);
            if (!seen.has(file) || isCustom) {
              let locationLabel = isCustom ? 'Cloud / Custom Folder' : 'Local App Storage';
              if (isMaster) locationLabel += ' (Master DB)';
              else if (isRollback) locationLabel += ' (Rollback Copy)';

              seen.set(file, {
                filename: file,
                size: stats.size,
                createdAt: stats.mtime.toISOString(),
                location: locationLabel,
                isMaster,
                isRollback,
                filePath,
              });
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  };

  scanFolder(BACKUP_DIR, false);

  const customDir = getSetting('custom_backup_folder')?.trim();
  if (customDir && fs.existsSync(customDir) && path.resolve(customDir) !== path.resolve(BACKUP_DIR)) {
    scanFolder(customDir, true);
  }

  // Sort: Master first, then Rollback, then newest to oldest
  return Array.from(seen.values()).sort((a, b) => {
    if (a.isMaster) return -1;
    if (b.isMaster) return 1;
    if (a.isRollback) return -1;
    if (b.isRollback) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

/**
 * Restores the database from a backup file.
 * Checks default folder and custom cloud folder.
 * Creates a safety backup of current state before overwriting.
 * @param {string} filename The backup file name to restore from
 */
async function restoreBackup(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid backup filename.');
  }

  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Access denied: Invalid backup filename format.');
  }

  let targetPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    const customDir = getSetting('custom_backup_folder')?.trim();
    if (customDir && fs.existsSync(customDir)) {
      const customCandidate = path.join(customDir, filename);
      if (fs.existsSync(customCandidate)) {
        targetPath = customCandidate;
      }
    }
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file ${filename} does not exist.`);
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Current database file not found. Cannot perform safety backup.');
  }

  const selectedBackupBuffer = fs.readFileSync(targetPath);
  if (!isValidSqliteBuffer(selectedBackupBuffer)) {
    throw new Error('Target file is not a valid SQLite database.');
  }

  // 1. Create a safety backup first without overwriting the chosen target
  logger.info('Creating safety backup prior to database restore...');
  const safetyBackupBuffer = serialize();
  const safetyFilename = 'vyapaarsetu_safety_pre_restore.bak';
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, safetyFilename), safetyBackupBuffer);
  } catch (_) {}
  logger.info(`Safety backup created at name: ${safetyFilename}`);

  try {
    // 2. Flush WAL & reload DB
    checkpointDatabase();
    logger.info(`Starting restore from backup file: ${filename}`);
    reloadDb(selectedBackupBuffer);
    checkpointDatabase();

    // 3. Keep master backup in sync with restored state
    const masterPath = path.join(BACKUP_DIR, CANONICAL_BACKUP_NAME);
    const legacyLatest = path.join(BACKUP_DIR, LEGACY_LATEST_NAME);
    try {
      fs.copyFileSync(targetPath, masterPath);
      fs.copyFileSync(targetPath, legacyLatest);
    } catch (_) {}

    logger.info('Database restored successfully from backup.');
    return {
      success: true,
      restoredFile: filename,
      safetyBackup: safetyFilename,
    };
  } catch (err) {
    logger.error('Database restore failed. Attempting fail-safe rollback to safety backup...', err);
    try {
      reloadDb(safetyBackupBuffer);
      checkpointDatabase();
      logger.info('Database successfully reverted to safety state.');
    } catch (rollbackErr) {
      logger.error('CRITICAL: Rollback to safety backup failed!', rollbackErr);
    }
    throw new Error(`Restore failed: ${err.message}. Database has been kept safe.`);
  }
}

/**
 * Returns metadata of the latest backup file.
 * @returns {Promise<object|null>} Latest backup info or null if none
 */
async function getLatestBackupStatus() {
  const backups = await listBackups();
  return backups.length > 0 ? backups[0] : null;
}

/**
 * Checks internet connectivity without DNS spam
 * @returns {Promise<boolean>} True if online, false if offline
 */
function checkInternetStatus() {
  return new Promise((resolve) => {
    const req = http.get('http://clients3.google.com/generate_204', (res) => {
      resolve(res.statusCode === 204);
      res.resume();
    });
    req.setTimeout(3500, () => {
      req.destroy();
      dns.lookup('google.com')
        .then(() => resolve(true))
        .catch(() => resolve(false));
    });
    req.on('error', () => {
      dns.lookup('google.com')
        .then(() => resolve(true))
        .catch(() => resolve(false));
    });
  });
}

/**
 * Restores the database from a raw Buffer (e.g. uploaded/imported .db file).
 */
async function restoreFromBuffer(buffer, originalName = 'imported.db') {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid database file data provided.');
  }

  if (!isValidSqliteBuffer(buffer)) {
    throw new Error('Uploaded file is not a valid SQLite database format.');
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Current database file not found. Cannot perform safety backup.');
  }

  // 1. Create a safety backup first
  logger.info('Creating safety backup prior to database import...');
  const safetyBackupBuffer = serialize();
  const safetyFilename = 'vyapaarsetu_safety_pre_restore.bak';
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, safetyFilename), safetyBackupBuffer);
  } catch (_) {}
  logger.info(`Safety backup created at name: ${safetyFilename}`);

  // 2. Overwrite the master backup file with the newly imported database
  const masterDestPath = path.join(BACKUP_DIR, CANONICAL_BACKUP_NAME);
  const legacyLatest = path.join(BACKUP_DIR, LEGACY_LATEST_NAME);
  try {
    fs.writeFileSync(masterDestPath, buffer);
    fs.writeFileSync(legacyLatest, buffer);
  } catch (saveErr) {
    logger.warn(`Could not save imported buffer to master backup: ${saveErr.message}`);
  }

  try {
    // 3. Flush WAL & reload DB
    checkpointDatabase();
    logger.info(`Starting restore from imported buffer (${buffer.length} bytes)...`);
    reloadDb(buffer);
    checkpointDatabase();
    logger.info('Database restored successfully from imported file.');
    return {
      success: true,
      restoredFile: CANONICAL_BACKUP_NAME,
      originalName,
      safetyBackup: safetyFilename,
    };
  } catch (err) {
    logger.error('Database restore from buffer failed. Attempting fail-safe rollback to safety backup...', err);
    try {
      reloadDb(safetyBackupBuffer);
      checkpointDatabase();
      logger.info('Database successfully reverted to safety state.');
    } catch (rollbackErr) {
      logger.error('CRITICAL: Rollback to safety backup failed!', rollbackErr);
    }
    throw new Error(`Restore failed: ${err.message}. Database has been kept safe.`);
  }
}

/**
 * Gets absolute path for a specific backup file.
 */
function getBackupFilePath(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid backup filename.');
  }
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Access denied: Invalid backup filename format.');
  }
  let targetPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    const customDir = getSetting('custom_backup_folder')?.trim();
    if (customDir && fs.existsSync(customDir)) {
      const candidate = path.join(customDir, filename);
      if (fs.existsSync(candidate)) {
        targetPath = candidate;
      }
    }
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file ${filename} does not exist.`);
  }
  return targetPath;
}

/**
 * Creates a fresh snapshot and returns its absolute path for instant export.
 */
async function exportCurrentSnapshot() {
  const backupInfo = await createBackup();
  const filePath = path.join(BACKUP_DIR, backupInfo.filename);
  return {
    filePath,
    filename: backupInfo.filename,
    size: backupInfo.size,
  };
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  restoreFromBuffer,
  getBackupFilePath,
  exportCurrentSnapshot,
  getLatestBackupStatus,
  checkInternetStatus,
  isValidSqliteBuffer,
  checkpointDatabase,
  generateBackupFilename,
  detectCloudFolders,
  getBackupConfig,
  saveBackupConfig,
  performAutoSync,
  BACKUP_DIR,
};
