/**
 * Ordered schema migrations.
 *
 * Replaces the previous approach, which probed for a column with
 * `try { SELECT col } catch { ALTER TABLE }` and — if the probe for
 * `bills.subtotal` failed — ran `DROP TABLE bills`. That silently destroyed
 * every bill on the shop PC the first time an older database met newer code.
 *
 * The rules here:
 *
 *   1. Nothing is ever dropped. A migration adds, backfills, or rebuilds while
 *      copying rows across.
 *   2. Every migration is guarded so running it against a database that already
 *      has the shape is a no-op. A brand-new database gets the correct schema
 *      straight from the baseline in init.js, then walks this list finding
 *      nothing to do. One code path serves both new and legacy databases.
 *   3. Applied versions are recorded in `schema_version`, so each runs at most
 *      once and the database can state which version it is.
 *
 * Adding a migration: append an entry with the next version number. Never edit
 * or renumber a released one — an installed shop PC has already recorded it.
 *
 * These functions operate on the raw better-sqlite3 handle (the value initDb()
 * returns), not the execSelect/execRun surface the models use: the runner has to
 * toggle `PRAGMA foreign_keys` and drive its own BEGIN/COMMIT around each
 * migration, which is below the level that surface models.
 */

const logger = require('../utils/logger');

/**
 * The schema version that `init.js`'s CREATE TABLE block produces. Databases
 * predating the migration system are stamped at this version, since that block
 * has always been the starting shape.
 */
const BASELINE_VERSION = 1;

// ─── Introspection helpers ───────────────────────────────────────────────────

/** PRAGMA table_info for a table, keyed by column name. `{}` if absent. */
function columnInfo(db, table) {
  const out = {};
  for (const col of db.pragma(`table_info(${table})`)) {
    out[col.name] = col;
  }
  return out;
}

function hasColumn(db, table, column) {
  return Object.prototype.hasOwnProperty.call(columnInfo(db, table), column);
}

function tableExists(db, table) {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** Adds a column only if it is missing, so the call is safe to repeat. */
function addColumnIfMissing(db, table, column, definition) {
  if (!tableExists(db, table) || hasColumn(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  logger.info(`  + ${table}.${column}`);
  return true;
}

/** First value of the first row, or null. */
function scalar(db, sql, params = []) {
  const value = db.prepare(sql).pluck().get(params);
  return value === undefined ? null : value;
}

// ─── The migrations ──────────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    version: 2,
    name: 'bills-add-missing-money-columns',
    /**
     * The columns the old init.js would DROP the whole bills table to obtain.
     * Adding them with defaults preserves the vendor's billing history instead.
     */
    up(db) {
      addColumnIfMissing(db, 'bills', 'subtotal', 'REAL NOT NULL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'discount_type', "TEXT DEFAULT 'fixed'");
      addColumnIfMissing(db, 'bills', 'discount_value', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'discount_amount', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'commission_rate', 'REAL DEFAULT 8.0');
      addColumnIfMissing(db, 'bills', 'hamali_amount', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'transport_amount', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'paid_amount', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'bills', 'remaining_amount', 'REAL DEFAULT 0.0');
    },
  },

  {
    version: 3,
    name: 'transactions-add-payment-columns',
    up(db) {
      addColumnIfMissing(db, 'transactions', 'payment_type', "TEXT DEFAULT 'Credit'");
      addColumnIfMissing(db, 'transactions', 'payment_mode', "TEXT DEFAULT 'Credit'");
      addColumnIfMissing(db, 'transactions', 'paid_amount', 'REAL DEFAULT 0.0');
      addColumnIfMissing(db, 'transactions', 'remaining_amount', 'REAL DEFAULT 0.0');
    },
  },

  {
    version: 4,
    name: 'add-soft-delete-flags',
    up(db) {
      addColumnIfMissing(db, 'customers', 'is_deleted', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'vegetables', 'is_deleted', 'INTEGER DEFAULT 0');
    },
  },

  {
    version: 5,
    name: 'transactions-commission-rate-as-percentage',
    /**
     * `bills.commission_rate` has always held a percentage (8.0) while
     * `transactions.commission_rate` held a fraction (0.08), and
     * `settings.commission_rate` holds '8'. Three of the four sites — including
     * the one the vendor sees in Settings — mean percentage, so percentage wins
     * and this column converts.
     *
     * SQLite cannot alter a column default, so the table is rebuilt with rows
     * copied across. Stored `commission_amount` values stay as they are: a row
     * written as base × 0.08 is already 8% of base, so relabelling the rate as
     * 8 leaves the row internally consistent.
     */
    up(db) {
      const info = columnInfo(db, 'transactions');
      if (!info.commission_rate) return;

      const defaultValue = Number(info.commission_rate.dflt_value);
      const alreadyPercentage = defaultValue === 8;

      const fractionRows = Number(
        scalar(db, `SELECT COUNT(*) FROM transactions WHERE commission_rate > 0 AND commission_rate < 1`)
      );
      if (alreadyPercentage && fractionRows === 0) return;

      // Rows charged at a literal 8.0 under fraction semantics were billed 800%
      // commission. Converting the column cannot repair those amounts, so say so
      // rather than let the figure pass as correct.
      const overcharged = Number(
        scalar(
          db,
          `SELECT COUNT(*) FROM transactions
            WHERE commission_rate >= 1
              AND commission_amount > base_amount`
        )
      );
      if (overcharged > 0) {
        logger.warn(
          `  ! ${overcharged} transaction(s) have commission greater than the goods ` +
            `themselves — charged under the 800% bug. Their stored amounts are left ` +
            `untouched; review and re-enter them.`
        );
      }

      db.exec(`
        CREATE TABLE transactions_migration_5 (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id             INTEGER NOT NULL,
          vegetable_id            INTEGER NOT NULL,
          vegetable_name_snapshot TEXT    NOT NULL,
          weight                  REAL    NOT NULL,
          unit                    TEXT    NOT NULL DEFAULT 'kg',
          rate                    REAL    NOT NULL,
          base_amount             REAL    NOT NULL,
          commission_rate         REAL    NOT NULL DEFAULT 8.0,
          commission_amount       REAL    NOT NULL,
          final_amount            REAL    NOT NULL,
          payment_type            TEXT    DEFAULT 'Credit',
          payment_mode            TEXT    DEFAULT 'Credit',
          paid_amount             REAL    DEFAULT 0.0,
          remaining_amount        REAL    DEFAULT 0.0,
          transaction_date        TEXT    NOT NULL,
          created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id)  REFERENCES customers(id),
          FOREIGN KEY(vegetable_id) REFERENCES vegetables(id)
        )
      `);

      db.exec(`
        INSERT INTO transactions_migration_5
          (id, customer_id, vegetable_id, vegetable_name_snapshot, weight, unit, rate,
           base_amount, commission_rate, commission_amount, final_amount,
           payment_type, payment_mode, paid_amount, remaining_amount,
           transaction_date, created_at, updated_at)
        SELECT
           id, customer_id, vegetable_id, vegetable_name_snapshot, weight, unit, rate,
           base_amount,
           CASE WHEN commission_rate > 0 AND commission_rate < 1
                THEN commission_rate * 100
                ELSE commission_rate
           END,
           commission_amount, final_amount,
           payment_type, payment_mode, paid_amount, remaining_amount,
           transaction_date, created_at, updated_at
        FROM transactions
      `);

      db.exec('DROP TABLE transactions');
      db.exec('ALTER TABLE transactions_migration_5 RENAME TO transactions');

      // Indexes belong to the dropped table and must be recreated.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_customer_date
        ON transactions(customer_id, transaction_date)
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`);

      logger.info(`  ~ transactions.commission_rate converted to percentage (${fractionRows} row(s))`);
    },
  },

  {
    version: 6,
    name: 'link-ledger-rows-to-transactions',
    /**
     * Without this, deleteTransaction cannot find the CREDIT_ADDED row it wrote,
     * so deleting an udhar sale removed the sale and left the debt standing.
     */
    up(db) {
      addColumnIfMissing(db, 'credit_transactions', 'transaction_id', 'INTEGER REFERENCES transactions(id)');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_transaction
        ON credit_transactions(transaction_id)
      `);
    },
  },

  {
    version: 7,
    name: 'mark-transactions-consolidated-into-a-bill',
    /**
     * NULL means the sale has not been billed yet. Bill generation claims only
     * NULL rows, which is what stops a second click from billing the same day's
     * sales twice.
     */
    up(db) {
      addColumnIfMissing(db, 'transactions', 'bill_id', 'INTEGER REFERENCES bills(id)');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_bill
        ON transactions(bill_id)
      `);
    },
  },

  {
    version: 8,
    name: 'money-columns-as-integer-paise',
    /**
     * Money moves from REAL rupees to INTEGER paise. A floating-point rupee cannot
     * represent most decimal fractions exactly, so a balance updated across many
     * sales drifts fractions of a paisa away from what its ledger sums to; whole
     * paise in an INTEGER column cannot drift. Every money column in every table is
     * rebuilt as INTEGER with its value multiplied by 100 and rounded to the
     * nearest paisa. Non-money numerics stay REAL: commission_rate is a percentage,
     * discount_value is dual-unit (rupees or a percentage), weight and quantity are
     * kilograms.
     *
     * SQLite cannot alter a column's type, so each table is rebuilt with its rows
     * copied across — the same pattern as migration 5. The runner has already
     * turned foreign keys off and opened a transaction, which is what lets the six
     * tables be dropped and recreated despite the references between them; the
     * tables are rebuilt parents-first so each one's foreign keys resolve.
     *
     * On a fresh database the baseline already declares these columns INTEGER, so
     * there is nothing to convert: the guard below returns early rather than dropping
     * and recreating six tables to reach the shape already present. That keeps a new
     * install's file small and still lands on exactly the fresh shape — which is what
     * the schema-convergence test in migration.test.js checks.
     */
    up(db) {
      // Any database predating v8 has every money column as REAL together, so one
      // column settles whether the conversion is still needed. A fresh install is
      // already INTEGER and skips the rebuild entirely — otherwise it would drop and
      // recreate six tables on first boot, inflating the file with freed pages.
      const balanceCol = columnInfo(db, 'customers').credit_balance;
      if (balanceCol && String(balanceCol.type).toUpperCase() === 'INTEGER') {
        logger.info('  ~ money columns already integer paise, nothing to convert');
        return;
      }

      // ── customers ──
      db.exec(`
        CREATE TABLE customers_migration_8 (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          name           TEXT    NOT NULL,
          mobile         TEXT    NOT NULL UNIQUE,
          address        TEXT    DEFAULT '',
          notes          TEXT    DEFAULT '',
          credit_balance INTEGER DEFAULT 0,
          is_deleted     INTEGER DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        INSERT INTO customers_migration_8
          (id, name, mobile, address, notes, credit_balance, is_deleted, created_at, updated_at)
        SELECT
          id, name, mobile, address, notes,
          CAST(ROUND(credit_balance * 100) AS INTEGER),
          is_deleted, created_at, updated_at
        FROM customers
      `);
      db.exec('DROP TABLE customers');
      db.exec('ALTER TABLE customers_migration_8 RENAME TO customers');

      // ── vegetables ──
      db.exec(`
        CREATE TABLE vegetables_migration_8 (
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
      db.exec(`
        INSERT INTO vegetables_migration_8
          (id, name, rate, unit, search_keywords, notes, is_deleted, created_at, updated_at)
        SELECT
          id, name,
          CAST(ROUND(rate * 100) AS INTEGER),
          unit, search_keywords, notes, is_deleted, created_at, updated_at
        FROM vegetables
      `);
      db.exec('DROP TABLE vegetables');
      db.exec('ALTER TABLE vegetables_migration_8 RENAME TO vegetables');

      // ── bills ──
      db.exec(`
        CREATE TABLE bills_migration_8 (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_number        TEXT    NOT NULL UNIQUE,
          customer_id        INTEGER NOT NULL,
          date               TEXT    NOT NULL,
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
      db.exec(`
        INSERT INTO bills_migration_8
          (id, bill_number, customer_id, date, subtotal, discount_type, discount_value,
           discount_amount, commission_rate, commission_amount, hamali_amount,
           transport_amount, final_amount, paid_amount, remaining_amount,
           payment_type, payment_status, created_at, updated_at)
        SELECT
          id, bill_number, customer_id, date,
          CAST(ROUND(subtotal * 100) AS INTEGER),
          discount_type, discount_value,
          CAST(ROUND(discount_amount * 100) AS INTEGER),
          commission_rate,
          CAST(ROUND(commission_amount * 100) AS INTEGER),
          CAST(ROUND(hamali_amount * 100) AS INTEGER),
          CAST(ROUND(transport_amount * 100) AS INTEGER),
          CAST(ROUND(final_amount * 100) AS INTEGER),
          CAST(ROUND(paid_amount * 100) AS INTEGER),
          CAST(ROUND(remaining_amount * 100) AS INTEGER),
          payment_type, payment_status, created_at, updated_at
        FROM bills
      `);
      db.exec('DROP TABLE bills');
      db.exec('ALTER TABLE bills_migration_8 RENAME TO bills');

      // ── bill_items ──
      db.exec(`
        CREATE TABLE bill_items_migration_8 (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id        INTEGER NOT NULL,
          vegetable_id   INTEGER NOT NULL,
          vegetable_name TEXT    NOT NULL,
          quantity       REAL    NOT NULL,
          rate           INTEGER NOT NULL,
          total          INTEGER NOT NULL,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(bill_id) REFERENCES bills(id),
          FOREIGN KEY(vegetable_id) REFERENCES vegetables(id)
        )
      `);
      db.exec(`
        INSERT INTO bill_items_migration_8
          (id, bill_id, vegetable_id, vegetable_name, quantity, rate, total, created_at)
        SELECT
          id, bill_id, vegetable_id, vegetable_name, quantity,
          CAST(ROUND(rate * 100) AS INTEGER),
          CAST(ROUND(total * 100) AS INTEGER),
          created_at
        FROM bill_items
      `);
      db.exec('DROP TABLE bill_items');
      db.exec('ALTER TABLE bill_items_migration_8 RENAME TO bill_items');

      // ── transactions ──
      db.exec(`
        CREATE TABLE transactions_migration_8 (
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
        INSERT INTO transactions_migration_8
          (id, customer_id, vegetable_id, vegetable_name_snapshot, weight, unit, rate,
           base_amount, commission_rate, commission_amount, final_amount,
           payment_type, payment_mode, paid_amount, remaining_amount,
           transaction_date, bill_id, created_at, updated_at)
        SELECT
          id, customer_id, vegetable_id, vegetable_name_snapshot, weight, unit,
          CAST(ROUND(rate * 100) AS INTEGER),
          CAST(ROUND(base_amount * 100) AS INTEGER),
          commission_rate,
          CAST(ROUND(commission_amount * 100) AS INTEGER),
          CAST(ROUND(final_amount * 100) AS INTEGER),
          payment_type, payment_mode,
          CAST(ROUND(paid_amount * 100) AS INTEGER),
          CAST(ROUND(remaining_amount * 100) AS INTEGER),
          transaction_date, bill_id, created_at, updated_at
        FROM transactions
      `);
      db.exec('DROP TABLE transactions');
      db.exec('ALTER TABLE transactions_migration_8 RENAME TO transactions');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_customer_date
        ON transactions(customer_id, transaction_date)
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_bill ON transactions(bill_id)`);

      // ── credit_transactions ──
      db.exec(`
        CREATE TABLE credit_transactions_migration_8 (
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
        INSERT INTO credit_transactions_migration_8
          (id, customer_id, bill_id, transaction_id, transaction_type, amount,
           payment_mode, note, balance_after_transaction, created_at)
        SELECT
          id, customer_id, bill_id, transaction_id, transaction_type,
          CAST(ROUND(amount * 100) AS INTEGER),
          payment_mode, note,
          CAST(ROUND(balance_after_transaction * 100) AS INTEGER),
          created_at
        FROM credit_transactions
      `);
      db.exec('DROP TABLE credit_transactions');
      db.exec('ALTER TABLE credit_transactions_migration_8 RENAME TO credit_transactions');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_customer
        ON credit_transactions(customer_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_transaction
        ON credit_transactions(transaction_id)
      `);

      logger.info('  ~ money columns converted to integer paise');
    },
  },

  {
    version: 9,
    name: 'bills-over-a-date-range',
    /**
     * A bill could only ever cover one day, so a customer who bought through the
     * week was handed seven bills. These three columns let one bill cover a range
     * and still show which day each line came from.
     *
     * All three are nullable, and NULL is the legacy shape: a bill with no
     * period_start covers the single day in `bills.date`, and a bill_item with no
     * item_date belongs to whatever day its bill does. Every existing bill therefore
     * keeps rendering exactly as it did, with no backfill and nothing to get wrong.
     *
     * These are date strings, not money — they must stay out of MONEY_FIELDS in
     * utils/money.js, or the paise conversion would multiply them by 100.
     */
    up(db) {
      addColumnIfMissing(db, 'bills', 'period_start', 'TEXT');
      addColumnIfMissing(db, 'bills', 'period_end', 'TEXT');
      addColumnIfMissing(db, 'bill_items', 'item_date', 'TEXT');

      // Range bills are looked up and grouped by the period they cover.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bills_period
        ON bills(period_start, period_end)
      `);
    },
  },

  {
    version: 10,
    name: 'vegetables-add-category-column',
    up(db) {
      addColumnIfMissing(db, 'vegetables', 'category', "TEXT DEFAULT 'General'");
    },
  },

  {
    version: 11,
    name: 'customers-optional-mobile-number',
    up(db) {
      db.exec(`
        CREATE TABLE customers_migration_11 (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          name           TEXT    NOT NULL,
          mobile         TEXT    DEFAULT '',
          address        TEXT    DEFAULT '',
          notes          TEXT    DEFAULT '',
          credit_balance INTEGER DEFAULT 0,
          is_deleted     INTEGER DEFAULT 0,
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO customers_migration_11 (id, name, mobile, address, notes, credit_balance, is_deleted, created_at, updated_at)
          SELECT id, name, COALESCE(mobile, ''), COALESCE(address, ''), COALESCE(notes, ''), credit_balance, is_deleted, created_at, updated_at
          FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_migration_11 RENAME TO customers;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile_unique 
          ON customers(mobile) 
          WHERE mobile IS NOT NULL AND mobile != '' AND is_deleted = 0;
      `);
      logger.info('  ~ customers table migrated to allow optional mobile numbers');
    },
  },

  {
    version: 12,
    name: 'reconcile-and-sync-bill-transactions',
    up(db) {
      // 1. Clean up orphaned transactions that point to a non-existent bill
      db.exec(`
        UPDATE transactions
        SET bill_id = NULL
        WHERE bill_id IS NOT NULL
          AND bill_id NOT IN (SELECT id FROM bills)
      `);

      // 2. Synchronize transactions for all existing bills
      const bills = db.prepare(`SELECT * FROM bills`).all();

      for (const bill of bills) {
        const billItems = db.prepare(`SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC`).all(bill.id);
        if (billItems.length === 0) continue;

        // Check if transactions for this bill already match
        const txs = db.prepare(`SELECT * FROM transactions WHERE bill_id = ? ORDER BY id ASC`).all(bill.id);

        // Detect if bill commission rate was corrupted (e.g. from 7% to 8%) by legacy bill edit
        let commRate = Number(bill.commission_rate || 8.0);
        if (txs.length > 0) {
          const txRates = [...new Set(txs.map((t) => Number(t.commission_rate)).filter((r) => !isNaN(r) && r >= 0))];
          if (txRates.length === 1 && txRates[0] !== commRate && commRate === 8.0) {
            commRate = txRates[0];

            // Recompute bill totals with restored commission rate
            const subtotalPaise = Number(bill.subtotal || 0);
            const discountPaise = Number(bill.discount_amount || 0);
            const basePaise = Math.max(0, subtotalPaise - discountPaise);
            const commPaise = Math.round((basePaise * commRate) / 100);
            const hamaliPaise = Number(bill.hamali_amount || 0);
            const transPaise = Number(bill.transport_amount || 0);
            const finalPaise = basePaise + commPaise + hamaliPaise + transPaise;
            const paidPaise = Number(bill.paid_amount || 0);
            const remPaise = Math.max(0, finalPaise - paidPaise);

            db.prepare(`
              UPDATE bills
              SET commission_rate = ?, commission_amount = ?, final_amount = ?, remaining_amount = ?
              WHERE id = ?
            `).run(commRate, commPaise, finalPaise, remPaise, bill.id);

            // Re-align any credit ledger row for this bill
            db.prepare(`
              UPDATE credit_transactions
              SET amount = ?
              WHERE bill_id = ? AND transaction_type = 'CREDIT_ADDED'
            `).run(remPaise, bill.id);

            bill.commission_rate = commRate;
            bill.commission_amount = commPaise;
            bill.final_amount = finalPaise;
            bill.remaining_amount = remPaise;
          }
        }

        let matches = txs.length === billItems.length;
        if (matches) {
          for (let i = 0; i < billItems.length; i++) {
            const bi = billItems[i];
            const tx = txs[i];
            if (
              tx.customer_id !== bill.customer_id ||
              tx.vegetable_id !== bi.vegetable_id ||
              Math.abs(Number(tx.weight) - Number(bi.quantity)) > 0.001 ||
              Number(tx.rate) !== Number(bi.rate) ||
              Number(tx.base_amount) !== Number(bi.total) ||
              Number(tx.commission_rate) !== commRate
            ) {
              matches = false;
              break;
            }
          }
        }

        // If transactions exist for this bill but do not match (e.g. from an earlier edit), re-sync them
        if (txs.length > 0 && !matches) {
          db.prepare(`DELETE FROM transactions WHERE bill_id = ?`).run(bill.id);

          const paymentType = bill.payment_type || 'Credit';
          const paymentMode = paymentType === 'Credit' ? 'Credit' : 'Cash';
          const finalAmt = Number(bill.final_amount || 0);
          const paidAmt = Number(bill.paid_amount || 0);

          for (const bi of billItems) {
            const qty = Number(bi.quantity || 0);
            const rate = Number(bi.rate || 0);
            const basePaise = Number(bi.total || Math.round(qty * rate * 100));
            const commPaise = Math.round((basePaise * commRate) / 100);
            const itemFinalPaise = basePaise + commPaise;

            let itemPaidPaise = 0;
            let itemRemPaise = itemFinalPaise;
            if (paymentType === 'Paid' || (finalAmt > 0 && paidAmt >= finalAmt)) {
              itemPaidPaise = itemFinalPaise;
              itemRemPaise = 0;
            } else if (paymentType === 'Partial' && finalAmt > 0 && paidAmt > 0) {
              const ratio = Math.min(1, paidAmt / finalAmt);
              itemPaidPaise = Math.round(itemFinalPaise * ratio);
              itemRemPaise = itemFinalPaise - itemPaidPaise;
            }

            db.prepare(`
              INSERT INTO transactions (
                customer_id, vegetable_id, vegetable_name_snapshot, weight, unit,
                rate, base_amount, commission_rate, commission_amount, final_amount,
                payment_type, payment_mode, paid_amount, remaining_amount,
                transaction_date, bill_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
              bill.customer_id,
              bi.vegetable_id,
              bi.vegetable_name || '',
              qty,
              'kg',
              rate,
              basePaise,
              commRate,
              commPaise,
              itemFinalPaise,
              paymentType,
              paymentMode,
              itemPaidPaise,
              itemRemPaise,
              bi.item_date || bill.date,
              bill.id,
              bi.created_at || bill.created_at
            );
          }
        }
      }

      // 3. Reconcile customer credit_balance against the sum of credit_transactions
      const customers = db.prepare(`SELECT id, credit_balance FROM customers WHERE is_deleted = 0`).all();
      for (const cust of customers) {
        const rows = db.prepare(`SELECT transaction_type, amount FROM credit_transactions WHERE customer_id = ?`).all(cust.id);
        let ledgerPaise = 0;
        for (const r of rows) {
          const amt = Number(r.amount || 0);
          if (r.transaction_type === 'CREDIT_ADDED' || r.transaction_type === 'OPENING_BALANCE' || r.transaction_type === 'CREDIT_ADJUSTMENT') {
            ledgerPaise += amt;
          } else if (r.transaction_type === 'PAYMENT_RECEIVED' || r.transaction_type === 'DISCOUNT') {
            ledgerPaise -= amt;
          }
        }
        ledgerPaise = Math.max(0, ledgerPaise);
        if (Number(cust.credit_balance) !== ledgerPaise) {
          db.prepare(`UPDATE customers SET credit_balance = ? WHERE id = ?`).run(ledgerPaise, cust.id);
        }
      }

      logger.info('  ~ bills and transactions synchronized and customer credit balances reconciled');
    },
  },

  {
    version: 13,
    name: 'customers-add-search-keywords',
    up(db) {
      addColumnIfMissing(db, 'customers', 'search_keywords', "TEXT DEFAULT ''");
      logger.info('  ~ added search_keywords column to customers');
    },
  },

  {
    version: 14,
    name: 'reconcile-uncredited-bills-and-corrupted-ledger',
    up(db) {
      // 1. Find bills with remaining_amount > 0 that have NO CREDIT_ADDED rows in credit_transactions
      // (happens when a consolidated bill was edited, deleted, and re-billed under the bookCredit: false assumption).
      const uncreditedBills = db.prepare(`
        SELECT b.id, b.bill_number, b.customer_id, b.remaining_amount, b.created_at, b.date
        FROM bills b
        WHERE b.remaining_amount > 0
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.bill_id = b.id AND ct.transaction_type = 'CREDIT_ADDED'
          )
      `).all();

      for (const bill of uncreditedBills) {
        const remPaise = Number(bill.remaining_amount || 0);
        if (remPaise > 0) {
          const txs = db.prepare(`
            SELECT t.id, t.remaining_amount, t.vegetable_name_snapshot, t.weight, t.unit, t.payment_mode, t.created_at, t.transaction_date
            FROM transactions t
            WHERE t.bill_id = ?
          `).all(bill.id);

          let txCreditTotal = 0;
          for (const t of txs) {
            const hasCt = db.prepare(`
              SELECT 1 FROM credit_transactions WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'
            `).get(t.id);

            const tRem = Number(t.remaining_amount || 0);
            if (!hasCt && tRem > 0) {
              const createdAt = t.created_at || (t.transaction_date ? `${t.transaction_date} 06:00:00` : bill.created_at || `${bill.date} 06:00:00`);
              db.prepare(`
                INSERT INTO credit_transactions
                  (customer_id, transaction_id, bill_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
                VALUES (?, ?, ?, 'CREDIT_ADDED', ?, ?, ?, 0, ?)
              `).run(
                bill.customer_id,
                t.id,
                bill.id,
                tRem,
                t.payment_mode || 'Credit',
                `Udhar added: ${t.vegetable_name_snapshot || ''}${t.weight ? ` (${t.weight}${t.unit || 'kg'})` : ''}`,
                createdAt
              );
              txCreditTotal += tRem;
            } else if (hasCt) {
              db.prepare(`
                UPDATE credit_transactions SET bill_id = ?
                WHERE transaction_id = ? AND bill_id IS NULL
              `).run(bill.id, t.id);
              txCreditTotal += tRem;
            }
          }

          const missingRem = remPaise - txCreditTotal;
          if (missingRem > 0) {
            const createdAt = bill.created_at || (bill.date ? `${bill.date} 06:00:00` : new Date().toISOString().replace('T', ' ').slice(0, 19));
            db.prepare(`
              INSERT INTO credit_transactions
                (customer_id, bill_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
              VALUES (?, ?, 'CREDIT_ADDED', ?, 'Other', ?, 0, ?)
            `).run(
              bill.customer_id,
              bill.id,
              missingRem,
              `Udhar added: Bill #${bill.bill_number}`,
              createdAt
            );
          }
        }
      }

      // 2. Find any unbilled transactions (bill_id IS NULL) with remaining_amount > 0 lacking CREDIT_ADDED
      const uncreditedUnbilledTxs = db.prepare(`
        SELECT t.id, t.customer_id, t.remaining_amount, t.vegetable_name_snapshot, t.weight, t.unit, t.payment_mode, t.created_at, t.transaction_date
        FROM transactions t
        WHERE t.bill_id IS NULL AND t.remaining_amount > 0
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.transaction_id = t.id AND ct.transaction_type = 'CREDIT_ADDED'
          )
      `).all();

      for (const t of uncreditedUnbilledTxs) {
        const tRem = Number(t.remaining_amount || 0);
        if (tRem > 0) {
          const createdAt = t.created_at || (t.transaction_date ? `${t.transaction_date} 06:00:00` : new Date().toISOString().replace('T', ' ').slice(0, 19));
          db.prepare(`
            INSERT INTO credit_transactions
              (customer_id, transaction_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
            VALUES (?, ?, 'CREDIT_ADDED', ?, ?, ?, 0, ?)
          `).run(
            t.customer_id,
            t.id,
            tRem,
            t.payment_mode || 'Credit',
            `Udhar added: ${t.vegetable_name_snapshot || ''}${t.weight ? ` (${t.weight}${t.unit || 'kg'})` : ''}`,
            createdAt
          );
        }
      }

      // 3. Recalculate balance_after_transaction chronologically for all customers and reconcile credit_balance
      const customers = db.prepare(`SELECT id, is_deleted, credit_balance FROM customers`).all();
      for (const cust of customers) {
        const rows = db.prepare(`
          SELECT id, transaction_type, amount FROM credit_transactions
          WHERE customer_id = ?
          ORDER BY CASE WHEN transaction_type = 'OPENING_BALANCE' THEN 0 ELSE 1 END ASC,
                   created_at ASC, id ASC
        `).all(cust.id);

        let runningPaise = 0;
        for (const r of rows) {
          const amt = Number(r.amount || 0);
          if (r.transaction_type === 'CREDIT_ADDED' || r.transaction_type === 'OPENING_BALANCE' || r.transaction_type === 'CREDIT_ADJUSTMENT') {
            runningPaise += amt;
          } else if (r.transaction_type === 'PAYMENT_RECEIVED' || r.transaction_type === 'DISCOUNT') {
            runningPaise -= amt;
          }
          db.prepare(`UPDATE credit_transactions SET balance_after_transaction = ? WHERE id = ?`).run(runningPaise, r.id);
        }

        if (cust.is_deleted === 0) {
          const ledgerPaise = Math.max(0, runningPaise);
          if (Number(cust.credit_balance) !== ledgerPaise) {
            db.prepare(`UPDATE customers SET credit_balance = ? WHERE id = ?`).run(ledgerPaise, cust.id);
          }
        } else {
          // For deleted customers, ensure no phantom balance
          if (rows.length === 0 && cust.credit_balance > 0) {
            db.prepare(`UPDATE customers SET credit_balance = 0 WHERE id = ?`).run(cust.id);
          } else if (rows.length > 0) {
            const ledgerPaise = Math.max(0, runningPaise);
            if (Number(cust.credit_balance) !== ledgerPaise) {
              db.prepare(`UPDATE customers SET credit_balance = ? WHERE id = ?`).run(ledgerPaise, cust.id);
            }
          }
        }
      }

      logger.info('  ~ Migration 14: healed uncredited bills/transactions and reconciled customer balances');
    },
  },
  {
    version: 15,
    name: 'customer_commission_rate_and_reconciliation',
    up(db) {
      // 1. Add commission_rate to customers table if not present
      const custCols = db.prepare("PRAGMA table_info(customers)").all().map((c) => c.name);
      if (!custCols.includes('commission_rate')) {
        db.exec("ALTER TABLE customers ADD COLUMN commission_rate REAL DEFAULT NULL");
      }

      // 2. Set commission_rate = 7 for customer #119 (माऊली नेवसे)
      const mauli = db.prepare("SELECT id FROM customers WHERE id = 119 OR name LIKE '%माऊली नेवसे%'").get();
      if (mauli) {
        db.prepare("UPDATE customers SET commission_rate = 7 WHERE id = ?").run(mauli.id);
      }

      // 3. Reconcile Bill #278 if present (subtotal: 2677500 paise, ₹26,775)
      // At 7%, commission is 187425 paise (₹1,874.25), final_amount is 2864925 paise (₹28,649.25)
      const b278 = db.prepare("SELECT * FROM bills WHERE id = 278").get();
      if (b278) {
        const correctComm = Math.round(b278.subtotal * 0.07);
        const correctFinal = b278.subtotal + correctComm;
        const correctRem = correctFinal - (b278.paid_amount || 0);

        db.prepare(`
          UPDATE bills
          SET commission_rate = 7,
              commission_amount = ?,
              final_amount = ?,
              remaining_amount = ?
          WHERE id = 278
        `).run(correctComm, correctFinal, correctRem);

        // Update credit_transactions row for bill 278 if it exists
        const ctRows = db.prepare("SELECT id FROM credit_transactions WHERE bill_id = 278 AND transaction_type = 'CREDIT_ADDED'").all();
        for (const ct of ctRows) {
          db.prepare("UPDATE credit_transactions SET amount = ? WHERE id = ?").run(correctRem, ct.id);
        }

        // Also normalize transactions tied to bill 278 to 7%
        const txs = db.prepare("SELECT id, base_amount FROM transactions WHERE bill_id = 278").all();
        for (const t of txs) {
          const tComm = Math.round(t.base_amount * 0.07);
          const tFinal = t.base_amount + tComm;
          db.prepare(`
            UPDATE transactions
            SET commission_rate = 7,
                commission_amount = ?,
                final_amount = ?,
                remaining_amount = ?
            WHERE id = ?
          `).run(tComm, tFinal, tFinal, t.id);
        }

        // Reconcile ledger running balances for bill customer
        const custId = b278.customer_id;
        const rows = db.prepare(`
          SELECT id, transaction_type, amount FROM credit_transactions
          WHERE customer_id = ?
          ORDER BY CASE WHEN transaction_type = 'OPENING_BALANCE' THEN 0 ELSE 1 END ASC,
                   created_at ASC, id ASC
        `).all(custId);

        let runningPaise = 0;
        for (const r of rows) {
          const amt = Number(r.amount || 0);
          if (r.transaction_type === 'CREDIT_ADDED' || r.transaction_type === 'OPENING_BALANCE' || r.transaction_type === 'CREDIT_ADJUSTMENT') {
            runningPaise += amt;
          } else if (r.transaction_type === 'PAYMENT_RECEIVED' || r.transaction_type === 'DISCOUNT') {
            runningPaise -= amt;
          }
          db.prepare("UPDATE credit_transactions SET balance_after_transaction = ? WHERE id = ?").run(runningPaise, r.id);
        }
        db.prepare("UPDATE customers SET credit_balance = ? WHERE id = ?").run(Math.max(0, runningPaise), custId);
      }

      logger.info('  ~ Migration 15: customer commission_rate added and Bill #278 reconciled');
    },
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

function createVersionTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT     NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/** Highest recorded version, or 0 if the table is empty. */
function currentVersion(db) {
  return Number(scalar(db, 'SELECT COALESCE(MAX(version), 0) FROM schema_version')) || 0;
}

function stamp(db, version, name) {
  db.prepare(`INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)`).run(version, name);
}

/**
 * Applies every migration newer than the recorded version, in order.
 *
 * Each migration runs inside its own transaction: a failure rolls that migration
 * back and leaves the version unstamped, so the next boot retries it rather than
 * running the remaining migrations against a half-changed schema.
 *
 * @returns {number[]} versions applied during this call
 */
function runMigrations(db) {
  createVersionTable(db);

  if (currentVersion(db) === 0) {
    stamp(db, BASELINE_VERSION, 'baseline');
  }

  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  const applied = [];

  for (const migration of pending) {
    // A rebuild cannot run inside a transaction while foreign keys are enforced,
    // because the DROP + RENAME would be checked against rows mid-copy. The
    // pragma is a no-op inside a transaction, so it is toggled outside the
    // BEGIN/COMMIT that brackets each migration.
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      migration.up(db);
      stamp(db, migration.version, migration.name);
      db.exec('COMMIT');
      applied.push(migration.version);
      logger.info(`Migration ${migration.version} applied: ${migration.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      logger.error(`Migration ${migration.version} (${migration.name}) failed: ${err.message}`);
      throw err;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  return applied;
}

module.exports = {
  BASELINE_VERSION,
  MIGRATIONS,
  runMigrations,
  currentVersion,
  columnInfo,
  hasColumn,
  tableExists,
};
