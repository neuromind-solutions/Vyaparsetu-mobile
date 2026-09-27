/**
 * SQLite database connection, on better-sqlite3.
 *
 * The previous implementation used sql.js: an in-memory database that had to be
 * re-serialized and rewritten to disk after every write. This module replaces it
 * with better-sqlite3, which talks to the file on disk directly and synchronously.
 * Two consequences run through the rest of the backend:
 *
 *   1. There is no in-memory copy to flush, so the old saveDb()-after-every-write
 *      is gone. WAL journaling makes each committed transaction durable on its
 *      own. transaction() still batches writes, but now only for atomicity, not to
 *      defer a whole-file rewrite.
 *   2. Queries are synchronous. initDb() no longer needs awaiting; callers that
 *      still `await` it are awaiting a plain value, which is harmless.
 *
 * The module also owns the app's single query surface — execSelect / execGet /
 * execRun — so the eight near-identical per-model copies of that helper are gone,
 * and prepared statements are compiled once and cached in one place.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Where the database file lives.
 *
 * Anchored to this file's own directory, not the process working directory. The
 * server was started from both the repo root and backend/ during development, and
 * a CWD-relative './database/vyapaarsetu.db' resolved to a different file each
 * way — so a day's sales entered under one launch were invisible under the other.
 * An absolute path fixed to the source tree removes that fork. The DB_PATH env
 * override still wins, which is how the tests point at throwaway files.
 */
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'vyapaarsetu.db');

let db = null;

/**
 * Prepared statements, keyed by SQL text and tied to the current handle. Cleared
 * whenever the handle is replaced (reloadDb), so a statement compiled against a
 * closed database is never reused.
 */
let statementCache = new Map();

/**
 * Connection-level settings, applied once per handle.
 *
 * WAL is the important one: readers no longer block the writer, and — the reason
 * it matters on a shop PC with no UPS — a committed transaction is made durable by
 * appending to the -wal file rather than rewriting the whole database, so a power
 * cut can no longer catch a half-written main file. foreign_keys is per-connection
 * and defaults OFF, so a reopened handle (after a restore) must set it again or
 * orphan bill_items, transactions and credit_transactions rows would insert
 * cleanly.
 */
function applyConnectionPragmas(handle) {
  handle.pragma('journal_mode = WAL');
  handle.pragma('synchronous = NORMAL'); // safe under WAL; skips an fsync per commit
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');  // wait on a locked write rather than throwing at once
}

/**
 * Opens the database, creating the file (and its directory) if absent. Idempotent:
 * the first call opens the handle, later calls return it.
 *
 * Nothing here is asynchronous any more; the name and the callers' `await` are kept
 * only for compatibility with the sql.js version, which had to load WASM.
 */
function initDb() {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(DB_PATH);
  db = new Database(DB_PATH);
  applyConnectionPragmas(db);
  statementCache = new Map();
  logger.info(existed ? `SQLite loaded from: ${DB_PATH}` : `SQLite created (new): ${DB_PATH}`);
  return db;
}

/** Returns the open handle, throwing if initDb() has not run. */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Compiles `sql` against the current handle, reusing the compiled statement when
 * the same text returns.
 */
function prepare(sql) {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
}

/**
 * sql.js bound a JS `undefined` as SQL NULL and tolerated booleans; better-sqlite3
 * rejects both outright. Normalizing here keeps the models' existing call sites
 * working: an optional field left undefined still stores NULL, and a 0/1 flag
 * passed as a boolean still stores as an integer, exactly as before.
 */
function normalizeParams(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/** Runs a SELECT (or PRAGMA read) and returns every row as a plain object. */
function execSelect(sql, params = []) {
  return prepare(sql).all(normalizeParams(params));
}

/** Runs a query expected to return one row; returns that row, or undefined. */
function execGet(sql, params = []) {
  return prepare(sql).get(normalizeParams(params));
}

/**
 * Runs an INSERT / UPDATE / DELETE and returns better-sqlite3's info object,
 * `{ changes, lastInsertRowid }`.
 */
function execRun(sql, params = []) {
  return prepare(sql).run(normalizeParams(params));
}

/**
 * Depth of transaction() nesting; 0 means none open.
 *
 * SQLite has no nested BEGIN, but the call graph nests — a service opens a
 * transaction and calls models that each want one. Counting depth lets the inner
 * calls join the outer transaction instead of failing on a second BEGIN. Every
 * model shares this one connection, so a write in an inner call is already part of
 * the open transaction; the counter only governs who issues BEGIN and COMMIT.
 */
let txDepth = 0;

/**
 * Runs `fn` inside one transaction, committing when it returns and rolling back if
 * it throws. Nested calls join the outermost transaction.
 *
 * Money operations must use this: creating an udhar sale writes three rows — the
 * transaction, the customer balance, the ledger entry — and a failure between them
 * would leave the books stating two different balances.
 */
function transaction(fn) {
  const handle = getDb();

  if (txDepth > 0) {
    return fn(); // join the open transaction; the outermost frame commits
  }

  txDepth += 1;
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    txDepth -= 1;
    return result;
  } catch (err) {
    try {
      handle.exec('ROLLBACK');
    } catch (rollbackErr) {
      logger.error(`Rollback failed: ${rollbackErr.message}`);
    }
    txDepth -= 1;
    throw err;
  }
}

/** True while a transaction() is open. */
function inTransaction() {
  return txDepth > 0;
}

/**
 * A consistent snapshot of the whole database as a Buffer, WAL content included.
 * Used to hand the current bytes to an off-machine backup (Google Drive).
 */
function serialize() {
  return getDb().serialize();
}

/**
 * Writes a consistent snapshot to `destPath` using SQLite's online backup API,
 * which is safe to run against the live connection. Returns a promise.
 */
function backupTo(destPath) {
  return getDb().backup(destPath);
}

/**
 * Folds the WAL back into the main database file so an on-disk byte copy of
 * DB_PATH is complete. TRUNCATE also shrinks the -wal file afterwards.
 */
function checkpoint() {
  getDb().pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Replaces the live database with the bytes in `fileBuffer` — the restore path.
 *
 * Under WAL the main file is not self-contained while a connection is open: recent
 * commits live in the sibling -wal file. So this closes the handle first (which
 * checkpoints and releases the -wal/-shm files), deletes any stale sidecars, then
 * writes the new bytes and reopens. Writing over DB_PATH while the old -wal still
 * sat beside it would splice two unrelated databases together.
 */
function reloadDb(fileBuffer) {
  if (db) {
    try {
      db.close();
    } catch (err) {
      logger.error(`Error closing database instance: ${err.message}`);
    }
    db = null;
  }
  statementCache = new Map();

  for (const sidecar of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }

  // Atomic replace: write a temp file and rename over DB_PATH, so a crash mid-write
  // leaves the previous file intact rather than a truncated one.
  const tempPath = `${DB_PATH}.restore.tmp`;
  fs.writeFileSync(tempPath, fileBuffer);
  fs.renameSync(tempPath, DB_PATH);

  txDepth = 0;
  db = new Database(DB_PATH);
  applyConnectionPragmas(db);
  logger.info('Database instance reloaded from buffer.');
  return db;
}

module.exports = {
  initDb,
  getDb,
  execSelect,
  execGet,
  execRun,
  transaction,
  inTransaction,
  serialize,
  backupTo,
  checkpoint,
  reloadDb,
  DB_PATH,
};
