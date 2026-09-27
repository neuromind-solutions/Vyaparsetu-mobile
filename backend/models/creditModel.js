// backend/models/creditModel.js
const { execSelect, execRun, transaction } = require('../database/db');
const { toPaise, toRupees, rowToRupees } = require('../utils/money');
const { signedSumSql, signedAmount } = require('../utils/creditLedger');
const { localDateSql, TODAY_LOCAL_SQL } = require('../utils/businessDay');

/** Get credit metrics summary */
function getSummary() {
  // Total outstanding balance across all active customers
  const outstandingRes = execSelect(`SELECT SUM(credit_balance) AS total_outstanding FROM customers WHERE is_deleted = 0`);
  const totalOutstanding = outstandingRes[0]?.total_outstanding || 0.0;

  // Today's credit added.
  //
  // Deliberately CREDIT_ADDED only, not every row that increases what is owed. This is
  // an activity figure — how much udhar the shop extended today — so a notebook opening
  // balance entered today does not belong in it, and neither does a correction. Counting
  // them would tell a vendor migrating 200 customers that they gave out ₹2,00,000 of
  // credit on a day they gave out none. The figure that has to account for every row is
  // the per-customer reconciliation in customerModel.getLedger, which uses splitSigned.
  const addedRes = execSelect(
    `SELECT SUM(amount) AS today_added
     FROM credit_transactions
     WHERE transaction_type = 'CREDIT_ADDED'
       AND ${localDateSql('created_at')} = ${TODAY_LOCAL_SQL}`
  );
  const todayAdded = addedRes[0]?.today_added || 0.0;

  // Today's recovery — money actually collected, so PAYMENT_RECEIVED only. A written-off
  // adjustment reduces the balance but nothing came in, and this sits beside the day's
  // cash and UPI figures.
  const recoveredRes = execSelect(
    `SELECT SUM(amount) AS today_recovered
     FROM credit_transactions
     WHERE transaction_type = 'PAYMENT_RECEIVED'
       AND ${localDateSql('created_at')} = ${TODAY_LOCAL_SQL}`
  );
  const todayRecovered = recoveredRes[0]?.today_recovered || 0.0;

  return {
    total_outstanding: Number(toRupees(totalOutstanding).toFixed(2)),
    today_added: Number(toRupees(todayAdded).toFixed(2)),
    today_recovered: Number(toRupees(todayRecovered).toFixed(2))
  };
}

/** Get customers with active credit balance */
function getCustomersWithBalance() {
  return execSelect(
    `SELECT c.id, c.name, c.mobile, c.address, c.search_keywords, c.credit_balance, c.updated_at,
            (
              SELECT COALESCE(SUM(ct.amount), 0)
              FROM credit_transactions ct
              WHERE ct.customer_id = c.id
                AND ct.transaction_type = 'PAYMENT_RECEIVED'
                AND ${localDateSql('ct.created_at')} = ${TODAY_LOCAL_SQL}
            ) AS today_recovery,
            COALESCE(
              (SELECT ${localDateSql('ct.created_at')} FROM credit_transactions ct WHERE ct.customer_id = c.id ORDER BY ct.created_at DESC, ct.id DESC LIMIT 1),
              ${localDateSql('c.created_at')}
            ) AS last_transaction_date
     FROM customers c
     WHERE c.credit_balance > 0 AND c.is_deleted = 0
     ORDER BY last_transaction_date DESC, c.credit_balance DESC, c.name ASC`
  ).map((c) => ({
    ...rowToRupees(c, 'customers'),
    today_recovery: toRupees(c.today_recovery || 0),
    last_transaction_date: c.last_transaction_date
  }));
}

/** Get transaction logs for a single customer, newest first, opening balance pinned last. */
function getCustomerTransactions(customerId) {
  return execSelect(
    `SELECT ct.*, b.bill_number
     FROM credit_transactions ct
     LEFT JOIN bills b ON ct.bill_id = b.id
     WHERE ct.customer_id = ?
     ORDER BY CASE WHEN ct.transaction_type = 'OPENING_BALANCE' THEN 1 ELSE 0 END ASC,
              ct.created_at DESC, ct.id DESC`,
    [customerId]
  ).map((t) => rowToRupees(t, 'credit_transactions'));
}

/**
 * Customers whose stored balance no longer matches their passbook.
 *
 * `customers.credit_balance` is a running total; `credit_transactions` is the
 * history that explains it. They are written together and must agree — a credit
 * adds to what is owed, a payment subtracts, an adjustment and an opening balance
 * apply their own sign. When they disagree, the vendor is holding two different
 * answers to "how much does this customer owe me", and there is no way to tell
 * which one to say out loud. Every money test ends on this invariant; this is the
 * same check run against live data so drift surfaces on the dashboard instead of at
 * settlement.
 *
 * The signs come from utils/creditLedger, not from a CASE written out here, so this
 * query and the JavaScript replay can never disagree about a row type.
 *
 * @param {number} tolerance Paise of slack, default 0. Money is stored as whole
 *   paise now, so a healthy balance equals its ledger *exactly* — any non-zero
 *   difference is real drift, not the float noise the old REAL columns produced.
 * @returns {Array<{id, name, mobile, stored_balance, ledger_balance, difference}>}
 */
function findBalanceMismatches(tolerance = 0) {
  const signedSum = signedSumSql('ct');

  const rows = execSelect(
    `SELECT c.id, c.name, c.mobile,
            c.credit_balance AS stored_balance,
            ${signedSum} AS ledger_balance
     FROM customers c
     LEFT JOIN credit_transactions ct ON ct.customer_id = c.id
     WHERE c.is_deleted = 0
     GROUP BY c.id, c.name, c.mobile, c.credit_balance
     HAVING ABS(c.credit_balance - ${signedSum}) > ?
     ORDER BY ABS(c.credit_balance - ${signedSum}) DESC`,
    [tolerance]
  );

  return rows.map((row) => ({
    ...row,
    stored_balance: Number(toRupees(row.stored_balance).toFixed(2)),
    ledger_balance: Number(toRupees(row.ledger_balance).toFixed(2)),
    difference: Number(
      (toRupees(row.stored_balance) - toRupees(row.ledger_balance)).toFixed(2)
    ),
  }));
}

/**
 * Automatically applies a payment (in paise) across a customer's unpaid / partial
 * bills and transactions in chronological FIFO order (oldest first).
 */
function settleDebtsFifo(customerId, amountPaise) {
  if (!amountPaise || amountPaise <= 0) return;

  // 1. Settle Bills in FIFO order
  const unpaidBills = execSelect(
    `SELECT id, paid_amount, remaining_amount, final_amount
     FROM bills
     WHERE customer_id = ? AND remaining_amount > 0
     ORDER BY date ASC, id ASC`,
    [customerId]
  );

  let billPayLeft = amountPaise;
  for (const bill of unpaidBills) {
    if (billPayLeft <= 0) break;
    const billRem = Number(bill.remaining_amount || 0);
    const payForBill = Math.min(billPayLeft, billRem);
    const newPaid = Number(bill.paid_amount || 0) + payForBill;
    const newRem = billRem - payForBill;
    const newStatus = newRem === 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Credit');

    execRun(
      `UPDATE bills
       SET paid_amount = ?, remaining_amount = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newPaid, newRem, newStatus, bill.id]
    );
    billPayLeft -= payForBill;
  }

  // 2. Settle Transactions in FIFO order
  const unpaidTxs = execSelect(
    `SELECT id, paid_amount, remaining_amount, final_amount
     FROM transactions
     WHERE customer_id = ? AND remaining_amount > 0
     ORDER BY transaction_date ASC, id ASC`,
    [customerId]
  );

  let txPayLeft = amountPaise;
  for (const tx of unpaidTxs) {
    if (txPayLeft <= 0) break;
    const txRem = Number(tx.remaining_amount || 0);
    const payForTx = Math.min(txPayLeft, txRem);
    const newPaid = Number(tx.paid_amount || 0) + payForTx;
    const newRem = txRem - payForTx;
    const newType = newRem === 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Credit');

    execRun(
      `UPDATE transactions
       SET paid_amount = ?, remaining_amount = ?, payment_type = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newPaid, newRem, newType, tx.id]
    );
    txPayLeft -= payForTx;
  }
}

/**
 * Reverses settled debts in reverse chronological LIFO order (newest first).
 */
function unsettleDebtsLifo(customerId, amountPaise) {
  if (!amountPaise || amountPaise <= 0) return;

  // 1. Unsettle transactions in reverse chronological order (newest first)
  const paidTxs = execSelect(
    `SELECT id, paid_amount, remaining_amount, final_amount
     FROM transactions
     WHERE customer_id = ? AND paid_amount > 0
     ORDER BY transaction_date DESC, id DESC`,
    [customerId]
  );

  let txUnpayLeft = amountPaise;
  for (const tx of paidTxs) {
    if (txUnpayLeft <= 0) break;
    const txPaid = Number(tx.paid_amount || 0);
    const unpay = Math.min(txUnpayLeft, txPaid);
    const newPaid = txPaid - unpay;
    const newRem = Number(tx.remaining_amount || 0) + unpay;
    const newType = newRem === 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Credit');

    execRun(
      `UPDATE transactions
       SET paid_amount = ?, remaining_amount = ?, payment_type = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newPaid, newRem, newType, tx.id]
    );
    txUnpayLeft -= unpay;
  }

  // 2. Unsettle bills in reverse chronological order (newest first)
  const paidBills = execSelect(
    `SELECT id, paid_amount, remaining_amount, final_amount
     FROM bills
     WHERE customer_id = ? AND paid_amount > 0
     ORDER BY date DESC, id DESC`,
    [customerId]
  );

  let billUnpayLeft = amountPaise;
  for (const bill of paidBills) {
    if (billUnpayLeft <= 0) break;
    const billPaid = Number(bill.paid_amount || 0);
    const unpay = Math.min(billUnpayLeft, billPaid);
    const newPaid = billPaid - unpay;
    const newRem = Number(bill.remaining_amount || 0) + unpay;
    const newStatus = newRem === 0 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Credit');

    execRun(
      `UPDATE bills
       SET paid_amount = ?, remaining_amount = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newPaid, newRem, newStatus, bill.id]
    );
    billUnpayLeft -= unpay;
  }
}

/** Recalculate balance_after_transaction for all transactions of a customer */
function recalculateCustomerBalances(customerId) {
  const allTxs = execSelect(
    `SELECT id, transaction_type, amount FROM credit_transactions
     WHERE customer_id = ?
     ORDER BY CASE WHEN transaction_type = 'OPENING_BALANCE' THEN 0 ELSE 1 END ASC,
              created_at ASC, id ASC`,
    [customerId]
  );
  let running = 0;
  for (const t of allTxs) {
    running += signedAmount(t.transaction_type, t.amount);
    execRun(`UPDATE credit_transactions SET balance_after_transaction = ? WHERE id = ?`, [running, t.id]);
  }
}

/** Transactional payment registration */
function recordPayment({ customer_id, amount, payment_mode, note, date, created_at }) {
  return transaction(() => {
    const amountPaise = toPaise(amount);

    // Deduct from customer credit balance
    execRun(
      `UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`,
      [amountPaise, customer_id]
    );

    // Retrieve balance after (stored as paise)
    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    // Insert transaction with explicit created_at if provided
    const txCreatedAt = created_at || (date ? `${date} 12:00:00` : null);
    if (txCreatedAt) {
      execRun(
        `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
         VALUES (?, 'PAYMENT_RECEIVED', ?, ?, ?, ?, ?)`,
        [customer_id, amountPaise, payment_mode, note || 'Payment received', balanceAfter, txCreatedAt]
      );
    } else {
      execRun(
        `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
         VALUES (?, 'PAYMENT_RECEIVED', ?, ?, ?, ?)`,
        [customer_id, amountPaise, payment_mode, note || 'Payment received', balanceAfter]
      );
    }

    // Settle bills and transactions in FIFO order
    settleDebtsFifo(customer_id, amountPaise);

    return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
  });
}

/** Transactional discount registration in Udhar ledger */
function recordDiscount({ customer_id, amount, note }) {
  return transaction(() => {
    const amountPaise = toPaise(amount);

    // Deduct from customer credit balance
    execRun(
      `UPDATE customers SET credit_balance = credit_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amountPaise, customer_id]
    );

    // Retrieve balance after (stored as paise)
    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    // Insert transaction with type 'DISCOUNT'
    execRun(
      `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
       VALUES (?, 'DISCOUNT', ?, 'Other', ?, ?)`,
      [customer_id, amountPaise, note || 'Discount / सूट', balanceAfter]
    );

    // Settle bills and transactions in FIFO order
    settleDebtsFifo(customer_id, amountPaise);

    return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
  });
}

/** Undo / remove a received payment or discount */
function undoPayment(transactionId) {
  return transaction(() => {
    const txRow = execSelect(
      `SELECT * FROM credit_transactions WHERE id = ?`,
      [transactionId]
    );
    if (!txRow || txRow.length === 0) {
      throw new Error('Transaction not found');
    }
    const tx = txRow[0];
    if (!['PAYMENT_RECEIVED', 'DISCOUNT'].includes(tx.transaction_type)) {
      throw new Error(`Cannot undo transaction of type ${tx.transaction_type}`);
    }

    const customerId = tx.customer_id;
    const amountPaise = Number(tx.amount || 0);

    // 1. Restore customer balance
    execRun(
      `UPDATE customers SET credit_balance = credit_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amountPaise, customerId]
    );

    // 2. Delete the payment / discount row
    execRun(`DELETE FROM credit_transactions WHERE id = ?`, [transactionId]);

    // 3. Recalculate running balance_after_transaction for remaining rows
    recalculateCustomerBalances(customerId);

    // 4. Reverse the debt settlement in LIFO order
    unsettleDebtsLifo(customerId, amountPaise);

    // Get current balance
    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customerId]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    return { customer_id: customerId, balance_after_transaction: toRupees(balanceAfter) };
  });
}

/**
 * Transactional balance manual adjustments.
 *
 * The amount is stored with its sign: negative writes debt off, positive adds it.
 * It used to be stored as Math.abs(amount), which recorded a ₹500 write-off as a
 * ₹500 charge — the balance moved down while the passbook said it went up, so
 * replaying the passbook no longer reached the balance and the vendor had no way
 * to explain the difference to the customer.
 */
function recordAdjustment({ customer_id, amount, note }) {
  const signedPaise = toPaise(amount);

  return transaction(() => {
    // Adjust customer credit balance (amount can be positive or negative)
    execRun(
      `UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`,
      [signedPaise, customer_id]
    );

    // Retrieve balance after (stored as paise)
    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    // Insert transaction
    execRun(
      `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
       VALUES (?, 'CREDIT_ADJUSTMENT', ?, 'Other', ?, ?)`,
      [customer_id, signedPaise, note || 'Balance adjustment', balanceAfter]
    );

    // If debt is reduced/written off, settle unpaid debts FIFO
    if (signedPaise < 0) {
      settleDebtsFifo(customer_id, Math.abs(signedPaise));
    }

    return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
  });
}

/** True when this customer already has an opening balance on record. */
function hasOpeningBalance(customerId) {
  const rows = execSelect(
    `SELECT 1 FROM credit_transactions
     WHERE customer_id = ? AND transaction_type = 'OPENING_BALANCE'
     LIMIT 1`,
    [customerId]
  );
  return rows.length > 0;
}

/**
 * Records what a customer already owed before they existed in this app.
 *
 * Shops migrate off a paper notebook, and those customers arrive mid-debt. The only
 * way to represent that before this existed was to invent a bill, which put revenue
 * that never happened into the sales and commission reports and gave the customer a
 * bill for vegetables they could not be shown. So this writes the balance and one
 * ledger row explaining it — and no bill.
 *
 * It is deliberately its own row type rather than a CREDIT_ADJUSTMENT: a vendor
 * reading the passbook needs to tell "this is where we started" apart from "we
 * corrected something later", and an opening balance is the one row that legitimately
 * predates every bill.
 *
 * Stored signed, like recordAdjustment, so a customer who was in credit (the shop
 * owed *them*) can be opened with a negative figure.
 */
function formatOpeningBalanceDate(inputDate) {
  if (!inputDate) return null;
  const str = String(inputDate).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(`${str}T12:00:00`);
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  return null;
}

function recordOpeningBalance({ customer_id, amount, note, date, created_at }) {
  const signedPaise = toPaise(amount);
  const formattedDate = formatOpeningBalanceDate(date || created_at);

  return transaction(() => {
    execRun(
      `UPDATE customers SET credit_balance = credit_balance + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [signedPaise, customer_id]
    );

    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    if (formattedDate) {
      execRun(
        `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
         VALUES (?, 'OPENING_BALANCE', ?, 'Other', ?, ?, ?)`,
        [customer_id, signedPaise, note || 'Opening balance', balanceAfter, formattedDate]
      );
    } else {
      execRun(
        `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
         VALUES (?, 'OPENING_BALANCE', ?, 'Other', ?, ?)`,
        [customer_id, signedPaise, note || 'Opening balance', balanceAfter]
      );
    }

    return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
  });
}

function updateOpeningBalance({ customer_id, amount, date }) {
  const newPaise = toPaise(amount);
  const formattedDate = formatOpeningBalanceDate(date);

  return transaction(() => {
    const rows = execSelect(
      `SELECT id, amount, created_at FROM credit_transactions
       WHERE customer_id = ? AND transaction_type = 'OPENING_BALANCE'
       LIMIT 1`,
      [customer_id]
    );

    if (rows.length > 0) {
      const existing = rows[0];
      const oldPaise = existing.amount || 0;
      const diffPaise = newPaise - oldPaise;

      if (formattedDate) {
        execRun(
          `UPDATE credit_transactions
           SET amount = ?, created_at = ?
           WHERE id = ?`,
          [newPaise, formattedDate, existing.id]
        );
      } else {
        execRun(
          `UPDATE credit_transactions
           SET amount = ?
           WHERE id = ?`,
          [newPaise, existing.id]
        );
      }

      if (diffPaise !== 0) {
        execRun(
          `UPDATE customers
           SET credit_balance = credit_balance + ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [diffPaise, customer_id]
        );
      }

      const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
      const balanceAfter = balanceRow[0]?.credit_balance || 0;
      return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
    } else if (newPaise > 0) {
      return recordOpeningBalance({
        customer_id,
        amount,
        date,
        note: 'Opening balance (brought forward)',
      });
    }

    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;
    return { customer_id, balance_after_transaction: toRupees(balanceAfter) };
  });
}

function getAllTransactions() {
  return execSelect(`SELECT * FROM credit_transactions ORDER BY id ASC`).map((t) => rowToRupees(t, 'credit_transactions'));
}

module.exports = {
  getSummary,
  getCustomersWithBalance,
  getCustomerTransactions,
  getAllTransactions,
  findBalanceMismatches,
  recordPayment,
  recordDiscount,
  undoPayment,
  recordAdjustment,
  hasOpeningBalance,
  recordOpeningBalance,
  updateOpeningBalance,
  recalculateCustomerBalances,
};
