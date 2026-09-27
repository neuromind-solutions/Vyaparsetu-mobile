# Google Drive & Local Backup Module Implementation Guide for Electron Apps

This guide contains the complete architecture, database triggers, OAuth flow, zero-waste cloud sync logic, and production-ready source code for building an **Offline-First Local Backup & Google Drive Cloud Disaster Recovery System** in an Electron application.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Google OAuth 2.0 in Electron (The WebView Problem)](#2-google-oauth-20-in-electron-the-webview-problem)
3. [Local Backup Engine & WAL Safety](#3-local-backup-engine--wal-safety)
4. [Zero-Waste Change Detection (SQLite Triggers + SHA-256)](#4-zero-waste-change-detection-sqlite-triggers--sha-256)
5. [Google Drive API Service Implementation](#5-google-drive-api-service-implementation)
6. [Electron Background Auto-Sync Daemon](#6-electron-background-auto-sync-daemon)
7. [API Endpoints Implementation](#7-api-endpoints-implementation)
8. [Frontend UI & State Management](#8-frontend-ui--state-management)
9. [Restoration & Rollback Safety Guarantees](#9-restoration--rollback-safety-guarantees)
10. [Step-by-Step Setup Guide](#10-step-by-step-setup-guide)

---

## 1. Architecture Overview

```mermaid
flowchart TD
    subgraph Frontend["Frontend UI (React/Next.js)"]
        UI[Backup & Cloud Sync Dashboard]
        BtnSync[Manual Sync Button]
        BtnConnect[Connect Google Drive]
    end

    subgraph SQLite["SQLite Database Layer"]
        DB[(Local Database .db)]
        WAL[(WAL Journal)]
        Triggers[DB Triggers: INSERT/UPDATE/DELETE]
        SettingsTable[settings table: db_dirty=1]
    end

    subgraph ElectronMain["Electron Main Process"]
        Daemon[15s Auto-Sync Poller]
        OnlineCheck[Internet Connectivity Check]
        ExtBrowser[shell.openExternal System Browser]
    end

    subgraph DriveService["Google Drive Sync Service"]
        OAuth[OAuth2 Token Manager / Refresh]
        HashCalc[SHA-256 Hash Comparison]
        DriveAPI[Google Drive v3 API]
    end

    subgraph GoogleCloud["Google Cloud"]
        GDriveFolder[Google Drive Folder: MyApp_Backups]
        GDriveFile[myapp-backup.db (Single Overwriting File with Revisions)]
    end

    Triggers -->|Data changed| SettingsTable
    Daemon -->|Check db_dirty === 1| SettingsTable
    Daemon -->|If online| OnlineCheck
    OnlineCheck -->|Trigger| DriveService
    BtnConnect -->|OAuth URL| ExtBrowser
    ExtBrowser -->|User Grants Permission| OAuth
    DriveService -->|1. Flush WAL & Check Hash| HashCalc
    HashCalc -->|If Hash Differs| DriveAPI
    DriveAPI -->|Update / Create| GDriveFile
    DriveService -->|Reset db_dirty=0| SettingsTable
```

### Key Principles
1. **Offline First**: All business operations work 100% offline. Local backups are saved on the user's hard drive (`%LOCALAPPDATA%/MyApp/backups`).
2. **Single-File Overwrite Strategy**: Instead of creating hundreds of separate timestamped files on Google Drive that consume user storage quotas, the app updates a single canonical file (`myapp-backup.db`). Google Drive automatically preserves the full revision history behind the scenes.
3. **Zero Network Waste**: The background sync daemon only contacts Google if and only if **(1) the database was modified (`db_dirty === '1'`)**, **(2) the SHA-256 hash changed**, and **(3) the computer is online**.

---

## 2. Google OAuth 2.0 in Electron (The WebView Problem)

### Why Standard WebViews Fail
Google blocks OAuth logins inside embedded web views (`403 disallowed_useragent`). You cannot perform Google OAuth inside an `iframe`, `webview`, or standard Electron `BrowserWindow`.

### The Solution
1. When the user clicks **Connect Google Drive**, generate the Google OAuth Consent URL with the `https://www.googleapis.com/auth/drive.file` scope.
2. In Electron, call `shell.openExternal(authUrl)` to launch the user's default system browser (Chrome, Edge, Firefox).
3. Google redirects back to your local app server (e.g. `http://localhost:3000/api/drive/callback?code=...`).
4. The local server exchanges the code for tokens (`access_token`, `refresh_token`, `expiry_date`), securely writes them to `drive_tokens.json`, and redirects the user back to `/backup?drive_connected=true`.

---

## 3. Local Backup Engine & WAL Safety

SQLite in `WAL` (Write-Ahead Logging) mode maintains memory and transaction states across `.db`, `.db-wal`, and `.db-shm`. Copying the `.db` file while active transactions exist in the WAL will result in an incomplete or corrupted backup.

### `src/lib/backup-utils.ts`
```typescript
import fs from 'fs';
import path from 'path';
import db, { DATA_DIR } from '@/lib/db';

export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const WAL_PATH = path.join(DATA_DIR, 'app.db-wal');
export const SHM_PATH = path.join(DATA_DIR, 'app.db-shm');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Ensure backups folder exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function pad(n: number) { return String(n).padStart(2, '0'); }

export function generateBackupFilename(date = new Date()): string {
  return `backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.db`;
}

export interface BackupMeta {
  filename: string;
  size: number;
  createdAt: string;
}

/**
 * Flushes all uncommitted WAL transactions into the main .db file.
 * Must be executed before copying or hashing the SQLite database!
 */
export function checkpointDatabase(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err: any) {
    console.warn('[DB] WAL Checkpoint warning:', err?.message || err);
  }
}

/**
 * Validates SQLite magic header bytes ('SQLite format 3')
 */
export function isValidSqliteBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 100) return false;
  const header = buffer.subarray(0, 16).toString();
  return header.includes('SQLite format 3');
}

/**
 * Creates a local timestamped snapshot of the current database.
 */
export async function createLocalBackup(): Promise<BackupMeta> {
  if (!fs.existsSync(DB_PATH)) throw new Error('Database file does not exist.');

  // 1. Flush WAL
  checkpointDatabase();

  const filename = generateBackupFilename();
  const dest = path.join(BACKUP_DIR, filename);

  // 2. Use better-sqlite3 native backup API if available, or fallback to file copy
  try {
    if (typeof (db as any).backup === 'function') {
      await (db as any).backup(dest);
    } else {
      fs.copyFileSync(DB_PATH, dest);
    }
  } catch {
    fs.copyFileSync(DB_PATH, dest);
  }

  const stats = fs.statSync(dest);
  return { filename, size: stats.size, createdAt: stats.mtime.toISOString() };
}

/**
 * Lists all local backup files sorted newest first.
 */
export function listLocalBackups(): BackupMeta[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup-') && (f.endsWith('.db') || f.endsWith('.sqlite')))
    .map((f) => {
      const fp = path.join(BACKUP_DIR, f);
      const stats = fs.statSync(fp);
      return { filename: f, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Restores the database from a backup file with automatic safety snapshot & rollback.
 */
export async function restoreLocalBackup(filename: string): Promise<{ restoredFile: string; safetyBackup: string }> {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid backup filename.');
  }
  const target = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(target)) throw new Error(`Backup file not found: ${filename}`);

  const selectedBuffer = fs.readFileSync(target);
  if (!isValidSqliteBuffer(selectedBuffer)) {
    throw new Error('Target file is not a valid SQLite database.');
  }

  // 1. Create a safety snapshot first!
  const safety = await createLocalBackup();

  try {
    checkpointDatabase();
    fs.writeFileSync(DB_PATH, selectedBuffer);

    // 2. Clear stale WAL and SHM journal files
    if (fs.existsSync(WAL_PATH)) { try { fs.unlinkSync(WAL_PATH); } catch (_) {} }
    if (fs.existsSync(SHM_PATH)) { try { fs.unlinkSync(SHM_PATH); } catch (_) {} }

    checkpointDatabase();
    return { restoredFile: filename, safetyBackup: safety.filename };
  } catch (err: any) {
    // Rollback to safety
    try {
      const safetyPath = path.join(BACKUP_DIR, safety.filename);
      if (fs.existsSync(safetyPath)) fs.copyFileSync(safetyPath, DB_PATH);
    } catch (_) {}
    throw new Error(`Restore failed: ${err.message}. Rolled back safely.`);
  }
}
```

---

## 4. Zero-Waste Change Detection (SQLite Triggers + SHA-256)

Instead of uploading large database files every minute or scanning thousands of records, we register lightweight SQLite triggers on tables.

### Setup Triggers in `src/lib/db.ts`
```typescript
const businessTables = [
  'invoices',
  'invoice_items',
  'customers',
  'products',
  'categories',
  'transactions',
];

for (const tbl of businessTables) {
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${tbl}_insert AFTER INSERT ON ${tbl}
      BEGIN
        INSERT INTO settings(key, value) VALUES('db_dirty', '1')
          ON CONFLICT(key) DO UPDATE SET value = '1';
        INSERT INTO settings(key, value) VALUES('last_data_change', datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = datetime('now');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_${tbl}_update AFTER UPDATE ON ${tbl}
      BEGIN
        INSERT INTO settings(key, value) VALUES('db_dirty', '1')
          ON CONFLICT(key) DO UPDATE SET value = '1';
        INSERT INTO settings(key, value) VALUES('last_data_change', datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = datetime('now');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_${tbl}_delete AFTER DELETE ON ${tbl}
      BEGIN
        INSERT INTO settings(key, value) VALUES('db_dirty', '1')
          ON CONFLICT(key) DO UPDATE SET value = '1';
        INSERT INTO settings(key, value) VALUES('last_data_change', datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = datetime('now');
      END;
    `);
  } catch (err) {
    console.warn(`[DB] Could not create trigger for ${tbl}:`, err);
  }
}
```

---

## 5. Google Drive API Service Implementation

### `src/lib/drive-utils.ts`
```typescript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { google } from 'googleapis';
import db, { DATA_DIR } from '@/lib/db';
import {
  DB_PATH,
  WAL_PATH,
  SHM_PATH,
  BACKUP_DIR,
  createLocalBackup,
  checkpointDatabase,
  isValidSqliteBuffer,
} from '@/lib/backup-utils';

const TOKENS_PATH = path.join(DATA_DIR, 'drive_tokens.json');
const DRIVE_FOLDER_NAME = 'MyApp_Backups';
const BACKUP_FILE_NAME = 'myapp-backup.db';

function getSetting(key: string): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  } catch {
    return '';
  }
}

export function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || getSetting('google_client_id');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || getSetting('google_client_secret');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || getSetting('google_redirect_uri') || 'http://localhost:3000/api/drive/callback';
  return { clientId, clientSecret, redirectUri };
}

export function getOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export const oauth2Client = getOAuth2Client();

// Auto-save refreshed tokens when Google updates credentials
oauth2Client.on('tokens', (tokens) => saveTokens(tokens));

export function saveTokens(tokens: any) {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(TOKENS_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); } catch (_) {}
  }
  const merged = { ...existing, ...tokens };
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  oauth2Client.setCredentials(merged);
  return merged;
}

export function loadTokens(): Record<string, unknown> | null {
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    const { clientId, clientSecret, redirectUri } = getOAuthConfig();
    if (clientId) {
      (oauth2Client as any)._clientId = clientId;
      (oauth2Client as any)._clientSecret = clientSecret;
      (oauth2Client as any).redirectUri = redirectUri;
    }
    oauth2Client.setCredentials(t);
    return t;
  } catch (_) {
    return null;
  }
}

export function getAuthUrl(): string | null {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret) return null;

  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
}

export async function handleOAuthCallback(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

export async function disconnectDrive() {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  oauth2Client.setCredentials({});
}

async function getOrCreateFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  const res = await drive.files.list({
    q: `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id!;

  const folder = await drive.files.create({
    requestBody: { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return folder.data.id!;
}

export interface DriveFileMeta {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
}

export function computeDbHash(): string {
  if (!fs.existsSync(DB_PATH)) return '';
  checkpointDatabase();
  const fileBuffer = fs.readFileSync(DB_PATH);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

export function isDatabaseDirty(): boolean {
  const isDirtyFlag = getSetting('db_dirty') === '1';
  const lastSyncedHash = getSetting('last_synced_hash');

  if (!lastSyncedHash) {
    return fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;
  }
  if (!isDirtyFlag) return false;

  const currentHash = computeDbHash();
  if (currentHash === lastSyncedHash) {
    markDatabaseClean();
    return false;
  }
  return true;
}

export function markDatabaseClean(): void {
  try {
    db.prepare(`
      INSERT INTO settings(key, value) VALUES('db_dirty', '0')
      ON CONFLICT(key) DO UPDATE SET value = '0'
    `).run();
    db.prepare(`
      INSERT INTO settings(key, value) VALUES('last_cloud_sync', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = datetime('now')
    `).run();
  } catch (err) {
    console.warn('[DB] Could not mark clean:', err);
  }
}

/**
 * Intelligent Single-File Cloud Backup
 */
export async function upsertDriveBackup(force = false): Promise<{ file: DriveFileMeta; skipped: boolean; reason?: string }> {
  if (!loadTokens()) throw new Error('Google Drive not connected.');

  // 1. Flush WAL & compute current hash
  checkpointDatabase();
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

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const folderId = await getOrCreateFolder(drive);

  // 3. Resolve persistent fileId
  let fileId = getSetting('drive_backup_file_id');
  if (!fileId) {
    const res = await drive.files.list({
      q: `name = '${BACKUP_FILE_NAME}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive',
    });
    fileId = res.data.files?.[0]?.id ?? '';
  }

  let resultFile: DriveFileMeta | null = null;

  // 4. Try updating existing file (overwrites revision in place)
  if (fileId) {
    try {
      const res = await drive.files.update({
        fileId: fileId,
        requestBody: { name: BACKUP_FILE_NAME },
        media: { mimeType: 'application/octet-stream', body: fs.createReadStream(DB_PATH) },
        fields: 'id,name,size,modifiedTime',
      });
      resultFile = {
        id: res.data.id!,
        filename: res.data.name!,
        size: Number(res.data.size || 0),
        createdAt: res.data.modifiedTime!,
      };
    } catch (err: any) {
      console.warn('[Drive] Update failed, creating new file:', err.message);
      fileId = '';
    }
  }

  // 5. Create if first time
  if (!fileId) {
    const res = await drive.files.create({
      requestBody: { name: BACKUP_FILE_NAME, parents: [folderId] },
      media: { mimeType: 'application/octet-stream', body: fs.createReadStream(DB_PATH) },
      fields: 'id,name,size,createdTime',
    });
    resultFile = {
      id: res.data.id!,
      filename: res.data.name!,
      size: Number(res.data.size || 0),
      createdAt: res.data.createdTime!,
    };
  }

  // 6. Save metadata
  db.prepare(`
    INSERT INTO settings(key, value) VALUES('drive_backup_file_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(resultFile!.id, resultFile!.id);

  db.prepare(`
    INSERT INTO settings(key, value) VALUES('last_synced_hash', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(currentHash, currentHash);

  markDatabaseClean();
  return { file: resultFile!, skipped: false };
}
```

---

## 6. Electron Background Auto-Sync Daemon

In `electron/main.ts`, start a change-aware polling daemon that runs unobtrusively in the background.

```typescript
// electron/main.ts
import http from 'http';
import { shell, ipcMain } from 'electron';

/**
 * Checks internet connectivity without DNS spam
 */
function checkOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://clients3.google.com/generate_204', (res) => {
      resolve(res.statusCode === 204);
      res.resume();
    });
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * Starts the change-triggered auto cloud backup runner.
 * Runs every 15 seconds:
 *   - Checks if db_dirty === 1
 *   - If dirty & online & Drive connected: flushes WAL and upserts backup
 */
export function setupAutoCloudBackup(port: number): void {
  let isSyncing = false;

  async function runAutoBackup() {
    if (isSyncing) return; // Prevent overlapping runs

    try {
      const online = await checkOnline();
      if (!online) return; // Offline: gracefully wait

      isSyncing = true;
      const res = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/drive/auto-backup',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': 0 },
          },
          (response) => {
            let body = '';
            response.on('data', (d) => { body += d; });
            response.on('end', () => resolve({ statusCode: response.statusCode, body }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      const data = JSON.parse(res.body);
      if (data.success && !data.skipped) {
        console.log(`[AutoBackup] ✓ Data changes detected & synced to Drive (${data.data?.file?.size} bytes)`);
      }
    } catch (err: any) {
      console.warn(`[AutoBackup] ${err.message}`);
    } finally {
      isSyncing = false;
    }
  }

  // Initial check 5 seconds after startup, then every 15 seconds
  setTimeout(runAutoBackup, 5000);
  setInterval(runAutoBackup, 15000);
}

// Expose openExternal for OAuth flow
ipcMain.handle('open-external', async (_, url: string) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});
```

---

## 7. API Endpoints Implementation

### 1. OAuth Callback (`src/app/api/drive/callback/route.ts`)
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/drive-utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });

  try {
    await handleOAuthCallback(code);
    return NextResponse.redirect(new URL('/backup?drive_connected=true', req.nextUrl.origin));
  } catch (err: any) {
    return NextResponse.redirect(new URL(`/backup?drive_error=${encodeURIComponent(err.message)}`, req.nextUrl.origin));
  }
}
```

### 2. Auto-Backup Endpoint (`src/app/api/drive/auto-backup/route.ts`)
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { upsertDriveBackup, loadTokens, isDatabaseDirty } from '@/lib/drive-utils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!loadTokens()) {
    return NextResponse.json({ success: false, reason: 'not_connected' });
  }

  const body = await req.json().catch(() => ({}));
  const force = !!body?.force;

  if (!force && !isDatabaseDirty()) {
    return NextResponse.json({ success: true, skipped: true, reason: 'no_changes' });
  }

  try {
    const data = await upsertDriveBackup(force);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
```

---

## 8. Frontend UI & State Management

### Triggering OAuth in Electron vs Web
In your React component (`src/app/backup/page.tsx`):

```tsx
const handleConnectGoogleDrive = async () => {
  if (!driveAuthUrl) {
    toast.error('Configure GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in .env first.');
    return;
  }

  // In Electron: Open in system browser (Google blocks embedded webviews)
  if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(driveAuthUrl);
  } else {
    window.location.href = driveAuthUrl;
  }
};
```

---

## 9. Restoration & Rollback Safety Guarantees

When restoring from Google Drive or a local file:

1. **Safety Snapshot**: `createLocalBackup()` is called immediately before touching the active database file.
2. **Buffer Verification**: The downloaded cloud file is checked for SQLite magic header bytes (`SQLite format 3`).
3. **WAL / SHM Cleanup**: Any existing `.db-wal` or `.db-shm` files from the previous session are unlinked so the newly restored database is in a clean state.
4. **Automatic Rollback**: If an exception occurs at any point, the safety snapshot is copied back over `app.db`, preventing data corruption or a broken app state.

---

## 10. Step-by-Step Setup Guide for a New App

1. **Install Dependencies**:
   ```bash
   npm install googleapis better-sqlite3
   npm install --save-dev @types/better-sqlite3
   ```

2. **Google Cloud Console Setup**:
   - Create a project on [Google Cloud Console](https://console.cloud.google.com/).
   - Enable the **Google Drive API**.
   - Create **OAuth 2.0 Client IDs** (Application type: *Web application*).
   - Add Authorized redirect URI: `http://localhost:3000/api/drive/callback`.
   - Add Scopes: `.../auth/drive.file`.

3. **Configure `.env`**:
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/drive/callback
   ```

4. **Copy the Modules**:
   - `src/lib/backup-utils.ts`
   - `src/lib/drive-utils.ts`
   - `src/app/api/backup/*` and `src/app/api/drive/*`
   - Register the daemon in `electron/main.ts`.
