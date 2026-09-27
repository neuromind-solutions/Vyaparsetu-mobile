/**
 * Google Drive Backup Service
 *
 * Implements Google Drive API OAuth 2.0 authentication, local token storage,
 * zero-waste change detection (SQLite triggers + SHA-256 hash comparison),
 * canonical single-file overwrite sync, and safe transactional database restorations.
 *
 * Conforms to GOOGLE_DRIVE_BACKUP_GUIDE.md
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const { DB_PATH, reloadDb, serialize, execGet, execRun } = require('../database/db');
const backupService = require('./backupService');
const logger = require('../utils/logger');

const TOKENS_PATH = process.env.DRIVE_TOKENS_PATH
  ? path.resolve(process.env.DRIVE_TOKENS_PATH)
  : path.resolve(__dirname, '../database/drive_tokens.json');

const DRIVE_FOLDER_NAME = 'VyapaarSetu_Backups';
const BACKUP_FILE_NAME = 'vyapaarsetu_backup.db';
const LEGACY_BACKUP_FILE_NAME = 'vyapaarsetu-backup.db';

/**
 * Retrieve setting from SQLite settings table
 */
function getSetting(key) {
  try {
    const row = execGet('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value || '';
  } catch {
    return '';
  }
}

/**
 * Update setting in SQLite settings table
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

const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:5000/api/drive/callback';

/**
 * Resolves OAuth 2.0 credentials from environment variables, settings table, or built-in defaults
 */
function getOAuthConfig(customRedirectUri) {
  const envClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const dbClientId = getSetting('google_client_id')?.trim();
  const clientId = envClientId || dbClientId || DEFAULT_CLIENT_ID;

  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const dbClientSecret = getSetting('google_client_secret')?.trim();
  const clientSecret = envClientSecret || dbClientSecret || DEFAULT_CLIENT_SECRET;

  const envRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  const dbRedirectUri = getSetting('google_redirect_uri')?.trim();
  const redirectUri = envRedirectUri || customRedirectUri || dbRedirectUri || DEFAULT_REDIRECT_URI;

  return { clientId, clientSecret, redirectUri };
}

/**
 * Instantiate configured OAuth2 client
 */
function getOAuth2Client(customRedirectUri) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(customRedirectUri);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

const oauth2Client = getOAuth2Client();

// Auto-save refreshed tokens when Google updates credentials
oauth2Client.on('tokens', (tokens) => {
  logger.info('Google OAuth access token refreshed automatically.');
  saveTokens(tokens);
});

/**
 * Saves and merges newly fetched/refreshed tokens to disk
 */
function saveTokens(tokens) {
  let existing = {};
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    } catch (_) {}
  }
  const merged = { ...existing, ...tokens };
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  oauth2Client.setCredentials(merged);
  return merged;
}

/**
 * Loads credentials from local storage disk
 */
function loadTokens() {
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    const { clientId, clientSecret, redirectUri } = getOAuthConfig();
    if (clientId) {
      oauth2Client._clientId = clientId;
      oauth2Client._clientSecret = clientSecret;
      oauth2Client.redirectUri = redirectUri;
    }
    oauth2Client.setCredentials(tokens);
    return tokens;
  } catch (err) {
    logger.error('Failed to parse locally stored Google Drive tokens:', err);
    return null;
  }
}

/**
 * Generates the authorization consent URL
 */
function getAuthUrl(customRedirectUri) {
  const { clientId, clientSecret } = getOAuthConfig(customRedirectUri);
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured. Please enter your Google Client ID and Client Secret in Settings before connecting.');
  }

  const client = getOAuth2Client(customRedirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}

/**
 * Processes authorization code to retrieve and save tokens
 */
async function handleCallback(code, customRedirectUri) {
  if (!code) throw new Error('Authorization code required.');
  const client = getOAuth2Client(customRedirectUri);
  const { tokens } = await client.getToken(code);
  saveTokens(tokens);
  logger.info('Google Drive successfully authenticated and tokens stored.');
  return tokens;
}

/**
 * Disconnects the linked Google account by deleting stored tokens
 */
async function disconnectDrive() {
  if (fs.existsSync(TOKENS_PATH)) {
    try { fs.unlinkSync(TOKENS_PATH); } catch (_) {}
  }
  oauth2Client.setCredentials({});
  logger.info('Google Drive disconnected.');
  return { success: true };
}

/**
 * Computes SHA-256 hash of the main database file after WAL checkpoint
 */
function computeDbHash() {
  if (!fs.existsSync(DB_PATH)) return '';
  backupService.checkpointDatabase();
  const fileBuffer = fs.readFileSync(DB_PATH);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Checks whether the local database has any actual customer/transaction/billing data
 */
function hasLocalBusinessData() {
  try {
    const custRow = execGet('SELECT COUNT(*) as count FROM customers WHERE is_deleted = 0');
    const txRow = execGet('SELECT COUNT(*) as count FROM transactions');
    const billRow = execGet('SELECT COUNT(*) as count FROM bills');
    const custCount = custRow?.count || 0;
    const txCount = txRow?.count || 0;
    const billCount = billRow?.count || 0;
    return (custCount + txCount + billCount) > 0;
  } catch {
    return false;
  }
}

/**
 * Determines if database has un-synced changes
 */
function isDatabaseDirty() {
  const isDirtyFlag = getSetting('db_dirty') === '1';
  const lastSyncedHash = getSetting('last_synced_hash');

  // On a brand-new installation where no sync has occurred yet:
  if (!lastSyncedHash) {
    // Only mark dirty if actual business records or changes have occurred locally
    return isDirtyFlag || hasLocalBusinessData();
  }
  if (!isDirtyFlag) return false;

  const currentHash = computeDbHash();
  if (currentHash === lastSyncedHash) {
    markDatabaseClean();
    return false;
  }
  return true;
}

/**
 * Resets db_dirty to '0' and records last_cloud_sync timestamp
 */
function markDatabaseClean() {
  setSetting('db_dirty', '0');
  setSetting('last_cloud_sync', new Date().toISOString());
}

/**
 * Checks connection and dirty state
 */
async function getDriveStatus() {
  const tokens = loadTokens();
  const isConnected = !!tokens;
  const isDirty = isConnected ? isDatabaseDirty() : false;
  const lastSync = getSetting('last_cloud_sync');
  const lastChange = getSetting('last_data_change');
  const lastHash = getSetting('last_synced_hash');
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const hasCredentials = Boolean(clientId && clientSecret);

  return {
    connected: isConnected,
    isDirty,
    lastSync,
    lastChange,
    lastHash,
    hasCredentials,
    clientId: clientId ? `${clientId.slice(0, 8)}...` : '',
    redirectUri,
  };
}

/**
 * Retrieves or creates the Google Drive parent folder
 */
async function getOrCreateFolder(drive) {
  // Check for VyapaarSetu_Backups or legacy MandaiMitra_Backups
  const response = await drive.files.list({
    q: `(name = '${DRIVE_FOLDER_NAME}' or name = 'MandaiMitra_Backups') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  logger.info(`Creating folder '${DRIVE_FOLDER_NAME}' in Google Drive...`);
  const folder = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return folder.data.id;
}

/**
 * Intelligent Single-File Cloud Backup
 * Overwrites canonical 'vyapaarsetu-backup.db' in-place (revisions preserved in Drive).
 * Skips if SHA-256 hash is unchanged (zero network waste).
 *
 * @param {boolean} force Force upload even if hash is identical
 */
async function upsertDriveBackup(force = false) {
  if (!loadTokens()) {
    throw new Error('Google Drive is not connected. Please authenticate first.');
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Local SQLite database file not found. Cannot perform cloud backup.');
  }

  // 1. Flush WAL & compute current hash
  backupService.checkpointDatabase();
  const currentHash = computeDbHash();
  const lastSyncedHash = getSetting('last_synced_hash');

  // 2. Zero-waste skip if nothing changed
  if (!force && lastSyncedHash && currentHash === lastSyncedHash) {
    markDatabaseClean();
    return {
      file: {
        id: getSetting('drive_backup_file_id') || '',
        filename: BACKUP_FILE_NAME,
        size: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
        createdAt: getSetting('last_cloud_sync') || new Date().toISOString(),
      },
      skipped: true,
      reason: 'identical_hash',
    };
  }

  // Safety guard: if auto-backup runs on a brand new PC with an empty database,
  // do not overwrite existing cloud backup
  if (!force && !lastSyncedHash && !hasLocalBusinessData()) {
    return {
      skipped: true,
      reason: 'empty_local_database_safeguard',
    };
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const folderId = await getOrCreateFolder(drive);

  // 3. Resolve persistent file ID
  let fileId = getSetting('drive_backup_file_id');
  if (!fileId) {
    const res = await drive.files.list({
      q: `(name = '${BACKUP_FILE_NAME}' or name = '${LEGACY_BACKUP_FILE_NAME}') and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    fileId = res.data.files?.[0]?.id || '';
  }

  let resultFile = null;

  // Flush WAL to ensure DB_PATH has all latest committed transactions
  backupService.checkpointDatabase();

  // 4. Try updating existing canonical file (preserves revisions in Google Drive)
  if (fileId) {
    try {
      logger.info(`Updating existing Google Drive backup file (ID: ${fileId})...`);
      const res = await drive.files.update({
        fileId: fileId,
        requestBody: { name: BACKUP_FILE_NAME },
        media: {
          mimeType: 'application/octet-stream',
          body: fs.createReadStream(DB_PATH),
        },
        fields: 'id, name, size, modifiedTime',
      });

      resultFile = {
        id: res.data.id,
        filename: res.data.name,
        size: Number(res.data.size || 0),
        createdAt: res.data.modifiedTime,
      };
    } catch (err) {
      logger.warn(`Drive file update failed, attempting creation of new file: ${err.message}`);
      fileId = '';
    }
  }

  // 5. Create if first time or previous file missing
  if (!fileId) {
    logger.info(`Creating canonical backup file '${BACKUP_FILE_NAME}' on Google Drive...`);
    const res = await drive.files.create({
      requestBody: {
        name: BACKUP_FILE_NAME,
        parents: [folderId],
      },
      media: {
        mimeType: 'application/octet-stream',
        body: fs.createReadStream(DB_PATH),
      },
      fields: 'id, name, size, createdTime',
    });

    resultFile = {
      id: res.data.id,
      filename: res.data.name,
      size: Number(res.data.size || 0),
      createdAt: res.data.createdTime,
    };
  }

  // 6. Save metadata & mark database clean
  setSetting('drive_backup_file_id', resultFile.id);
  setSetting('last_synced_hash', currentHash);
  markDatabaseClean();

  logger.info(`Google Drive backup completed successfully (ID: ${resultFile.id}, size: ${resultFile.size} bytes).`);
  return { file: resultFile, skipped: false };
}

/**
 * Lists backups stored in the folder on Drive
 */
async function listDriveBackups() {
  const tokens = loadTokens();
  if (!tokens) return [];

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  let folderId;
  try {
    folderId = await getOrCreateFolder(drive);
  } catch (err) {
    logger.error('Failed to locate Google Drive folder:', err);
    return [];
  }

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, size, createdTime, modifiedTime)',
    orderBy: 'modifiedTime desc',
  });

  return (response.data.files || []).map((file) => ({
    id: file.id,
    filename: file.name,
    size: Number(file.size || 0),
    createdAt: file.modifiedTime || file.createdTime,
  }));
}

/**
 * Downloads a backup file from Google Drive and restores it with safety snapshot & rollback
 */
async function restoreFromDrive(driveFileId) {
  if (!driveFileId) {
    // If not provided, fallback to saved canonical file id
    driveFileId = getSetting('drive_backup_file_id');
  }

  if (!driveFileId) {
    throw new Error('Google Drive file ID is required for restore.');
  }

  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Google Drive is not connected. Please authenticate first.');
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // 1. Trigger local safety backup first without overwriting master files
  logger.info('Creating local safety backup prior to Google Drive restoration...');
  const safetyBackupBuffer = serialize();
  const safetyFilename = 'vyapaarsetu_safety_pre_restore.bak';
  try {
    fs.writeFileSync(path.join(backupService.BACKUP_DIR, safetyFilename), safetyBackupBuffer);
  } catch (_) {}

  // 2. Define temp file path to download content securely
  const tempDownloadPath = path.join(backupService.BACKUP_DIR, `temp_drive_${Date.now()}.db`);

  try {
    // 3. Stream download from Drive
    logger.info(`Downloading file ID: ${driveFileId} from Google Drive...`);
    const destStream = fs.createWriteStream(tempDownloadPath);

    const driveRes = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      driveRes.data
        .on('error', reject)
        .pipe(destStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    // 4. Validate SQLite buffer header
    const downloadedBuffer = fs.readFileSync(tempDownloadPath);
    if (!backupService.isValidSqliteBuffer(downloadedBuffer)) {
      throw new Error('Downloaded file from Google Drive is not a valid SQLite database.');
    }

    // 5. Flush WAL and reload database
    backupService.checkpointDatabase();
    reloadDb(downloadedBuffer);
    backupService.checkpointDatabase();

    // 6. Keep master backup in sync with restored state
    const masterPath = path.join(backupService.BACKUP_DIR, BACKUP_FILE_NAME);
    const legacyLatest = path.join(backupService.BACKUP_DIR, 'vyapaarsetu-latest.db');
    try {
      fs.writeFileSync(masterPath, downloadedBuffer);
      fs.writeFileSync(legacyLatest, downloadedBuffer);
    } catch (_) {}

    // 7. Record sync metadata in the newly restored database
    const restoredHash = computeDbHash();
    setSetting('drive_backup_file_id', driveFileId);
    setSetting('last_synced_hash', restoredHash);
    setSetting('last_cloud_sync', new Date().toISOString());
    setSetting('db_dirty', '0');

    // Clean up temp file
    if (fs.existsSync(tempDownloadPath)) {
      try { fs.unlinkSync(tempDownloadPath); } catch (_) {}
    }

    logger.info('Google Drive restore completed successfully.');
    return {
      success: true,
      restoredId: driveFileId,
      safetyBackup: safetyFilename,
    };
  } catch (err) {
    logger.error('Google Drive restore failed. Reverting database to safety state...', err);

    if (fs.existsSync(tempDownloadPath)) {
      try { fs.unlinkSync(tempDownloadPath); } catch (_) {}
    }

    // Revert database to the pre-restore snapshot
    try {
      backupService.checkpointDatabase();
      reloadDb(safetyBackupBuffer);
      backupService.checkpointDatabase();
      logger.info('Successfully reverted database to local safety backup.');
    } catch (rollbackErr) {
      logger.error('CRITICAL: Rollback to safety backup failed during Drive restore recovery!', rollbackErr);
    }

    throw new Error(`Drive restore failed: ${err.message}. Database has been kept safe.`);
  }
}

module.exports = {
  getAuthUrl,
  handleCallback,
  disconnectDrive,
  getDriveStatus,
  upsertDriveBackup,
  uploadBackupToDrive: upsertDriveBackup, // alias for backwards compatibility
  listDriveBackups,
  restoreFromDrive,
  computeDbHash,
  isDatabaseDirty,
  markDatabaseClean,
  TOKENS_PATH,
};
