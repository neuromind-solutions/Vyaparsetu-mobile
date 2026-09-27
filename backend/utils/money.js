/**
 * The money seam.
 *
 * Money is stored on disk as whole paise in INTEGER columns, but every value the
 * application works with in JavaScript — model arguments, return values, the
 * calculation utilities, the HTTP API, the entire frontend — is in rupees.
 * Floating-point rupees cannot represent most decimal fractions exactly, so a
 * running balance updated over many sales drifts by fractions of a paisa. Whole
 * paise in an INTEGER column cannot drift, because there is no fraction to lose.
 *
 * Conversion happens at exactly one place: where a model (or a raw-SQL money
 * write in a service) reads from or writes to a money column.
 *
 *   - Writing rupees → the DB:  toPaise(v)  = Math.round(v * 100)
 *   - Reading paise  ← the DB:  toRupees(v) = v / 100
 *
 * toPaise always rounds, so no un-rounded float can ever reach a money column. A
 * value read from one paise column and written straight into another — the
 * delete-refund path, `credit_balance = credit_balance - SUM(amount)` — stays in
 * paise and is NOT converted: both sides are already integers, and that is
 * exactly where exactness matters most.
 */

/** Rupees → whole paise. null / '' / non-numeric → 0 (money columns all DEFAULT 0). */
function toPaise(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Whole paise → rupees. null / '' / non-numeric → 0. */
function toRupees(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : 0;
}

/**
 * Which columns of each table hold money, and so are stored in paise.
 *
 * Deliberately excluded, because they are not money and ×100 would corrupt them:
 *   - bills.commission_rate, transactions.commission_rate — percentages (8 = 8%)
 *   - bills.discount_value — dual-unit: rupees for a fixed discount, a percentage
 *     for a percentage discount. Only the derived discount_amount is money.
 *   - bill_items.quantity, transactions.weight — kilograms
 */
const MONEY_FIELDS = {
  customers: ['credit_balance', 'opening_balance'],
  vegetables: ['rate'],
  bills: [
    'subtotal',
    'discount_amount',
    'commission_amount',
    'hamali_amount',
    'transport_amount',
    'final_amount',
    'paid_amount',
    'remaining_amount',
    'customer_credit_balance',
  ],
  bill_items: ['rate', 'total'],
  transactions: [
    'rate',
    'base_amount',
    'commission_amount',
    'final_amount',
    'paid_amount',
    'remaining_amount',
  ],
  credit_transactions: ['amount', 'balance_after_transaction'],
};

/**
 * Returns a copy of a DB row with that table's money columns converted paise →
 * rupees. Columns the row does not carry are skipped, so it is safe on the
 * partial rows some SELECTs return; non-money columns are copied untouched.
 */
function rowToRupees(row, table) {
  if (!row) return row;
  const fields = MONEY_FIELDS[table] || [];
  const out = { ...row };
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null) out[f] = toRupees(out[f]);
  }
  return out;
}

/**
 * Returns a copy of a payload with that table's money columns converted rupees →
 * paise, ready to bind into an INSERT/UPDATE. Missing fields are skipped.
 */
function rowToPaise(obj, table) {
  if (!obj) return obj;
  const fields = MONEY_FIELDS[table] || [];
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null) out[f] = toPaise(out[f]);
  }
  return out;
}

module.exports = { toPaise, toRupees, MONEY_FIELDS, rowToRupees, rowToPaise };
