/**
 * Money calculations shared by the entry screens.
 *
 * These mirror `backend/utils/calculation.js`. The figures shown while a vendor
 * types are a preview of what the server will store, so both sides must round the
 * same way and read the commission rate in the same unit — a preview that
 * disagrees with the saved bill is worse than no preview, because the vendor has
 * already read the number out to the customer.
 *
 * The server is authoritative: it recalculates from the shop's configured rate and
 * ignores any amounts sent from here.
 */

export const DEFAULT_COMMISSION_PERCENT = 8;

/** Rounds to paise. */
export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Reads a commission rate as a percentage: 8 means 8%.
 *
 * `Number(x) || 8` would turn a deliberate 0% into 8%, so a vendor who waives
 * commission would still see it charged.
 */
export function normalizeCommissionPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COMMISSION_PERCENT;
  return n;
}

/**
 * Base, commission and final amount for one sale.
 *
 * @param {number} weight
 * @param {number} rate
 * @param {number|string} commissionPercent A percentage — 8 means 8%.
 */
export function calculateTransactionTotals(weight, rate, commissionPercent) {
  const w = Number(weight) || 0;
  const r = Number(rate) || 0;
  const percent = normalizeCommissionPercent(commissionPercent);

  const baseAmount = round2(w * r);
  const commissionAmount = round2((baseAmount * percent) / 100);
  const finalAmount = round2(baseAmount + commissionAmount);

  return { baseAmount, commissionPercent: percent, commissionAmount, finalAmount };
}

/** Formats a rate for display: 8 → "8%", 7.5 → "7.5%". */
export function formatCommissionPercent(value) {
  const percent = normalizeCommissionPercent(value);
  return `${Number(percent.toFixed(2))}%`;
}

/**
 * Reads a rate off a saved record, returning null when the record does not carry
 * one — a bill written before the column existed, for instance.
 *
 * Distinct from `normalizeCommissionPercent`, which is for *entry* screens and
 * substitutes the shop default so a sale can still be priced. On a saved record
 * there is nothing to substitute: `Number(null)` is 0, and rendering that as "0%"
 * would tell the vendor they had waived a commission they in fact charged. A
 * missing rate has to read as unknown, not as zero and not as the default.
 */
export function parseStoredPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
