/**
 * The credit ledger's signs.
 *
 * `customers.credit_balance` is a running total of what a customer owes;
 * `credit_transactions` is the history that explains it. Replaying the history has
 * to land on the balance *exactly* — when it does not, the vendor is holding two
 * different answers to "how much does this customer owe me" and there is no way to
 * tell which one to say out loud.
 *
 * Replaying means applying a sign per row type: a credit adds to what is owed, a
 * payment subtracts, an adjustment and an opening balance apply their own stored
 * sign. That rule used to be written out by hand in three independent places — the
 * reconciliation query in creditModel, the summary in customerModel.getLedger, and
 * ledgerSum in the test harness — each ending in a silent `ELSE 0`. A new row type
 * therefore did not fail loudly; it was dropped from every total while continuing to
 * move credit_balance, so the passbook quietly stopped adding up to the balance
 * printed beside it.
 *
 * So the signs live here once, and both the SQL and the JavaScript are built from
 * this one map. Adding a row type means adding a line here — there is nowhere else
 * for the definition to drift to.
 *
 * Amounts are whole paise (see utils/money.js). Nothing in this file converts:
 * signs are unit-agnostic and apply the same to paise and rupees.
 */

/**
 * How each ledger row type moves the balance.
 *
 * +1  the row's amount is added to what the customer owes
 * -1  the row's amount is subtracted from what the customer owes
 *
 * CREDIT_ADDED and PAYMENT_RECEIVED always store a positive amount and take their
 * direction from the sign here. CREDIT_ADJUSTMENT and OPENING_BALANCE store a
 * *signed* amount, so they carry +1 and let the stored sign do the work — a
 * negative adjustment is a write-off and subtracts.
 */
const LEDGER_SIGNS = {
  CREDIT_ADDED: 1,
  PAYMENT_RECEIVED: -1,
  DISCOUNT: -1,
  CREDIT_ADJUSTMENT: 1,
  OPENING_BALANCE: 1,
};

/** Every recognised ledger row type. */
const LEDGER_TYPES = Object.keys(LEDGER_SIGNS);

/**
 * The sign for a row type, or 0 for one this module does not know.
 *
 * 0 is the honest answer for an unrecognised type — it is what the SQL does too —
 * but it is also why the map above is the only place a type may be introduced.
 */
function signOf(transactionType) {
  return LEDGER_SIGNS[transactionType] ?? 0;
}

/** Applies the type's sign to an amount. Non-numeric amounts count as 0. */
function signedAmount(transactionType, amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? signOf(transactionType) * n : 0;
}

/**
 * Replays rows to the balance they explain, in whatever unit they carry.
 *
 * @param {Array<{transaction_type: string, amount: number}>} rows
 * @returns {number} the sum of every row's signed amount
 */
function replay(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, row) => acc + signedAmount(row.transaction_type, row.amount), 0);
}

/**
 * Splits rows into what was added and what came back, by sign.
 *
 * The vendor reads "credit given" and "recovered" side by side with the outstanding
 * figure, and a customer will do the subtraction — so the split is derived from the
 * same signs as the balance itself, which makes
 * `totalCredit - totalRecovered === replay(rows)` true by construction rather than
 * by two lists happening to agree.
 *
 * A signed row lands on whichever side its sign puts it: a positive adjustment is
 * debt added, a negative one is debt forgiven and reads as recovery.
 *
 * @returns {{ totalCredit: number, totalRecovered: number }} both non-negative
 */
function splitSigned(rows) {
  let totalCredit = 0;
  let totalRecovered = 0;
  for (const row of rows || []) {
    const signed = signedAmount(row.transaction_type, row.amount);
    if (signed > 0) totalCredit += signed;
    else if (signed < 0) totalRecovered += -signed;
  }
  return { totalCredit, totalRecovered };
}

/** Rejects anything that is not a bare SQL identifier, since the alias is interpolated. */
function assertSafeAlias(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Unsafe SQL alias for the credit ledger: ${alias}`);
  }
}

/**
 * The signed-amount CASE expression, built from LEDGER_SIGNS.
 *
 * Generated rather than written out so the SQL replay and the JavaScript replay
 * cannot disagree about a row type.
 *
 * @param {string} alias Table alias qualifying the columns, e.g. 'ct'.
 * @returns {string} a CASE expression yielding the row's signed amount
 */
function signedAmountSql(alias = 'ct') {
  assertSafeAlias(alias);
  const whens = LEDGER_TYPES.map((type) => {
    const negate = LEDGER_SIGNS[type] < 0 ? '-' : '';
    return `WHEN ${alias}.transaction_type = '${type}' THEN ${negate}${alias}.amount`;
  }).join('\n            ');

  return `CASE
            ${whens}
            ELSE 0
          END`;
}

/**
 * `SUM` of the signed amounts, coalesced for customers with no ledger rows at all.
 *
 * @param {string} alias Table alias qualifying the columns, e.g. 'ct'.
 */
function signedSumSql(alias = 'ct') {
  return `COALESCE(SUM(${signedAmountSql(alias)}), 0)`;
}

module.exports = {
  LEDGER_SIGNS,
  LEDGER_TYPES,
  signOf,
  signedAmount,
  replay,
  splitSigned,
  signedAmountSql,
  signedSumSql,
};
