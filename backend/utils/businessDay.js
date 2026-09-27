/**
 * The shop's day.
 *
 * Two different clocks meet in this database and they do not agree.
 *
 * Every `created_at` is written by SQLite's `CURRENT_TIMESTAMP`, which is **UTC**. Every
 * date the vendor sees or picks — `bills.date`, the date input on a report, "today" on the
 * dashboard — is a **local** calendar date, because a vendor means the day they were
 * standing in the shop. Comparing one to the other directly is wrong by the size of the
 * UTC offset, and in IST (+05:30) that is wrong for the first five and a half hours of
 * every day.
 *
 * An APMC vegetable market opens around 4am. A payment collected at 04:00 IST on the 27th
 * is stored as `2026-08-26 22:30`, so `date(created_at)` reports the 26th: the money lands
 * on a day the vendor already closed, and is missing from the day they are looking at. The
 * amount is never lost, but it is filed under the wrong date, which is worse than missing —
 * the vendor reconciles cash against a figure that silently excludes the morning's trade.
 *
 * Five queries had this bug, in three files, all written the same way. So the conversion
 * lives here once. Any query that compares `created_at` against a vendor-facing date must
 * go through `localDateSql`; any code that needs today's date as the vendor means it must
 * use `todayLocal()`.
 *
 * Columns that already hold a plain local date string — `bills.date`, `transactions.date`,
 * `bills.period_start` / `period_end`, `bill_items.item_date` — must NOT be passed through
 * `localDateSql`. They were never UTC, and converting them would shift them by an offset
 * they never had.
 */

/**
 * SQL that reads a UTC timestamp column as the local calendar date it belongs to.
 *
 * `date(col, 'localtime')` tells SQLite to interpret the stored value as UTC and shift it
 * into the host's timezone before taking the date part. Comparing the result against a
 * local date is then apples to apples.
 *
 * @param {string} column a timestamp column written by CURRENT_TIMESTAMP, optionally
 *                        table-qualified (e.g. 'created_at' or 'ct.created_at')
 * @returns {string} a SQL expression yielding 'YYYY-MM-DD' in local time
 */
function localDateSql(column) {
  return `date(${column}, 'localtime')`;
}

/**
 * SQL for today's local calendar date — the vendor's today, not UTC's.
 *
 * A constant rather than a function because there is only one correct spelling of it and
 * a second spelling is how the drift started.
 */
const TODAY_LOCAL_SQL = `date('now', 'localtime')`;

/**
 * Today's date as the vendor means it: 'YYYY-MM-DD' in the host's timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is UTC and therefore returns
 * yesterday's date all morning in IST. Built from the local getters instead.
 *
 * @returns {string} 'YYYY-MM-DD'
 */
function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = { localDateSql, TODAY_LOCAL_SQL, todayLocal };
