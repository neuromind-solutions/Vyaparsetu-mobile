/**
 * VyapaarSetu Backend — Entry Point
 * Bootstraps Express server, middleware, routes, static SPA, and SQLite database.
 *
 * Runs two ways:
 *   - `node server.js` / `npm start` — boots immediately on PORT (dev + standalone).
 *   - required by the Electron main process — which calls startServer({ port })
 *     itself, so this module must NOT auto-boot when merely imported.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env and project root .env
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./database/init');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const router = require('./routes/index');
const licenseService = require('./services/licenseService');
const logger = require('./utils/logger');

const app = express();

// The built React SPA. Overridable so the packaged app can point at its bundled
// copy; defaults to the sibling frontend/dist for a plain `npm start`.
const FRONTEND_DIST = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.join(__dirname, '../frontend/dist');

// ─── Network binding ──────────────────────────────────────────────────────────
// Loopback only. VyapaarSetu is a single-PC app: the API and the SPA exist for the
// person sitting at that machine. Express's default (all interfaces) puts the
// shop's entire customer ledger — names, mobile numbers, outstanding balances —
// on the market's wifi for any phone or laptop to read *and write*, with no
// password anywhere in the stack. HOST exists for deliberate local testing; a
// client build must never set it.
const DEFAULT_HOST = '127.0.0.1';

// Only loopback origins may call the API cross-origin. In the packaged app the SPA
// is served by this same server, so every request is same-origin and CORS never
// comes into play; this rule exists for `npm run dev`, where Vite owns :5173 and
// the API :5000. The previous `origin: '*'` meant any web page the vendor happened
// to have open could read every API response — no credentials are involved, so the
// Loopback, private LAN (Wi-Fi), and Capacitor Android origins
const ALLOWED_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?|capacitor:\/\/localhost)$/;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin(origin, callback) {
    // No Origin header: a same-origin request, curl, or the Electron renderer
    // talking to its own server. Nothing for CORS to police.
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGIN.test(origin));
  },
}));
app.set('etag', false);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.raw({ type: ['application/octet-stream', 'application/x-sqlite3'], limit: '100mb' }));
app.use(requestLogger);

// Prevent HTTP 304 Not Modified caching on dynamic financial API routes
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ─── Licensing ──────────────────────────────────────────────────────────────
// Activation endpoints must stay reachable while the app is locked, so they mount
// AHEAD of the guard. Everything else under /api requires an activated license.
// Scoped to /api, so the SPA, its static assets, and the history fallback below
// are never blocked — a locked app still loads and can render the activation gate.
app.use('/api/license', require('./routes/licenseRoutes'));
app.use('/api', function licenseGuard(req, res, next) {
  if (req.path === '/health') return next(); // liveness probe stays open
  // Crash reports must get through while the app is locked, or the one screen a
  // brand-new client sees is exactly the one we would be blind to.
  if (req.path === '/client-log') return next();
  if (licenseService.isActivated()) return next();
  return res.status(403).json({
    success: false,
    message: 'App not activated',
    code: 'LICENSE_REQUIRED',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', router);

// ─── Static SPA ───────────────────────────────────────────────────────────────
// Serve the built frontend from the same origin as the API, so one process on one
// port serves both. In dev (Vite owns 5173) frontend/dist may be absent — harmless:
// the static middleware finds nothing and the fallback hands back to the 404.
app.use(express.static(FRONTEND_DIST));

// SPA history fallback: a non-/api GET that matched no static file is a client-side
// route (BrowserRouter), so return index.html and let React route it. /api misses
// fall through to the JSON 404 below rather than being masked by HTML.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start: Initialize DB then listen ─────────────────────────────────────────

/**
 * Turn the `port` option into an ordered list of candidates to try.
 * A number or 0 becomes a single-entry list; an array passes through.
 */
function normalizePorts(port) {
  if (Array.isArray(port)) return port.filter((p) => p != null);
  if (port != null) return [port];
  if (process.env.PORT) return [Number(process.env.PORT), 5001];
  return [5000, 5001];
}

/** Bind one port, resolving with the server once it is actually listening. */
function listenOnce(port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      // Hand the socket off: from here a network error is a runtime event to log,
      // not a startup failure, and rejecting a settled promise would swallow it.
      server.removeListener('error', reject);
      server.on('error', (err) => logger.error(`HTTP server error: ${err.message}`));
      resolve({ server, port: server.address().port });
    });
    server.once('error', reject);
  });
}

/**
 * Bind the first free port from `candidates`, falling back to an OS-assigned one.
 *
 * A client PC is not a controlled environment — another program may already hold
 * the port we prefer. Walking the list and ending on 0 means a conflict costs us a
 * stable origin (and with it the browser's per-origin localStorage) instead of
 * leaving the vendor with an app that refuses to start at all.
 */
async function listenOnFirstFreePort(candidates, host) {
  const queue = [...candidates, 0]; // 0 = let the OS pick; the guaranteed tail
  let lastErr;
  for (const port of queue) {
    try {
      return await listenOnce(port, host);
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      lastErr = err;
      logger.warn(`Port ${port} is unavailable (${err.code}); trying the next candidate.`);
    }
  }
  throw lastErr;
}

/**
 * Initialize the database, then start listening on loopback.
 * @param {object} [opts]
 * @param {number|number[]} [opts.port] Port to bind, or an ordered list of
 *   candidates to try in turn. 0 lets the OS assign a free port. If every
 *   candidate is taken, an OS-assigned port is used rather than failing to boot.
 * @param {string} [opts.host] Bind address. Defaults to loopback; override only
 *   for deliberate local testing.
 * @returns {Promise<{ server: import('http').Server, port: number }>}
 */
async function startServer({ port, host } = {}) {
  const candidates = normalizePorts(port);
  const bindHost = host || process.env.HOST || DEFAULT_HOST;
  await initializeDatabase();

  const result = await listenOnFirstFreePort(candidates, bindHost);
  logger.info(`VyapaarSetu backend running on http://${bindHost}:${result.port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Auto-bill any unbilled transactions from past days (fire-and-forget)
  const { autoBillPastTransactions } = require('./services/transactionService');
  autoBillPastTransactions().catch((err) =>
    logger.error(`Auto-bill startup task failed: ${err.message}`)
  );

  return result;
}

// Boot immediately only when run directly (node server.js / npm start). When the
// Electron main process requires this module, it calls startServer() itself.
if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, startServer };
