/**
 * Database Initialization
 *
 * Two stages, in order:
 *
 *   1. The baseline schema below, created with CREATE TABLE IF NOT EXISTS. This
 *      is the shape a brand-new database is born with, and it is the single
 *      readable definition of the data model.
 *   2. Ordered migrations from ./migrations.js, which bring a database created by
 *      an older version up to the current shape. On a new database they find
 *      nothing to do.
 *
 * Safe to call repeatedly. Nothing here drops a table — the previous version of
 * this file ran `DROP TABLE bills` when a column probe failed, which erased the
 * vendor's billing history the first time old data met new code.
 *
 * One rule follows from the ordering, and breaking it stops the app from booting:
 * **the baseline may only reference columns from the oldest shape the migrations
 * start from.** `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so
 * against an older database the baseline's column list is aspiration, not fact —
 * those columns do not exist until the migrations below run. `CREATE INDEX` is not
 * so forgiving: an index over a column a migration has not added yet raises "no
 * such column" and the boot fails. So an index over a migration-added column is
 * created *by that migration*, next to the `ALTER TABLE` that adds it.
 *
 * Both helpers below run schema DDL on the raw better-sqlite3 handle initDb()
 * returns: db.exec() for parameterless CREATE/INSERT statements, a prepared
 * statement for the seed rows. There is no saveDb() step any more — better-sqlite3
 * writes straight to the file, so a committed statement is already durable.
 */

const { initDb } = require('./db');
const { runMigrations, currentVersion } = require('./migrations');
const logger = require('../utils/logger');

/**
 * Creates the baseline schema.
 *
 * Table order matters: a table is created after the tables it references, so the
 * foreign keys resolve cleanly.
 */
function createBaselineSchema(db) {
  // ─── Application Settings ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT    NOT NULL UNIQUE,
      value       TEXT    NOT NULL,
      description TEXT,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Audit Log ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action      TEXT    NOT NULL,
      table_name  TEXT    NOT NULL,
      record_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Module 1: Customers ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      mobile          TEXT    DEFAULT '',
      address         TEXT    DEFAULT '',
      search_keywords TEXT    DEFAULT '',
      notes           TEXT    DEFAULT '',
      credit_balance  INTEGER DEFAULT 0,
      commission_rate REAL    DEFAULT NULL,
      is_deleted      INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Module 2: Vegetables ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS vegetables (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL UNIQUE,
      rate            INTEGER NOT NULL DEFAULT 0,
      unit            TEXT    NOT NULL DEFAULT 'kg',
      search_keywords TEXT    DEFAULT '',
      notes           TEXT    DEFAULT '',
      is_deleted      INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Module 3: Billing ─────────────────────────────────────────────────────
  // commission_rate is a percentage (8.0 means 8%), matching what Settings shows.
  //
  // period_start / period_end are NULL for a single-day bill, which is every bill
  // written before ranges existed — the day is then `date`. When they are set, the
  // bill consolidates every unbilled sale in that window and `date` is the day it
  // closes, so date-keyed reports still place it in one period.
  db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_number        TEXT    NOT NULL UNIQUE,
      customer_id        INTEGER NOT NULL,
      date               TEXT    NOT NULL,
      period_start       TEXT,
      period_end         TEXT,
      subtotal           INTEGER NOT NULL,
      discount_type      TEXT    DEFAULT 'fixed',
      discount_value     REAL    DEFAULT 0.0,
      discount_amount    INTEGER DEFAULT 0,
      commission_rate    REAL    DEFAULT 8.0,
      commission_amount  INTEGER NOT NULL,
      hamali_amount      INTEGER DEFAULT 0,
      transport_amount   INTEGER DEFAULT 0,
      final_amount       INTEGER NOT NULL,
      paid_amount        INTEGER DEFAULT 0,
      remaining_amount   INTEGER DEFAULT 0,
      payment_type       TEXT    NOT NULL,
      payment_status     TEXT    NOT NULL,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
  `);

  // item_date is the day this line was actually sold, so a range bill can group its
  // lines datewise. NULL means the line belongs to whatever single day its bill does.
  db.exec(`
    CREATE TABLE IF NOT EXISTS bill_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id        INTEGER NOT NULL,
      vegetable_id   INTEGER NOT NULL,
      vegetable_name TEXT    NOT NULL,
      quantity       REAL    NOT NULL,
      rate           INTEGER NOT NULL,
      total          INTEGER NOT NULL,
      item_date      TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(bill_id) REFERENCES bills(id),
      FOREIGN KEY(vegetable_id) REFERENCES vegetables(id)
    )
  `);

  // ─── Module 5: Customer Vegetable Transactions ─────────────────────────────
  // Created before credit_transactions because ledger rows point back at these.
  //
  // commission_rate is a percentage, the same unit as bills.commission_rate.
  // bill_id is NULL until the day's sales are consolidated into a bill; that is
  // what makes bill generation idempotent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id             INTEGER NOT NULL,
      vegetable_id            INTEGER NOT NULL,
      vegetable_name_snapshot TEXT    NOT NULL,
      weight                  REAL    NOT NULL,
      unit                    TEXT    NOT NULL DEFAULT 'kg',
      rate                    INTEGER NOT NULL,
      base_amount             INTEGER NOT NULL,
      commission_rate         REAL    NOT NULL DEFAULT 8.0,
      commission_amount       INTEGER NOT NULL,
      final_amount            INTEGER NOT NULL,
      payment_type            TEXT    DEFAULT 'Credit',
      payment_mode            TEXT    DEFAULT 'Credit',
      paid_amount             INTEGER DEFAULT 0,
      remaining_amount        INTEGER DEFAULT 0,
      transaction_date        TEXT    NOT NULL,
      bill_id                 INTEGER,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id)  REFERENCES customers(id),
      FOREIGN KEY(vegetable_id) REFERENCES vegetables(id),
      FOREIGN KEY(bill_id)      REFERENCES bills(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_date
    ON transactions(customer_id, transaction_date)
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`);
  // No index on transactions(bill_id) here — see the note below on why an index
  // over a migration-added column belongs to its migration.

  // ─── Module 4: Credit Transactions (the udhar passbook) ────────────────────
  // transaction_id links a ledger row to the sale that created it, so deleting
  // the sale can reverse exactly the debt it booked.
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id                INTEGER NOT NULL,
      bill_id                    INTEGER,
      transaction_id             INTEGER,
      transaction_type           TEXT    NOT NULL,
      amount                     INTEGER NOT NULL,
      payment_mode               TEXT    NOT NULL,
      note                       TEXT,
      balance_after_transaction  INTEGER NOT NULL,
      created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id)    REFERENCES customers(id),
      FOREIGN KEY(bill_id)        REFERENCES bills(id),
      FOREIGN KEY(transaction_id) REFERENCES transactions(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_customer
    ON credit_transactions(customer_id)
  `);
  // idx_credit_transactions_transaction is created by migration 6, alongside the
  // column it indexes.
}

/**
 * Inserts the settings the app reads at runtime, leaving any the vendor has
 * already changed alone.
 */
function seedSettings(db) {
  const seedData = [
    ['language', 'en', 'UI display language (en or mr)'],
    ['app_version', '1.0.0', 'Application version'],
    ['vendor_name', '', 'Vendor / Shop name'],
    ['tagline', '', 'Business Tagline / Nature of work'],
    ['owner_name', '', 'Owner / Proprietor name'],
    ['mobile_number', '', 'Primary Mobile number'],
    ['secondary_mobile', '', 'Secondary / WhatsApp mobile number'],
    ['market_name', '', 'APMC Market name'],
    ['gala_number', '', 'Shop / Gala number'],
    ['address', '', 'Business address'],
    ['city', '', 'City / Jurisdiction'],
    ['devotion_text', '', 'Header devotion / blessing text'],
    ['bill_footer_note', '', 'Bill footer note or terms'],
    ['upi_id', '', 'UPI ID for payments'],
    ['commission_rate', '8', 'Commission percentage rate'],
    ['default_payment_mode', 'Cash', 'Default payment type mode'],
    ['units', JSON.stringify(['kg', 'piece', 'bundle', 'dozen', 'gram', 'liter', 'crate', 'bag', 'quintal']), 'Configurable measurement units list'],
    ['categories', JSON.stringify(['पालेभाज्या (Leafy)', 'फळभाज्या (Fruit)', 'कंदमुळे (Roots/Tubers)', 'मिरची व मसाले (Chilli & Spices)', 'सर्वसाधारण (General)']), 'Configurable vegetable categories list'],
    ['db_dirty', '0', 'Flag indicating unbacked-up database modifications (1 or 0)'],
    ['last_data_change', '', 'Timestamp of last modification in business tables'],
    ['last_cloud_sync', '', 'Timestamp of last successful Google Drive cloud sync'],
    ['last_synced_hash', '', 'SHA-256 hash of database at last cloud sync'],
    ['drive_backup_file_id', '', 'Canonical Google Drive backup file ID'],
    ['google_client_id', '', 'Google OAuth 2.0 Client ID'],
    ['google_client_secret', '', 'Google OAuth 2.0 Client Secret'],
    ['google_redirect_uri', 'http://127.0.0.1:5000/api/drive/callback', 'Google OAuth 2.0 Redirect URI'],
    ['custom_backup_folder', '', 'User-configured cloud sync / external backup directory path'],
    ['auto_backup_enabled', '1', 'Flag indicating whether automatic backup sync is enabled (1 or 0)'],
  ];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)`
  );
  for (const [key, value, description] of seedData) {
    insert.run(key, value, description);
  }
}

/**
 * Creates lightweight change detection triggers on business tables.
 * Whenever data is inserted, updated, or deleted, db_dirty is set to '1'
 * and last_data_change is updated to the current timestamp.
 */
function createChangeTrackingTriggers(db) {
  const businessTables = [
    'bills',
    'bill_items',
    'customers',
    'vegetables',
    'transactions',
    'credit_transactions',
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
      logger.warn(`Could not create change-tracking trigger for ${tbl}: ${err.message}`);
    }
  }
}

/**
 * Brings the database to the current schema. Called once at boot.
 */
async function initializeDatabase() {
  const db = initDb();

  try {
    createBaselineSchema(db);
    runMigrations(db);
    seedSettings(db);
    createChangeTrackingTriggers(db);

    logger.info(`Database initialized successfully (schema version ${currentVersion(db)})`);
  } catch (err) {
    logger.error(`Database initialization failed: ${err.message}`);
    throw err;
  }
}

module.exports = { initializeDatabase, createChangeTrackingTriggers };
