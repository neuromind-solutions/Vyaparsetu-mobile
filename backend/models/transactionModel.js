/**
 * Transaction Model
 * Database operations for customer vegetable transactions.
 */

const { execSelect, execRun } = require('../database/db');
const { DEFAULT_COMMISSION_PERCENT } = require('../utils/calculation');
const { toPaise, toRupees, rowToRupees } = require('../utils/money');

/**
 * Creates a new transaction record.
 *
 * @param {object} data
 * @param {number} [data.commission_rate=8] Commission as a percentage.
 */
function create({
  customer_id,
  vegetable_id,
  vegetable_name_snapshot,
  weight,
  unit = 'kg',
  rate,
  base_amount,
  commission_rate = DEFAULT_COMMISSION_PERCENT,
  commission_amount,
  final_amount,
  payment_type = 'Credit',
  payment_mode = 'Credit',
  paid_amount = 0,
  remaining_amount = 0,
  transaction_date
}) {
  const info = execRun(
    `INSERT INTO transactions (
      customer_id, vegetable_id, vegetable_name_snapshot, weight, unit, rate,
      base_amount, commission_rate, commission_amount, final_amount,
      payment_type, payment_mode, paid_amount, remaining_amount, transaction_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customer_id,
      vegetable_id,
      vegetable_name_snapshot,
      weight,
      unit,
      toPaise(rate),
      toPaise(base_amount),
      commission_rate,
      toPaise(commission_amount),
      toPaise(final_amount),
      payment_type,
      payment_mode,
      toPaise(paid_amount),
      toPaise(remaining_amount),
      transaction_date
    ]
  );

  // lastInsertRowid is per-connection and reflects this INSERT specifically. The
  // previous SELECT MAX(id) WHERE customer_id = ? returned the wrong row as soon
  // as anything else inserted for the same customer in between.
  const newId = Number(info.lastInsertRowid);

  return findById(newId);
}


/**
 * Find transaction by ID.
 */
function findById(id) {
  const rows = execSelect(
    `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.id = ?`,
    [id]
  );
  return rowToRupees(rows[0] || null, 'transactions');
}

/**
 * Find transactions for a customer on a specific date (YYYY-MM-DD).
 *
 * The `bills` join is LEFT for the same reason it is in `findAll`: an entry still waiting
 * to be settled has a NULL `bill_id` and is the row the vendor is actually looking for.
 * It carries `bill_number` so the history table can name the bill an entry went into
 * rather than only saying that one exists.
 */
function findByCustomerAndDate(customerId, date) {
  return execSelect(
    `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile,
            b.bill_number AS bill_number
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     LEFT JOIN bills b ON t.bill_id = b.id
     WHERE t.customer_id = ? AND t.transaction_date = ?
     ORDER BY t.created_at DESC, t.id DESC`,
    [customerId, date]
  ).map((t) => rowToRupees(t, 'transactions'));
}

/**
 * Find transactions for a customer within a date range (YYYY-MM-DD to YYYY-MM-DD).
 *
 * Same LEFT join as its single-date twin, and for the same reason — a range is where
 * billed and unbilled entries are most likely to sit side by side, because the vendor
 * may already have billed some days inside it.
 */
function findByCustomerAndDateRange(customerId, startDate, endDate) {
  return execSelect(
    `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile,
            b.bill_number AS bill_number
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     LEFT JOIN bills b ON t.bill_id = b.id
     WHERE t.customer_id = ?
       AND t.transaction_date >= ?
       AND t.transaction_date <= ?
     ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC`,
    [customerId, startDate, endDate]
  ).map((t) => rowToRupees(t, 'transactions'));
}

/**
 * Find all transactions for a customer (or all customers) with optional date filtering.
 *
 * This is what the Day Book reads with just a `date`: one day's entries across every
 * customer, which is why the customer join is here rather than in the caller.
 *
 * `bills` is a LEFT join on purpose — an unbilled entry has a NULL `bill_id` and must
 * still appear. An INNER join would silently hide exactly the rows the vendor most needs
 * to see. `bill_number` is TEXT, so rowToRupees leaves it alone.
 */
function findAll({ customerId, date, startDate, endDate }) {
  let sql = `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile,
                    b.bill_number AS bill_number
             FROM transactions t
             JOIN customers c ON t.customer_id = c.id
             LEFT JOIN bills b ON t.bill_id = b.id
             WHERE 1=1`;
  const params = [];

  if (customerId) {
    sql += ` AND t.customer_id = ?`;
    params.push(customerId);
  }

  if (date) {
    sql += ` AND t.transaction_date = ?`;
    params.push(date);
  } else {
    if (startDate) {
      sql += ` AND t.transaction_date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND t.transaction_date <= ?`;
      params.push(endDate);
    }
  }

  sql += ` ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC`;

  return execSelect(sql, params).map((t) => rowToRupees(t, 'transactions'));
}

/**
 * Calculates aggregated daily purchase totals for a customer on a given date.
 */
function getDailyCustomerSummary(customerId, date) {
  const rows = execSelect(
    `SELECT
       COUNT(t.id) AS total_transactions,
       SUM(t.weight) AS total_weight,
       SUM(t.base_amount) AS total_base_amount,
       SUM(t.commission_amount) AS total_commission,
       SUM(t.final_amount) AS total_final_amount,
       SUM(t.paid_amount) AS total_paid_amount,
       SUM(t.remaining_amount) AS total_remaining_amount
     FROM transactions t
     WHERE t.customer_id = ? AND t.transaction_date = ?`,
    [customerId, date]
  );

  const row = rows[0] || {};
  return {
    total_transactions: Number(row.total_transactions || 0),
    total_weight: Number((Number(row.total_weight || 0)).toFixed(2)),
    total_base_amount: Number(toRupees(row.total_base_amount).toFixed(2)),
    total_commission: Number(toRupees(row.total_commission).toFixed(2)),
    total_final_amount: Number(toRupees(row.total_final_amount).toFixed(2)),
    total_paid_amount: Number(toRupees(row.total_paid_amount).toFixed(2)),
    total_remaining_amount: Number(toRupees(row.total_remaining_amount).toFixed(2))
  };
}


/**
 * Finds a customer's transactions on a date that have not yet been billed.
 *
 * Bill generation reads this rather than every transaction on the date, so a
 * second run finds nothing and cannot bill the same sales twice.
 */
function findUnbilledByCustomerAndDate(customerId, date) {
  return execSelect(
    `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.customer_id = ? AND t.transaction_date = ? AND t.bill_id IS NULL
     ORDER BY t.created_at DESC, t.id DESC`,
    [customerId, date]
  ).map((t) => rowToRupees(t, 'transactions'));
}

/**
 * Finds a customer's unbilled transactions across a date range, oldest first.
 *
 * The range twin of findUnbilledByCustomerAndDate, and it carries the same
 * `bill_id IS NULL` filter for the same reason: days already consolidated into a
 * daily bill are already paid for in the ledger, so a range spanning them must skip
 * them rather than bill them a second time.
 *
 * Ordered ascending, unlike the single-date query, because the range bill prints its
 * lines grouped by day and a customer reads a week chronologically.
 */
function findUnbilledByCustomerAndDateRange(customerId, startDate, endDate) {
  return execSelect(
    `SELECT t.*, c.name AS customer_name, c.mobile AS customer_mobile
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.customer_id = ?
       AND t.transaction_date >= ?
       AND t.transaction_date <= ?
       AND t.bill_id IS NULL
     ORDER BY t.transaction_date ASC, t.created_at ASC, t.id ASC`,
    [customerId, startDate, endDate]
  ).map((t) => rowToRupees(t, 'transactions'));
}

/**
 * Every customer who has entries not yet consolidated into a bill.
 *
 * This is the query that stops the Transactions page being a guessing game. The range
 * filter used to default to today→today, so a vendor whose customer last bought a
 * fortnight ago saw an empty table and a disabled Generate Bill button — with nothing
 * anywhere on screen saying unbilled entries existed at all. The only way through was
 * to guess that the start date needed dragging backwards.
 *
 * One row per customer, oldest pending day first, so the settlement that has been
 * waiting longest sits at the top.
 *
 * `oldest_date` / `newest_date` bound exactly the span a bill should cover, so a caller
 * can hand them straight to generateBillFromTransactions and the vendor never picks a
 * date by hand.
 */
function findPendingSettlements() {
  return execSelect(
    `SELECT t.customer_id,
            c.name                  AS customer_name,
            c.mobile                AS customer_mobile,
            COUNT(*)                AS entry_count,
            MIN(t.transaction_date) AS oldest_date,
            MAX(t.transaction_date) AS newest_date,
            SUM(t.final_amount)     AS total_amount
     FROM transactions t
     JOIN customers c ON t.customer_id = c.id
     WHERE t.bill_id IS NULL
     GROUP BY t.customer_id
     ORDER BY MIN(t.transaction_date) ASC, c.name ASC`
  ).map((r) => ({
    ...r,
    // SUM over an INTEGER paise column comes back in paise. rowToRupees converts by
    // looking the column name up in MONEY_FIELDS, and `total_amount` is an alias that
    // appears in no table, so it has to be converted here or it reaches the vendor
    // reading a hundred times too large.
    total_amount: toRupees(r.total_amount),
  }));
}

/**
 * Marks transactions as consolidated into a bill.
 *
 * Only claims rows that are still unbilled, and returns how many it claimed. A
 * caller that asked for N and got fewer raced with another bill and must not
 * proceed.
 *
 * @returns {number} rows claimed
 */
function markAsBilled(ids, billId) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  execRun(
    `UPDATE transactions SET bill_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders}) AND bill_id IS NULL`,
    [billId, ...ids]
  );

  const claimed = execSelect(
    `SELECT COUNT(*) AS n FROM transactions WHERE id IN (${placeholders}) AND bill_id = ?`,
    [...ids, billId]
  );
  return Number(claimed[0]?.n || 0);
}

/** Releases transactions back to unbilled, used when a bill is deleted. */
function clearBillLink(billId) {
  execRun(
    `UPDATE transactions SET bill_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE bill_id = ?`,
    [billId]
  );
  return true;
}

/**
 * Deletes a transaction by ID.
 *
 * Callers must reverse the credit this transaction booked first — see
 * transactionService.deleteTransaction, which does both inside one transaction.
 */
function deleteById(id) {
  execRun(`DELETE FROM transactions WHERE id = ?`, [id]);
  return true;
}

/**
 * Updates an existing transaction record.
 */
function updateById(id, {
  customer_id,
  vegetable_id,
  vegetable_name_snapshot,
  weight,
  unit = 'kg',
  rate,
  base_amount,
  commission_rate = DEFAULT_COMMISSION_PERCENT,
  commission_amount,
  final_amount,
  payment_type = 'Credit',
  payment_mode = 'Credit',
  paid_amount = 0,
  remaining_amount = 0,
  transaction_date
}) {
  execRun(
    `UPDATE transactions SET
      customer_id = ?,
      vegetable_id = ?,
      vegetable_name_snapshot = ?,
      weight = ?,
      unit = ?,
      rate = ?,
      base_amount = ?,
      commission_rate = ?,
      commission_amount = ?,
      final_amount = ?,
      payment_type = ?,
      payment_mode = ?,
      paid_amount = ?,
      remaining_amount = ?,
      transaction_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [
      customer_id,
      vegetable_id,
      vegetable_name_snapshot,
      weight,
      unit,
      toPaise(rate),
      toPaise(base_amount),
      commission_rate,
      toPaise(commission_amount),
      toPaise(final_amount),
      payment_type,
      payment_mode,
      toPaise(paid_amount),
      toPaise(remaining_amount),
      transaction_date,
      id
    ]
  );
  return findById(id);
}

module.exports = {
  create,
  findById,
  findByCustomerAndDate,
  findUnbilledByCustomerAndDate,
  findByCustomerAndDateRange,
  findUnbilledByCustomerAndDateRange,
  findPendingSettlements,
  findAll,
  getDailyCustomerSummary,
  markAsBilled,
  clearBillLink,
  deleteById,
  updateById
};
