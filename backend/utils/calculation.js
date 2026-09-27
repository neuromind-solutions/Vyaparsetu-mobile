/**
 * Calculation Utility for Transactions
 * Provides precise monetary calculations with 2-decimal rounding.
 */

const DEFAULT_COMMISSION_PERCENT = 8;

function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Reads a commission rate as a percentage.
 *
 * `Number(x) || 8` cannot be used here: a legitimate 0% commission is falsy and
 * would silently become 8%, so a vendor who waives commission would still see it
 * charged. Only a genuinely unusable value falls back.
 *
 * @param {*} value
 * @returns {number} a percentage — 8 means 8%
 */
function normalizeCommissionPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COMMISSION_PERCENT;
  return n;
}

/**
 * Calculates transaction financial totals.
 *
 * @param {number} weight
 * @param {number} rate
 * @param {number} [commissionPercent=8] Commission as a *percentage*: 8 means 8%.
 *   This is the same unit as `bills.commission_rate` and the value shown in
 *   Settings. It was previously read as a fraction (0.08), so passing the 8 that
 *   Settings stores charged 800% commission.
 * @returns {{baseAmount: number, commissionRate: number, commissionAmount: number, finalAmount: number}}
 */
function calculateTransactionTotals(weight, rate, commissionPercent = DEFAULT_COMMISSION_PERCENT) {
  const w = Number(weight) || 0;
  const r = Number(rate) || 0;
  const percent = normalizeCommissionPercent(commissionPercent);

  const baseAmount = round2(w * r);
  const commissionAmount = round2((baseAmount * percent) / 100);
  const finalAmount = round2(baseAmount + commissionAmount);

  return {
    baseAmount,
    commissionRate: percent,
    commissionAmount,
    finalAmount,
  };
}

module.exports = {
  round2,
  calculateTransactionTotals,
  normalizeCommissionPercent,
  DEFAULT_COMMISSION_PERCENT,
};
