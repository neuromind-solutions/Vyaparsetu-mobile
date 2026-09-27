/**
 * Google Drive Controller
 * Exposes API endpoints for OAuth authorization generation, callback handling,
 * auto-backup synchronization, manual sync, listing, unlinking, and restoring.
 */

const driveService = require('../services/googleDriveBackupService');

/**
 * GET /api/drive/auth-url
 */
function getAuthUrl(req, res, next) {
  try {
    const authUrl = driveService.getAuthUrl();
    res.status(200).json({
      success: true,
      authUrl,
    });
  } catch (err) {
    next(err);
  }
}

async function handleCallback(req, res, next) {
  try {
    const { code, error } = req.query;
    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Google Drive Authentication Failed - VyapaarSetu</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fdf2f2; color: #991b1b; }
            .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.08); max-width: 460px; text-align: center; border: 1px solid #fecaca; }
            h2 { margin-top: 0; color: #dc2626; font-size: 1.35rem; }
            p { color: #4b5563; font-size: 0.95rem; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Authentication Cancelled or Failed</h2>
            <p>${encodeURIComponent(error)}</p>
            <p>You can close this tab and try again from the VyapaarSetu app.</p>
          </div>
        </body>
        </html>
      `);
    }
    if (!code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Code Missing</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h3>Authorization code missing.</h3>
          <p>Please return to VyapaarSetu and click Connect again.</p>
        </body>
        </html>
      `);
    }

    await driveService.handleCallback(code);
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Drive Connected - VyapaarSetu</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #f0fdf4;
            color: #166534;
            text-align: center;
          }
          .card {
            background: white;
            padding: 3rem 2.5rem;
            border-radius: 1.25rem;
            box-shadow: 0 10px 25px rgba(0,0,0,0.08);
            max-width: 480px;
            border: 1px solid #bbf7d0;
          }
          .icon {
            font-size: 3.5rem;
            margin-bottom: 1rem;
          }
          h2 {
            margin: 0 0 0.75rem 0;
            color: #15803d;
            font-size: 1.5rem;
          }
          p {
            color: #4b5563;
            line-height: 1.5;
            margin: 0.5rem 0;
          }
          .badge {
            display: inline-block;
            background: #dcfce7;
            color: #166534;
            padding: 0.35rem 0.85rem;
            border-radius: 9999px;
            font-weight: 600;
            font-size: 0.875rem;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h2>Google Drive Connected!</h2>
          <p>VyapaarSetu is now connected to your Google Drive for automated cloud backups.</p>
          <p><strong>You can close this tab now and return to the VyapaarSetu application.</strong></p>
          <div class="badge">Connection Active</div>
        </div>
        <script>
          setTimeout(() => {
            try { window.close(); } catch(e) {}
          }, 3500);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Connection Error - VyapaarSetu</title></head>
      <body style="font-family:system-ui,sans-serif;padding:50px;text-align:center;background:#fdf2f2;color:#991b1b;">
        <h2>Google Drive Connection Error</h2>
        <p>${err.message}</p>
        <p>Please return to the Backup page in VyapaarSetu and try again.</p>
      </body>
      </html>
    `);
  }
}

/**
 * GET /api/drive/status
 */
async function getStatus(req, res, next) {
  try {
    const status = await driveService.getDriveStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/drive/auto-backup
 * Background auto-sync endpoint invoked by the Electron daemon.
 * Skips gracefully if not connected or if database has no changes.
 */
async function autoBackup(req, res, next) {
  try {
    const status = await driveService.getDriveStatus();
    if (!status.connected) {
      return res.status(200).json({ success: false, reason: 'not_connected' });
    }

    const force = !!req.body?.force;
    if (!force && !driveService.isDatabaseDirty()) {
      return res.status(200).json({ success: true, skipped: true, reason: 'no_changes' });
    }

    const data = await driveService.upsertDriveBackup(force);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/drive/backup
 * Manual sync triggered from UI.
 */
async function backup(req, res, next) {
  try {
    const force = req.body?.force !== false;
    const data = await driveService.upsertDriveBackup(force);
    res.status(201).json({
      success: true,
      message: data.skipped ? 'Database unchanged; cloud sync skipped.' : 'Database backup synced to Google Drive successfully.',
      data: data.file,
      skipped: data.skipped,
      reason: data.reason,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/drive/backups
 */
async function listBackups(req, res, next) {
  try {
    const backups = await driveService.listDriveBackups();
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
 * POST /api/drive/restore
 */
async function restore(req, res, next) {
  try {
    const { fileId } = req.body || {};
    const data = await driveService.restoreFromDrive(fileId);
    res.status(200).json({
      success: true,
      message: 'Database restored from Google Drive successfully.',
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/drive/disconnect
 */
async function disconnect(req, res, next) {
  try {
    const result = await driveService.disconnectDrive();
    res.status(200).json({
      success: true,
      message: 'Google Drive disconnected successfully.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getStatus,
  autoBackup,
  backup,
  listBackups,
  restore,
  disconnect,
};
