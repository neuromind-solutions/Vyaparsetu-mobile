/**
 * VyapaarSetu — Electron main process.
 *
 * Runs the existing Express backend in-process and points a BrowserWindow at it,
 * so one program on one origin serves both the API and the built React SPA — no
 * terminal, no browser tab.
 *
 * Writable data (database, backups, Drive tokens) is routed to a per-user folder
 * via app.getPath('userData') — %APPDATA%/VyapaarSetu on Windows — because once the
 * app is installed under Program Files, its own directory is read-only to it.
 */

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dotenv = require('dotenv');

// Load environment variables (.env) from root and backend in dev mode only.
// In a packaged app, force NODE_ENV=production and ensure bypass flags cannot persist.
if (!app.isPackaged) {
  dotenv.config({ path: path.join(__dirname, '../.env') });
  dotenv.config({ path: path.join(__dirname, '../backend/.env') });
} else {
  process.env.NODE_ENV = 'production';
  delete process.env.LICENSE_DEV_BYPASS;
}


// Expose open-external handler for system browser opening
ipcMain.handle('open-external', async (_, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});

// Expose native folder selection dialog
ipcMain.handle('select-backup-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win || null, {
    title: 'Select Backup / Cloud Sync Folder',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Select Folder',
  });
  return result;
});

// Expose opening folder in Windows File Explorer
ipcMain.handle('open-backup-folder', async (_, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
    return { success: true };
  }
  return { success: false, error: 'Folder does not exist.' };
});

/**
 * Checks internet connectivity without DNS spam
 */
function checkOnline() {
  return new Promise((resolve) => {
    const req = http.get('http://clients3.google.com/generate_204', (res) => {
      resolve(res.statusCode === 204);
      res.resume();
    });
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/**
 * Starts the change-triggered auto cloud & folder backup runner.
 * Runs every 15 seconds:
 *   - Checks dirty triggers and auto-syncs to configured local & cloud folders
 */
function setupAutoCloudBackup(port) {
  let isSyncing = false;

  async function runAutoBackup() {
    if (isSyncing) return; // Prevent overlapping runs

    try {
      isSyncing = true;
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/backup/auto-sync',
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

      if (res.body) {
        try {
          const data = JSON.parse(res.body);
          if (data.success && !data.skipped) {
            log(`[AutoBackup] ✓ Data changes detected & synced to backup destinations (${data.data?.filename})`);
          }
        } catch (_) {}
      }
    } catch (err) {
      log(`[AutoBackup] ${err.message}`);
    } finally {
      isSyncing = false;
    }
  }

  // Initial check 10 seconds after startup, then checks dirty state every 60 seconds
  setTimeout(runAutoBackup, 10000);
  setInterval(runAutoBackup, 60000);
}

// --- File logging -----------------------------------------------------------
// A packaged GUI app has no console, so console output is lost — including on a
// client's machine where we can't attach a terminal. Everything important is
// mirrored to <userData>/logs/main.log so failures are diagnosable after the
// fact. Written defensively: logging must never crash the app.
let logStream = null;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!logStream) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(path.join(dir, 'main.log'), { flags: 'a' });
    }
    logStream.write(line);
  } catch {
    /* ignore logging failures */
  }
  try {
    process.stdout.write(line);
  } catch {
    /* no console attached */
  }
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
});

// Disable GPU hardware acceleration. On some Windows GPUs/drivers the compositor
// never presents a first frame, so 'ready-to-show' never fires and the window
// stays hidden even though the app is running (4 live processes, no window).
// Software compositing is more than enough for this CRUD UI and is far more
// robust across the varied client machines this now ships to.
app.disableHardwareAcceleration();

const { registerWhatsAppShareHandler } = require('./whatsappShareHandler');

// Register IPC handlers
registerWhatsAppShareHandler();

// Ports the backend tries, in order, before letting the OS pick one.
//
// This used to be `port: 0` — a different port every launch. The browser scopes
// localStorage per *origin*, and the port is part of the origin, so every launch
// looked like a brand-new site: the vendor's language choice (मराठी) and the
// transliteration toggle silently reverted to their defaults every single time the
// app was opened. A stable port keeps those preferences. The list is a short ladder
// rather than one number so another program holding the port is a fallback, not a
// failure; these are high and uncommon enough that in practice the first one wins.
const PREFERRED_PORTS = [5000, 5001, 47821, 47822, 47823, 47824, 47825];

// Single-instance: a second launch reveals the running window rather than
// starting a second server against the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    log('second-instance: revealing existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  /**
   * Point the backend at writable, per-user locations, make sure those folders
   * exist, then start Express. Runs before requiring the backend because db.js
   * reads DB_PATH at module load. Returns the OS-assigned port.
   */
  async function startBackend() {
    const userData = app.getPath('userData'); // %APPDATA%/VyapaarSetu
    if (app.isPackaged) {
      process.env.NODE_ENV = 'production';
      delete process.env.LICENSE_DEV_BYPASS;
    } else {
      process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    }
    process.env.DB_PATH = path.join(userData, 'data', 'vyapaarsetu.db');
    process.env.BACKUP_DIR = path.join(userData, 'backups');
    process.env.DRIVE_TOKENS_PATH = path.join(userData, 'drive_tokens.json');
    process.env.LICENSE_PATH = path.join(userData, 'license.json');
    process.env.FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
    // The backend's logger writes here too, alongside this process's main.log.
    // Without it every backend log line goes to a stdout that does not exist in a
    // packaged GUI app, and a client's failure leaves no trace at all.
    process.env.LOG_DIR = path.join(userData, 'logs');

    // better-sqlite3 creates the file but not its parent directory.
    fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
    fs.mkdirSync(process.env.BACKUP_DIR, { recursive: true });

    log(`starting backend; userData=${userData}`);
    const { startServer } = require('../backend/server.js');
    // Binds loopback only — see the DEFAULT_HOST note in backend/server.js.
    const { port } = await startServer({ port: PREFERRED_PORTS });
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/drive/callback';
    log(`backend started on http://127.0.0.1:${port}`);

    // If backend runs on a high port (e.g. 47821), start a port 5000 forwarder
    // so Google OAuth callbacks hitting http://127.0.0.1:5000/api/drive/* are
    // automatically routed to this running instance without ERR_CONNECTION_REFUSED.
    startOAuthPortForwarder(port);

    return port;
  }

  function startOAuthPortForwarder(targetPort) {
    if (targetPort === 5000) return;
    try {
      const forwarder = http.createServer((req, res) => {
        if (req.url.startsWith('/api/drive/')) {
          res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}${req.url}` });
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      forwarder.on('error', (err) => {
        log(`OAuth port forwarder on 5000 skipped: ${err.message}`);
      });
      forwarder.listen(5000, '127.0.0.1', () => {
        log(`OAuth port forwarder active: http://127.0.0.1:5000 -> ${targetPort}`);
      });
    } catch (err) {
      log(`OAuth port forwarder error: ${err.message}`);
    }
  }

  function createWindow(port) {
    log('creating window');
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      show: false,
      backgroundColor: '#ffffff',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    mainWindow.removeMenu(); // no default menu bar in the shipped app

    // Reveal the window exactly once. Normally this happens on 'ready-to-show'
    // (first frame painted); the fallback timer guarantees the window still
    // appears if that frame never comes, so the app is never running-but-invisible.
    let shown = false;
    const reveal = (why) => {
      if (shown || !mainWindow) return;
      shown = true;
      log(`showing window (${why})`);
      mainWindow.show();
      mainWindow.focus();
    };

    mainWindow.once('ready-to-show', () => reveal('ready-to-show'));
    const fallbackTimer = setTimeout(() => reveal('fallback-timeout'), 4000);

    mainWindow.webContents.on('did-finish-load', () => log('renderer: did-finish-load'));
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
      log(`renderer: did-fail-load code=${code} desc="${desc}" url=${url}`)
    );
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      log(`renderer: render-process-gone ${JSON.stringify(details)}`)
    );

    // WhatsApp share links, Google OAuth, etc. open in the system browser rather
    // than hijacking or spawning windows inside the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
      clearTimeout(fallbackTimer);
      mainWindow = null;
    });

    // 127.0.0.1 rather than "localhost": the server binds IPv4 loopback, and on
    // Windows "localhost" may resolve to ::1 first or be rewritten by a hosts-file
    // or security-suite entry. A literal address makes the origin deterministic,
    // which is also what keeps localStorage stable across launches.
    const url = `http://127.0.0.1:${port}/`;
    log(`loading ${url}`);
    mainWindow.loadURL(url);
  }

  app.whenReady().then(async () => {
    log(`app ready; electron=${process.versions.electron} node=${process.versions.node}`);
    try {
      const port = await startBackend();
      createWindow(port);
      setupAutoCloudBackup(port);
    } catch (err) {
      const msg = err && err.stack ? err.stack : String(err);
      log(`FATAL: ${msg}`);
      dialog.showErrorBox(
        'VyapaarSetu failed to start',
        `The application could not start its local server.\n\n${msg}`
      );
      app.quit();
    }
  });

  // Single-window desktop app: closing the window exits (Windows-centric target).
  app.on('window-all-closed', () => {
    log('window-all-closed; quitting');
    app.quit();
  });
}
