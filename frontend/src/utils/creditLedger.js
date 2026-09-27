/**
 * The credit ledger's signs, for the screens that display it.
 *
 * This mirrors `backend/utils/creditLedger.js`, which is the definition. It is copied
 * rather than imported because the backend is CommonJS in a separate process and Vite
 * bundles only this tree — there is no import path between them.
 *
 * A copy is only safe if it cannot drift, so
 * `backend/tests/invariants/creditLedgerParity.test.js` reads this file and fails when
 * the two sign maps disagree. Adding a ledger row type therefore means adding it in
 * both places, and forgetting is a red test rather than a screen that quietly stops
 * adding up.
 *
 * Why the frontend needs the signs at all: the Udhar page shows "credit given" and
 * "recovered" next to the outstanding figure, and a customer standing at the counter
 * will do the subtraction. Those two totals used to be built by filtering for two
 * hardcoded row types, so every other type was silently dropped from both while still
 * moving the balance — a customer whose whole debt came from a notebook opening balance
 * would have read ₹0 given and ₹0 recovered beside an outstanding of ₹5,000.
 *
 * Amounts here are rupees (the whole frontend is), but signs are unit-agnostic.
 */

/**
 * How each ledger row type moves what the customer owes.
 *
 * CREDIT_ADDED and PAYMENT_RECEIVED always store a positive amount and take their
 * direction from the sign here. CREDIT_ADJUSTMENT and OPENING_BALANCE store a *signed*
 * amount, so they carry +1 and let the stored sign do the work — a negative adjustment
 * is a write-off and subtracts.
 */
export const LEDGER_SIGNS = {
  CREDIT_ADDED: 1,
  PAYMENT_RECEIVED: -1,
  DISCOUNT: -1,
  CREDIT_ADJUSTMENT: 1,
  OPENING_BALANCE: 1,
};

/** The sign for a row type, or 0 for one this module does not know. */
export function signOf(transactionType) {
  return LEDGER_SIGNS[transactionType] ?? 0;
}

/** The amount with its type's sign applied. Non-numeric amounts count as 0. */
export function signedAmount(transactionType, amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? signOf(transactionType) * n : 0;
}

/**
 * Splits rows into what was added and what came back, by sign.
 *
 * Derived from the same signs that move the balance, so
 * `totalCredit − totalRecovered` equals the replayed balance by construction rather
 * than by two filter lists happening to agree.
 *
 * @returns {{ totalCredit: number, totalRecovered: number }} both non-negative
 */
export function splitSigned(rows) {
  let totalCredit = 0;
  let totalRecovered = 0;
  for (const row of rows || []) {
    const signed = signedAmount(row.transaction_type, row.amount);
    if (signed > 0) totalCredit += signed;
    else if (signed < 0) totalRecovered += -signed;
  }
  return { totalCredit, totalRecovered };
}

/**
 * A ledger row's amount as it should be read: the sign the row actually has, and the
 * magnitude beside it.
 *
 * Every display of a ledger amount went through `isPayment ? '−' : '+'`, which reads a
 * negative adjustment as `+₹-500.00`. Deriving both parts from the signed amount keeps
 * the sign and the number in agreement for all four row types.
 *
 * @returns {{ sign: '+' | '−', magnitude: number }}
 */
export function displayAmount(transactionType, amount) {
  const signed = signedAmount(transactionType, amount);
  return { sign: signed < 0 ? '−' : '+', magnitude: Math.abs(signed) };
}
