/**
 * Client Log Controller
 * Receives crash reports from the React error boundary and writes them to the
 * backend log, so a renderer failure on a client's PC leaves a trace we can read.
 *
 * The renderer cannot write to disk (contextIsolation, no nodeIntegration), so the
 * only way a white-screen crash becomes diagnosable is to hand it to the server
 * that can. Fire-and-forget by design: the boundary must render its message
 * whether or not this call succeeds.
 */

const logger = require('../utils/logger');

// A stack trace is a few KB. Anything far beyond that is either a runaway loop's
// output or something we do not want appended verbatim to a file, so it is cut.
const MAX_FIELD = 4000;

function clip(value) {
  if (typeof value !== 'string') return '';
  // Collapse newlines: one report is one grep-able line, and the log is read by a
  // person scanning for the moment things went wrong.
  const flat = value.replace(/\s*\n\s*/g, ' | ').trim();
  return flat.length > MAX_FIELD ? `${flat.slice(0, MAX_FIELD)}…[truncated]` : flat;
}

/**
 * POST /api/client-log
 * Body: { message, stack, componentStack, route }
 */
function recordClientError(req, res, next) {
  try {
    const { message, stack, componentStack, route } = req.body || {};
    logger.error(
      `[renderer] ${clip(message) || 'unknown error'}` +
        `${route ? ` route=${clip(route)}` : ''}` +
        `${stack ? ` stack=${clip(stack)}` : ''}` +
        `${componentStack ? ` component=${clip(componentStack)}` : ''}`
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { recordClientError };
