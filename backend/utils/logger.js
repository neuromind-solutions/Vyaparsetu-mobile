/**
 * Lightweight logger utility.
 * Wraps console with log levels and timestamps, and mirrors every line to a file
 * when LOG_DIR is set.
 *
 * Why the file sink exists
 * ────────────────────────
 * A packaged Windows GUI app has no console attached, so every console.* call below
 * writes to a stdout that goes nowhere. On a dev machine that is fine. On a client's
 * PC it means a support call begins with "it showed an error" and there is no way to
 * find out which — the one piece of evidence was discarded at the moment it was
 * produced. The Electron main process points LOG_DIR at %APPDATA%/VyapaarSetu/logs
 * (the same folder it writes main.log to), so backend.log sits next to it.
 *
 * Two deliberate choices:
 *
 *  - **Synchronous appends, not a write stream.** A buffered stream loses whatever
 *    is still in its buffer when the process dies, which is precisely the crash we
 *    most need the last few lines of. These lines are short and the app is
 *    single-user; the cost is irrelevant next to being able to read them.
 *  - **Size-based rotation.** This app runs on one machine for years. An unbounded
 *    log file is its own support problem.
 *
 * Logging must never be the reason the app fails, so every filesystem call here is
 * wrapped and a sink that cannot be opened is switched off rather than retried on
 * each line.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { info: 0, warn: 1, error: 2 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

const MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB
const MAX_FILES = 3; // backend.log + .1 + .2

let logFilePath = null;
let sinkDisabled = false;

/** Resolve (and create) the log file lazily. Returns null when there is no sink. */
function resolveLogFile() {
  if (sinkDisabled) return null;
  if (logFilePath) return logFilePath;

  const dir = process.env.LOG_DIR;
  if (!dir) {
    sinkDisabled = true; // console-only: `npm run dev`, tests
    return null;
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'backend.log');
    return logFilePath;
  } catch {
    sinkDisabled = true;
    return null;
  }
}

/** backend.log → .1 → .2, dropping the oldest. */
function rotate(file) {
  try {
    const oldest = `${file}.${MAX_FILES - 1}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = MAX_FILES - 2; i >= 1; i -= 1) {
      const src = `${file}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Rotation failing is not a reason to stop logging — keep appending to the
    // current file. A large log beats no log.
  }
}

function writeToFile(line) {
  const file = resolveLogFile();
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_BYTES) rotate(file);
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    /* never let logging break a request */
  }
}

function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function emit(level, consoleFn, message) {
  if (CURRENT_LEVEL > LOG_LEVELS[level]) return;
  const line = formatMessage(level, message);
  consoleFn(line);
  writeToFile(line);
}

const logger = {
  info(message) {
    emit('info', console.log, message);
  },
  warn(message) {
    emit('warn', console.warn, message);
  },
  error(message) {
    emit('error', console.error, message);
  },
};

module.exports = logger;
