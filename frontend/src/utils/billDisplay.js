/**
 * Turning a stored bill into the sheet a customer is handed.
 *
 * Two transforms live here, both display-only:
 *
 * 1. **Commission is folded into the item rate.** Commission is charged to the
 *    customer — `final_amount` is `subtotal − discount + commission + hamali +
 *    transport` on every path that writes a bill — but the vendor does not want it
 *    printed as a line, because a visible commission line is an invitation to haggle
 *    over it. So the customer's copy shows an all-in rate, the item column adds up to
 *    the total, and there is nothing on the page to argue about.
 * 2. **A bill covering a period is read datewise.** One sheet, each day's purchases
 *    under its own date with its own subtotal, then the grand total — which is how
 *    the notebook these bills replace worked.
 *
 * Nothing stored changes. `subtotal`, `commission_rate`, `commission_amount` and
 * `final_amount` are still written exactly as before and still drive the internal
 * commission report, so every existing balance is untouched and this whole transform
 * is reversible.
 *
 * The multiplier is derived from the stored *amounts*, never from `commission_rate`.
 * A bill issued at 6% therefore reprints at 6% years later, and a bill written before
 * the rate column existed still reconciles.
 */

// Extension-qualified so this module also loads under plain `node`, which is what
// `__checks__/billDisplay.check.mjs` uses to prove the penny reconciliation. There is
// no frontend test harness, and this arithmetic is not something to eyeball.
import { round2 } from './money.js';

/**
 * What the item column has to add up to once commission is folded in.
 *
 * Every writer produces `final = subtotal − discount + commission + hamali +
 * transport`, so the one figure that absorbs the commission and leaves every other
 * line of the totals box still true is `subtotal + commission`.
 */
export function grossSubtotal(bill) {
  if (!bill) return 0;
  return round2(Number(bill.subtotal || 0) + Number(bill.commission_amount || 0));
}

/**
 * The factor an item's rate and amount are multiplied by to absorb their share of
 * the commission.
 *
 * 1 when there is nothing to spread it across — a bill with no goods on it, or one
 * whose commission was waived — so this never divides by zero and a 0% bill prints
 * its own rates unchanged.
 */
export function commissionMultiplier(bill) {
  const base = Number(bill?.subtotal || 0);
  if (!(base > 0)) return 1;
  return (base + Number(bill?.commission_amount || 0)) / base;
}

/**
 * The bill's items with commission folded into each rate and amount.
 *
 * Per-item rounding cannot be trusted to land on the total: 8% of ₹33.33 rounds up
 * while 8% of ₹66.67 rounds down, so a multi-line bill can finish a paisa away from
 * the figure printed beneath it. Every item but the last is grossed on its own, then
 * the last absorbs the residue, so the column ties out exactly and a customer adding
 * it up with a calculator gets the total.
 *
 * The *rate* is grossed for display and deliberately not reconciled: a rate is a
 * price per kilo, and forcing the residue into it would print a rate that does not
 * multiply out to its own amount.
 */
export function grossItems(items, bill) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const rawSum = round2(list.reduce((acc, it) => acc + Number(it.total || 0), 0));
  const finalAmt = round2(Number(bill?.final_amount || 0));
  const subtotalAmt = round2(Number(bill?.subtotal || 0));

  // If the items in the bill are already grossed (their sum already equals final_amount,
  // and is greater than subtotal), do NOT re-apply commission.
  if (finalAmt > 0 && Math.abs(rawSum - finalAmt) <= 0.05 && (subtotalAmt === 0 || Math.abs(rawSum - subtotalAmt) > 0.05)) {
    return list.map((item) => ({
      ...item,
      rate: Number(item.rate || 0),
      total: round2(Number(item.total || 0)),
    }));
  }

  const multiplier = commissionMultiplier(bill);
  const grossed = list.map((item) => ({
    ...item,
    rate: Number(item.rate || 0),
    total: round2(Number(item.total || 0) * multiplier),
  }));

  // Only reconcile when the raw items already sum to the stored subtotal.
  if (Math.abs(rawSum - subtotalAmt) > 0.01) return grossed;

  const others = round2(
    grossed.slice(0, -1).reduce((acc, it) => acc + it.total, 0)
  );
  const last = round2(grossSubtotal(bill) - others);
  if (!Number.isFinite(last) || last < 0) return grossed;

  return grossed.map((item, idx) =>
    idx === grossed.length - 1 ? { ...item, total: last } : item
  );
}

/** True when this bill covers a span of days rather than a single one. */
export function isPeriodBill(bill) {
  return Boolean(bill?.period_start && bill?.period_end);
}

/**
 * True when a logged entry has already been consolidated into a bill.
 *
 * A transaction's `bill_id` is the single fact behind this: NULL means it is still
 * waiting to be settled, non-NULL means a bill already claimed it and generating
 * another will not pick it up again. That drives what the vendor sees *and* what they
 * are allowed to do — a billed entry cannot be deleted on its own, because the bill's
 * stored totals would stop matching the sales behind them.
 *
 * Defined once, here, because the badge and the history table's Delete button both
 * need the same answer. Two hand-rolled copies would eventually disagree, and the one
 * that read it backwards would tell a vendor a debt was settled when it was not.
 *
 * `''` is rejected alongside null because JSON round-trips and form state have both
 * produced an empty string where a missing id was meant.
 */
export function isBilled(billId) {
  return billId !== null && billId !== undefined && billId !== '';
}

/**
 * Bill items bucketed into the days they were sold on, each with its own subtotal.
 *
 * If item_date is not set on individual items, fallbackDate is used so all bills
 * can be presented in a clean, consistent datewise layout.
 *
 * Insertion order is kept rather than sorted: `billItemModel.getByBillId` already
 * orders by `item_date`, and a second opinion here could only disagree with it.
 */
export function groupItemsByDate(items, fallbackDate = null) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const hasDates = list.some((it) => it.item_date);
  if (!hasDates && !fallbackDate) return null;

  const groups = [];
  const byDate = new Map();

  for (const item of list) {
    const key = item.item_date || fallbackDate || '';
    let group = byDate.get(key);
    if (!group) {
      group = { date: key || null, items: [], subtotal: 0 };
      byDate.set(key, group);
      groups.push(group);
    }

    group.items.push({ ...item });
    group.subtotal = round2(group.subtotal + Number(item.total || 0));
  }

  return groups;
}

/**
 * A YYYY-MM-DD date as the vendor's locale writes it.
 *
 * Returns the raw string for anything unparseable, so a malformed stored date prints
 * as itself rather than as "Invalid Date".
 */
export function formatBillDate(value) {
  if (!value) return '';
  const str = String(value).trim().split('T')[0];
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const [y, m, d] = parts;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    if (parts[2].length === 4) {
      const [d, m, y] = parts;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * The period a bill covers, as one string: a single date, or `start – end`.
 */
export function formatBillPeriod(bill, isMarathi) {
  if (!bill) return '';
  if (!isPeriodBill(bill)) return formatBillDate(bill.date, isMarathi);
  const from = formatBillDate(bill.period_start, isMarathi);
  const to = formatBillDate(bill.period_end, isMarathi);
  return from === to ? from : `${from} – ${to}`;
}
