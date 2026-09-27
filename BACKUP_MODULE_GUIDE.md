# Backup & Restore (Local + Google Drive Cloud) Module Implementation Guide

This guide contains the complete, self-contained implementation specification and code for the **Backup & Restore Module** extracted directly from **VyapaarSetu**.

You can use this document in any project to replicate the exact same local database backup, safety restore, and Google Drive cloud sync functionalities.

---

## 1. Overview & Key Features

The **Backup & Restore Module** provides dual-layer data safety for local-first database applications:

1. **Local SQLite Backup & Restore**:
   - Instant manual snapshot of the database file (`.db`) into a dedicated `/backups` directory.
   - Timestamped file naming: `backup-YYYY-MM-DD-HH-mm-ss.db`.
   - **Fail-Safe Restoration**: Automatically creates a local safety snapshot *before* overwriting the database. If restoration fails, it immediately rolls back to the safety state.
   - Security path traversal guards to prevent unauthorized file access.
2. **Google Drive Cloud Sync**:
   - OAuth 2.0 authentication flow with local token persistence.
   - Automatic creation of a dedicated app folder in the user's Google Drive (`MandaiMitra_Backups`).
   - Direct stream upload of database snapshots to cloud.
   - List and download/restore database files directly from Google Drive.
3. **Connectivity & Status Monitoring**:
   - Built-in DNS ping to verify internet connectivity before attempting cloud actions.
   - Status indicators showing timestamp of the last local and cloud backups.

---

## 2. Environment Variables & Dependencies

### Backend Dependencies (`package.json`)
```json
{
  "dependencies": {
    "express": "^4.18.3",
    "googleapis": "^173.0.0",
    "dotenv": "^16.4.5"
  }
}
```

### Required `.env` Config
```env
# Google OAuth 2.0 Credentials (from Google Cloud Console)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/drive/oauth-callback

# Frontend URL for OAuth Callback Redirect
FRONTEND_URL=http://localhost:5173
```

---

## 3. Backend Implementation (Node.js / Express)

### A. Local Backup Service (`services/backupService.js`)

```javascript
// services/backupService.js
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { DB_PATH, reloadDb } = require('../database/db'); // Your database path and reload handle

const BACKUP_DIR = path.resolve(__dirname, '../../backups');

// Ensure backups directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function generateBackupFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `backup-${year}-${month}-${day}-${hours}-${minutes}-${seconds}.db`;
}

/** Create local database snapshot */
async function createBackup() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Database file does not exist to backup.');
  }

  const dbBuffer = fs.readFileSync(DB_PATH);
  const filename = generateBackupFilename();
  const destPath = path.join(BACKUP_DIR, filename);

  if (fs.existsSync(destPath)) {
    await new Promise((resolve) => setTimeout(resolve, 1050));
    return createBackup();
  }

  fs.writeFileSync(destPath, dbBuffer);
  const stats = fs.statSync(destPath);
  
  return {
    filename,
    size: stats.size,
    createdAt: stats.mtime.toISOString(),
  };
}

/** List all local backup files sorted by creation date (newest first) */
async function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  const files = fs.readdirSync(BACKUP_DIR);
  const backups = files
    .filter((file) => file.startsWith('backup-') && file.endsWith('.db'))
    .map((file) => {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);
      return {
        filename: file,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    });

  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Safe Database Restoration with Automated Fail-Safe Rollback */
async function restoreBackup(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid backup filename.');
  }

  // Prevent directory traversal attacks
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Access denied: Invalid backup filename format.');
  }

  const targetPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file ${filename} does not exist.`);
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error('Current database file not found.');
  }

  // 1. Create a safety backup of current active database state
  const safetyBackupBuffer = fs.readFileSync(DB_PATH);
  const safetyInfo = await createBackup();
  const safetyFilename = safetyInfo.filename;

  // 2. Read selected backup file contents
  const selectedBackupBuffer = fs.readFileSync(targetPath);

  try {
    // 3. Overwrite database file & reload DB in memory
    fs.writeFileSync(DB_PATH, selectedBackupBuffer);
    reloadDb && reloadDb(selectedBackupBuffer);
    return {
      success: true,
      restoredFile: filename,
      safetyBackup: safetyFilename,
    };
  } catch (err) {
    // 4. Rollback to safety state if restore fails
    try {
      fs.writeFileSync(DB_PATH, safetyBackupBuffer);
      reloadDb && reloadDb(safetyBackupBuffer);
    } catch (rollbackErr) {
      console.error('CRITICAL: Rollback to safety backup failed!', rollbackErr);
    }
    throw new Error(`Restore failed: ${err.message}. Database has been reverted safely.`);
  }
}

/** Get latest local backup */
async function getLatestBackupStatus() {
  const backups = await listBackups();
  return backups.length > 0 ? backups[0] : null;
}

/** Network connectivity check */
async function checkInternetStatus() {
  try {
    await dns.lookup('google.com');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  getLatestBackupStatus,
  checkInternetStatus,
  BACKUP_DIR,
};
```

---

### B. Google Drive Cloud Service (`services/googleDriveBackupService.js`)

```javascript
// services/googleDriveBackupService.js
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { DB_PATH, reloadDb } = require('../database/db');
const backupService = require('./backupService');

const TOKENS_PATH = path.resolve(__dirname, '../../database/drive_tokens.json');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Auto-save refreshed tokens back to disk
oauth2Client.on('tokens', (tokens) => {
  saveTokens(tokens);
});

function saveTokens(tokens) {
  let current = {};
  if (fs.existsSync(TOKENS_PATH)) {
    try { current = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); } catch (e) {}
  }
  const merged = { ...current, ...tokens };
  const dir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  oauth2Client.setCredentials(merged);
  return merged;
}

function loadTokens() {
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
      oauth2Client.setCredentials(tokens);
      return tokens;
    } catch (err) {}
  }
  return null;
}

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
}

async function handleCallback(code) {
  if (!code) throw new Error('Authorization code required.');
  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

async function disconnectDrive() {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  oauth2Client.setCredentials(null);
  return { success: true };
}

async function getDriveStatus() {
  const tokens = loadTokens();
  return { connected: !!tokens };
}

async function getOrCreateFolder(drive) {
  const response = await drive.files.list({
    q: "name = 'MandaiMitra_Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  const folder = await drive.files.create({
    resource: { name: 'MandaiMitra_Backups', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });

  return folder.data.id;
}

async function uploadBackupToDrive() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Google Drive is not connected.');

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const folderId = await getOrCreateFolder(drive);

  const now = new Date();
  const filename = `backup-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}.db`;

  const response = await drive.files.create({
    resource: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(DB_PATH) },
    fields: 'id, name, size, createdTime',
  });

  return {
    id: response.data.id,
    filename: response.data.name,
    size: Number(response.data.size || 0),
    createdAt: response.data.createdTime,
  };
}

async function listDriveBackups() {
  const tokens = loadTokens();
  if (!tokens) return [];

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const folderId = await getOrCreateFolder(drive);

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, size, createdTime)',
    orderBy: 'createdTime desc',
  });

  return (response.data.files || []).map((file) => ({
    id: file.id,
    filename: file.name,
    size: Number(file.size || 0),
    createdAt: file.createdTime,
  }));
}

async function restoreFromDrive(driveFileId) {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Google Drive is not connected.');

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // 1. Create local safety backup first
  const safetyBackupBuffer = fs.readFileSync(DB_PATH);
  const safetyInfo = await backupService.createBackup();

  const tempDownloadPath = path.join(backupService.BACKUP_DIR, 'temp_drive_download.db');

  try {
    // 2. Stream download file from Drive
    const destStream = fs.createWriteStream(tempDownloadPath);
    const driveRes = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });

    await new Promise((resolve, reject) => {
      driveRes.data.on('error', reject).pipe(destStream).on('error', reject).on('finish', resolve);
    });

    // 3. Overwrite local database
    const downloadedBuffer = fs.readFileSync(tempDownloadPath);
    fs.writeFileSync(DB_PATH, downloadedBuffer);
    reloadDb && reloadDb(downloadedBuffer);

    if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath);

    return {
      success: true,
      restoredId: driveFileId,
      safetyBackup: safetyInfo.filename,
    };
  } catch (err) {
    if (fs.existsSync(tempDownloadPath)) { try { fs.unlinkSync(tempDownloadPath); } catch (e) {} }
    // Rollback to safety backup
    try {
      fs.writeFileSync(DB_PATH, safetyBackupBuffer);
      reloadDb && reloadDb(safetyBackupBuffer);
    } catch (e) {}
    throw new Error(`Drive restore failed: ${err.message}`);
  }
}

module.exports = {
  getAuthUrl,
  handleCallback,
  disconnectDrive,
  getDriveStatus,
  uploadBackupToDrive,
  listDriveBackups,
  restoreFromDrive,
};
```

---

### C. Controllers & Routes

#### `controllers/backupController.js` & `controllers/googleDriveController.js`

```javascript
// routes/backupRoutes.js
const express = require('express');
const router = express.Router();
const backupService = require('../services/backupService');

router.post('/local', async (req, res, next) => {
  try {
    const data = await backupService.createBackup();
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/list', async (req, res, next) => {
  try {
    const data = await backupService.listBackups();
    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
});

router.post('/restore', async (req, res, next) => {
  try {
    const { filename } = req.body;
    const data = await backupService.restoreBackup(filename);
    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/status', async (req, res, next) => {
  try {
    const data = await backupService.getLatestBackupStatus();
    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/internet-status', async (req, res, next) => {
  try {
    const online = await backupService.checkInternetStatus();
    res.status(200).json({ success: true, data: { online } });
  } catch (err) { next(err); }
});

module.exports = router;
```

```javascript
// routes/googleDriveRoutes.js
const express = require('express');
const router = express.Router();
const driveService = require('../services/googleDriveBackupService');

router.get('/auth-url', (req, res) => res.json({ success: true, authUrl: driveService.getAuthUrl() }));
router.get('/oauth-callback', async (req, res, next) => {
  try {
    await driveService.handleCallback(req.query.code);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/backup?drive_connected=true`);
  } catch (err) { next(err); }
});
router.get('/status', async (req, res, next) => {
  try { res.json({ success: true, data: await driveService.getDriveStatus() }); } catch (err) { next(err); }
});
router.post('/backup', async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await driveService.uploadBackupToDrive() }); } catch (err) { next(err); }
});
router.get('/backups', async (req, res, next) => {
  try { res.json({ success: true, data: await driveService.listDriveBackups() }); } catch (err) { next(err); }
});
router.post('/restore', async (req, res, next) => {
  try { res.json({ success: true, data: await driveService.restoreFromDrive(req.body.fileId) }); } catch (err) { next(err); }
});
router.post('/disconnect', async (req, res, next) => {
  try { res.json({ success: true, data: await driveService.disconnectDrive() }); } catch (err) { next(err); }
});

module.exports = router;
```

---

## 4. Frontend Implementation (React Custom Hooks)

### A. Local Backup Hook (`hooks/useBackup.js`)

```javascript
// hooks/useBackup.js
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export default function useBackup() {
  const [backups, setBackups] = useState([]);
  const [lastBackup, setLastBackup] = useState(null);
  const [internetOnline, setInternetOnline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBackups = useCallback(async () => {
    const { data } = await axios.get('/api/backup/list');
    if (data.success) setBackups(data.data || []);
  }, []);

  const fetchLastBackupStatus = useCallback(async () => {
    const { data } = await axios.get('/api/backup/status');
    if (data.success) setLastBackup(data.data);
  }, []);

  const fetchInternetStatus = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/backup/internet-status');
      if (data.success) setInternetOnline(data.data.online);
    } catch {
      setInternetOnline(false);
    }
  }, []);

  const createLocalBackup = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/backup/local');
      if (data.success) {
        await Promise.all([fetchBackups(), fetchLastBackupStatus()]);
        return data.data;
      }
    } finally { setLoading(false); }
  }, [fetchBackups, fetchLastBackupStatus]);

  const restoreBackup = useCallback(async (filename) => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/backup/restore', { filename });
      if (data.success) {
        await Promise.all([fetchBackups(), fetchLastBackupStatus()]);
        return data.data;
      }
    } finally { setLoading(false); }
  }, [fetchBackups, fetchLastBackupStatus]);

  useEffect(() => {
    fetchBackups();
    fetchLastBackupStatus();
    fetchInternetStatus();
    const interval = setInterval(fetchInternetStatus, 30000); // 30-sec polling for internet status
    return () => clearInterval(interval);
  }, [fetchBackups, fetchLastBackupStatus, fetchInternetStatus]);

  return {
    backups,
    lastBackup,
    internetOnline,
    loading,
    error,
    createLocalBackup,
    restoreBackup,
  };
}
```

---

### B. Google Drive Hook (`hooks/useGoogleDrive.js`)

```javascript
// hooks/useGoogleDrive.js
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export default function useGoogleDrive() {
  const [connected, setConnected] = useState(false);
  const [driveBackups, setDriveBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/drive/status');
      if (data.success) {
        setConnected(data.data.connected);
        return data.data.connected;
      }
    } catch (e) {}
    return false;
  }, []);

  const fetchDriveBackups = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/drive/backups');
      if (data.success) setDriveBackups(data.data || []);
    } catch (e) {}
  }, []);

  const connectDrive = useCallback(async () => {
    const { data } = await axios.get('/api/drive/auth-url');
    if (data.success && data.authUrl) {
      window.location.href = data.authUrl;
    }
  }, []);

  const disconnectDrive = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/drive/disconnect');
      if (data.success) {
        setConnected(false);
        setDriveBackups([]);
        setSuccess('Disconnected from Google Drive.');
      }
    } finally { setLoading(false); }
  }, []);

  const backupToDrive = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/drive/backup');
      if (data.success) {
        setSuccess(`Uploaded to Drive: ${data.data.filename}`);
        await fetchDriveBackups();
        return data.data;
      }
    } finally { setLoading(false); }
  }, [fetchDriveBackups]);

  const restoreFromDrive = useCallback(async (fileId) => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/drive/restore', { fileId });
      if (data.success) {
        setSuccess('Database restored successfully from Google Drive backup.');
        return data.data;
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const isConnected = await fetchStatus();
      if (isConnected) await fetchDriveBackups();

      const params = new URLSearchParams(window.location.search);
      if (params.get('drive_connected') === 'true') {
        setSuccess('Connected to Google Drive successfully!');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    })();
  }, [fetchStatus, fetchDriveBackups]);

  return {
    connected,
    driveBackups,
    loading,
    error,
    success,
    connectDrive,
    disconnectDrive,
    backupToDrive,
    restoreFromDrive,
  };
}
```

---

## 5. API Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/backup/local` | Create a new local backup snapshot |
| `GET` | `/api/backup/list` | List all local backups sorted by timestamp |
| `POST` | `/api/backup/restore` | Restore database from local backup (with auto safety backup) |
| `GET` | `/api/backup/status` | Get metadata of latest local backup |
| `GET` | `/api/backup/internet-status` | Ping DNS to test active internet connection |
| `GET` | `/api/drive/auth-url` | Generate Google Drive OAuth consent URL |
| `GET` | `/api/drive/oauth-callback` | Google OAuth callback handler |
| `GET` | `/api/drive/status` | Check if Google Drive account is linked |
| `POST` | `/api/drive/backup` | Stream current database snapshot to Google Drive |
| `GET` | `/api/drive/backups` | List backups stored in user's Drive folder |
| `POST` | `/api/drive/restore` | Download and restore database from Google Drive file |
| `POST` | `/api/drive/disconnect` | Revoke/delete local OAuth token file |

---

## 6. How to Integrate in a New Project

1. **Environment Setup**:
   - Register an application in [Google Cloud Console](https://console.cloud.google.com/).
   - Enable **Google Drive API**.
   - Create **OAuth 2.0 Client ID** (Web Application) and add redirect URI: `http://localhost:5000/api/drive/oauth-callback`.
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.

2. **Backend**:
   - Copy `backupService.js` and `googleDriveBackupService.js`.
   - Register routes in Express `server.js`:
     ```javascript
     app.use('/api/backup', require('./routes/backupRoutes'));
     app.use('/api/drive', require('./routes/googleDriveRoutes'));
     ```

3. **Frontend**:
   - Copy `useBackup.js` and `useGoogleDrive.js` hooks.
   - Reference `BackupPage.jsx` for UI buttons (Create Local Backup, Connect Google Drive, Restore buttons, and Internet Status badge).
