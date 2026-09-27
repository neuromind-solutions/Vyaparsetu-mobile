// backend/models/billModel.js

const { execSelect, execGet, execRun, transaction } = require('../database/db');
const { normalizeCommissionPercent } = require('../utils/calculation');
const { toPaise, rowToRupees, toRupees } = require('../utils/money');
const { localDateSql } = require('../utils/businessDay');
const { getByBillId, createMany, deleteByBillId } = require('./billItemModel');
const { recalculateCustomerBalances } = require('./creditModel');

/** Attach items, date-wise payments received, and accurate previous balance to a bill */
function attachBillDetails(bill) {
  if (!bill) return bill;
  bill.items = getByBillId(bill.id);

  // 1. Find customer's previous bill prior to this bill
  const prevBill = execGet(
    `SELECT id, bill_number, date, created_at
     FROM bills
     WHERE customer_id = ?
       AND (date < ? OR (date = ? AND id < ?))
     ORDER BY date DESC, id DESC
     LIMIT 1`,
    [bill.customer_id, bill.date, bill.date, bill.id || 0]
  );

  let prevBoundaryId = 0;
  if (prevBill) {
    const bRow = execGet(
      `SELECT MAX(id) as max_id FROM credit_transactions WHERE bill_id = ? OR created_at < ?`,
      [prevBill.id, prevBill.created_at || prevBill.date]
    );
    prevBoundaryId = bRow?.max_id || 0;
  }

  const currCreatedAt = bill.created_at || (bill.date ? bill.date + ' 23:59:59' : null);

  // 2. Query payments received from this customer between previous bill and current bill
  const payTxRows = execSelect(
    `SELECT id, amount, payment_mode, note, created_at,
            ${localDateSql('created_at')} AS pay_date
     FROM credit_transactions
     WHERE customer_id = ?
       AND transaction_type = 'PAYMENT_RECEIVED'
       AND (
         bill_id = ?
         OR (
           (? = 0 OR id > ? OR ${localDateSql('created_at')} > ?)
           AND (? IS NULL OR created_at <= ?)
           AND (bill_id IS NULL OR bill_id = ?)
         )
       )
     ORDER BY created_at ASC, id ASC`,
    [
      bill.customer_id,
      bill.id || -1,
      prevBoundaryId, prevBoundaryId, prevBill ? prevBill.date : '',
      currCreatedAt, currCreatedAt,
      bill.id || -1
    ]
  );

  // 3. Build date-wise payment breakdown
  const paymentsByDate = new Map();
  for (const r of payTxRows) {
    const d = r.pay_date || bill.date;
    const amt = toRupees(r.amount);
    if (!paymentsByDate.has(d)) {
      paymentsByDate.set(d, {
        date: d,
        amount: 0,
        payment_mode: r.payment_mode || 'Cash',
        note: r.note || '',
      });
    }
    const entry = paymentsByDate.get(d);
    entry.amount = Math.round((entry.amount + amt) * 100) / 100;
  }

  // Check if bill.paid_amount was paid directly on the bill and not yet in credit_transactions
  const billPaid = Number(bill.paid_amount || 0);
  const billDateKey = bill.date || new Date().toISOString().slice(0, 10);
  const existingOnBillDate = paymentsByDate.get(billDateKey)?.amount || 0;
  if (billPaid > existingOnBillDate) {
    const delta = Math.round((billPaid - existingOnBillDate) * 100) / 100;
    if (paymentsByDate.has(billDateKey)) {
      paymentsByDate.get(billDateKey).amount = billPaid;
    } else {
      paymentsByDate.set(billDateKey, {
        date: billDateKey,
        amount: delta,
        payment_mode: bill.payment_type || 'Cash',
        note: 'Payment on bill',
      });
    }
  }

  const paymentsBreakdown = Array.from(paymentsByDate.values())
    .filter(p => p.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalPaid = paymentsBreakdown.reduce((sum, p) => sum + p.amount, 0);
  const finalPaid = Math.max(billPaid, totalPaid);

  bill.payments_received = Number(finalPaid.toFixed(2));
  bill.payments_breakdown = paymentsBreakdown;

  const custBal = Number(bill.customer_credit_balance || 0);
  const finalAmt = Number(bill.final_amount || 0);

  // Invariant: prev_balance + final_amount - payments_received = customer_credit_balance
  const prevBal = Math.max(0, Math.round((custBal + finalPaid - finalAmt) * 100) / 100);
  bill.previous_balance = prevBal;

  return bill;
}

/** Get all bills with customer names, and attach items */
function findAll() {
  const bills = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile, c.credit_balance AS customer_credit_balance
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     ORDER BY b.date DESC, b.id DESC`
  ).map((b) => rowToRupees(b, 'bills'));
  for (const bill of bills) {
    attachBillDetails(bill);
  }
  return bills;
}

/** Get a bill by its ID, with items attached */
function findById(id) {
  const rows = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile, c.credit_balance AS customer_credit_balance
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.id = ?`,
    [id]
  );
  const bill = rows[0] ? rowToRupees(rows[0], 'bills') : null;
  if (bill) {
    attachBillDetails(bill);
  }
  return bill;
}

/** Get a bill by its bill_number, with items attached */
function findByNumber(number) {
  const rows = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile, c.credit_balance AS customer_credit_balance
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.bill_number = ?`,
    [number]
  );
  const bill = rows[0] ? rowToRupees(rows[0], 'bills') : null;
  if (bill) {
    attachBillDetails(bill);
  }
  return bill;
}

/** Search bills by number or customer name, and attach items */
function search(query) {
  const like = `%${query}%`;
  const bills = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile, c.credit_balance AS customer_credit_balance
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.bill_number LIKE ? OR c.name LIKE ?
     ORDER BY b.date DESC, b.id DESC`,
    [like, like]
  ).map((b) => rowToRupees(b, 'bills'));
  for (const bill of bills) {
    attachBillDetails(bill);
  }
  return bills;
}

/** Get bills by customer ID, and attach items */
function findByCustomerId(customerId) {
  const bills = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile, c.credit_balance AS customer_credit_balance
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.customer_id = ?
     ORDER BY b.date DESC, b.id DESC`,
    [customerId]
  ).map((b) => rowToRupees(b, 'bills'));
  for (const bill of bills) {
    attachBillDetails(bill);
  }
  return bills;
}

/**
 * The debt this bill booked *itself*, as recorded in the ledger.
 *
 * A bill entered through the Billing module originates its own debt. A bill
 * generated from a day's transactions does not — the transactions already booked
 * it, and their ledger rows are merely re-labelled with this bill's id. Those rows
 * carry a transaction_id, which is what distinguishes them here.
 *
 * Reversing a bill means reversing what it booked, so this is the figure to use
 * rather than remaining_amount.
 */
function selfBookedCredit(billId) {
  const rows = execSelect(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM credit_transactions
     WHERE bill_id = ? AND transaction_type = 'CREDIT_ADDED' AND transaction_id IS NULL`,
    [billId]
  );
  return Number(rows[0]?.total || 0);
}

/** Removes the ledger rows this bill originated, leaving transaction-owned rows. */
function deleteSelfBookedLedgerRows(billId) {
  execRun(
    `DELETE FROM credit_transactions
     WHERE bill_id = ? AND transaction_type = 'CREDIT_ADDED' AND transaction_id IS NULL`,
    [billId]
  );
}

/** Adds `amount` to a customer's balance and writes the matching ledger row. */
function bookCreditRow({ customerId, billId, amount, note }) {
  const amountPaise = toPaise(amount);
  execRun(`UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`, [
    amountPaise,
    customerId,
  ]);
  const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customerId]);
  const balanceAfter = Number(balanceRow[0]?.credit_balance || 0);

  execRun(
    `INSERT INTO credit_transactions
       (customer_id, bill_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
     VALUES (?, ?, 'CREDIT_ADDED', ?, 'Other', ?, ?)`,
    [customerId, billId, amountPaise, note, balanceAfter]
  );
}

/**
 * The next bill number: a plain running serial — `B-1`, `B-2`, `B-437`.
 *
 * The vendor reads this number out loud, writes it on a paper slip and searches for
 * it later, so shortness is the whole requirement. The old format spelled out the
 * period, the customer id and four digits of the epoch clock —
 * `BILL-20260801-20260828-008-3640`, 31 characters that no code ever parsed.
 * Everything it encoded is already its own column (`date`, `period_start`,
 * `period_end`, `customer_id`) and already shown next to the number in the UI.
 *
 * Only `B-<digits>` counts toward the maximum, so bills issued under the old format
 * keep their numbers untouched and can never collide with a new one. A deleted bill
 * leaves a gap in the sequence — the same thing a paper bill book does, and what
 * makes a removed settlement visible to anyone auditing the run.
 *
 * MUST be called inside the transaction that does the INSERT: this reads the table it
 * is about to be written to, and read-then-write is only atomic if nothing can slip
 * between the two.
 */
function nextBillNumber() {
  // GLOB, not LIKE: `LIKE 'B-%'` also matches `B-` followed by anything, and CAST
  // would silently turn a non-numeric tail into 0.
  const row = execGet(
    `SELECT MAX(CAST(SUBSTR(bill_number, 3) AS INTEGER)) AS maxSerial
       FROM bills
      WHERE bill_number GLOB 'B-[0-9]*'`
  );
  return `B-${Number(row?.maxSerial || 0) + 1}`;
}

/**
 * Create a new bill and its items.
 *
 * @param {object} data
 * @param {object}  [options]
 * @param {boolean} [options.bookCredit=true] Whether this bill should add its
 *   unpaid portion to the customer's balance.
 *
 *   Pass `false` when the debt already exists. `transactionService` books credit
 *   the moment an udhar sale is entered, so the vendor sees a running balance
 *   through the day; consolidating those sales into a bill must not charge for
 *   them a second time. Both this function and that one used to write to
 *   `customers.credit_balance` independently, which doubled every consolidated
 *   day's debt.
 */
function create(data, { bookCredit = true } = {}) {
  const dateVal = data.date || new Date().toISOString().split('T')[0];

  return transaction(() => {
    // Drawn inside the transaction — see nextBillNumber.
    const actualNumber = data.bill_number || nextBillNumber();

    const info = execRun(
      `INSERT INTO bills (
        bill_number, customer_id, date, period_start, period_end, subtotal, discount_type, discount_value,
        discount_amount, commission_rate, commission_amount, hamali_amount, transport_amount, final_amount,
        paid_amount, remaining_amount, payment_type, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actualNumber,
        data.customer_id,
        dateVal,
        // NULL unless this bill covers a span of days. A single-day bill's period is
        // its own `date`, so writing it here twice would only invite the two to drift.
        data.period_start || null,
        data.period_end || null,
        toPaise(data.subtotal),
        data.discount_type || 'fixed',
        data.discount_value || 0,
        toPaise(data.discount_amount || 0),
        normalizeCommissionPercent(data.commission_rate),
        toPaise(data.commission_amount),
        toPaise(data.hamali_amount || 0),
        toPaise(data.transport_amount || 0),
        toPaise(data.final_amount),
        toPaise(data.paid_amount || 0),
        toPaise(data.remaining_amount || 0),
        data.payment_type,
        data.payment_status,
      ]
    );

    const billId = Number(info.lastInsertRowid);
    if (!billId) throw new Error('Failed to retrieve inserted bill ID');

    if (data.items && data.items.length) {
      createMany(billId, data.items);
    }

    const rem = Number(data.remaining_amount) || 0;
    if (bookCredit && rem > 0) {
      bookCreditRow({
        customerId: data.customer_id,
        billId,
        amount: rem,
        note: `Bill #${actualNumber} generated`,
      });
    }

    return findById(billId);
  });
}

/** Update an existing bill and replace its items if provided */
function update(id, data) {
  const oldBill = findById(id);
  if (!oldBill) throw new Error('Bill not found');

  return transaction(() => {
    // 1. Revert all CREDIT_ADDED debt currently recorded for this bill.
    // Covers standalone bills, consolidated bills (whose credit rows carry this bill_id),
    // and bills previously edited.
    const bookedRows = execSelect(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM credit_transactions
       WHERE bill_id = ? AND transaction_type = 'CREDIT_ADDED'`,
      [id]
    );
    const prevCreditPaise = Number(bookedRows[0]?.total || 0);

    if (prevCreditPaise > 0) {
      execRun(`UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`, [
        prevCreditPaise,
        oldBill.customer_id,
      ]);
      execRun(
        `DELETE FROM credit_transactions
         WHERE bill_id = ? AND transaction_type = 'CREDIT_ADDED'`,
        [id]
      );
    }

    const fields = [];
    const values = [];
    if (data.bill_number) { fields.push('bill_number = ?'); values.push(data.bill_number); }
    if (data.customer_id) { fields.push('customer_id = ?'); values.push(data.customer_id); }
    if (data.date) { fields.push('date = ?'); values.push(data.date); }
    if (data.subtotal !== undefined) { fields.push('subtotal = ?'); values.push(toPaise(data.subtotal)); }
    if (data.discount_type) { fields.push('discount_type = ?'); values.push(data.discount_type); }
    if (data.discount_value !== undefined) { fields.push('discount_value = ?'); values.push(data.discount_value); }
    if (data.discount_amount !== undefined) { fields.push('discount_amount = ?'); values.push(toPaise(data.discount_amount)); }
    if (data.commission_rate !== undefined) { fields.push('commission_rate = ?'); values.push(normalizeCommissionPercent(data.commission_rate)); }
    if (data.commission_amount !== undefined) { fields.push('commission_amount = ?'); values.push(toPaise(data.commission_amount)); }
    if (data.hamali_amount !== undefined) { fields.push('hamali_amount = ?'); values.push(toPaise(data.hamali_amount)); }
    if (data.transport_amount !== undefined) { fields.push('transport_amount = ?'); values.push(toPaise(data.transport_amount)); }
    if (data.final_amount !== undefined) { fields.push('final_amount = ?'); values.push(toPaise(data.final_amount)); }
    if (data.paid_amount !== undefined) { fields.push('paid_amount = ?'); values.push(toPaise(data.paid_amount)); }
    if (data.remaining_amount !== undefined) { fields.push('remaining_amount = ?'); values.push(toPaise(data.remaining_amount)); }
    if (data.payment_type) { fields.push('payment_type = ?'); values.push(data.payment_type); }
    if (data.payment_status) { fields.push('payment_status = ?'); values.push(data.payment_status); }

    if (fields.length) {
      execRun(
        `UPDATE bills SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id]
      );
    }

    if (data.items) {
      deleteByBillId(id);
      createMany(id, data.items);
    }

    const newCustId = data.customer_id || oldBill.customer_id;
    const newRem =
      data.remaining_amount !== undefined
        ? Number(data.remaining_amount)
        : Number(oldBill.remaining_amount) || 0;
    const billNum = data.bill_number || oldBill.bill_number;

    if (newRem > 0) {
      bookCreditRow({
        customerId: newCustId,
        billId: id,
        amount: newRem,
        note: `Bill #${billNum} updated`,
      });
    }

    // Synchronize transactions table if transactions exist for this bill so all modules
    // (CustomerDailyPurchase, Reports, Excel, etc.) reflect the edited bill line items.
    const existingTxRows = execSelect(
      `SELECT id FROM transactions WHERE bill_id = ?`,
      [id]
    );

    if (existingTxRows.length > 0) {
      const itemsToSync = data.items || getByBillId(id);
      const targetCustId = newCustId;
      const targetDate = data.date || oldBill.date;
      const targetPaymentType = data.payment_type || oldBill.payment_type || 'Credit';
      const targetPaymentMode = targetPaymentType === 'Credit' ? 'Credit' : 'Cash';
      const targetCommRate = data.commission_rate !== undefined
        ? normalizeCommissionPercent(data.commission_rate)
        : normalizeCommissionPercent(oldBill.commission_rate);
      const targetPaid = data.paid_amount !== undefined ? Number(data.paid_amount) : Number(oldBill.paid_amount || 0);
      const targetFinal = data.final_amount !== undefined ? Number(data.final_amount) : Number(oldBill.final_amount || 0);

      // Delete stale transactions tied to this bill
      execRun(`DELETE FROM transactions WHERE bill_id = ?`, [id]);

      // Insert updated transactions reflecting the bill's current items
      if (itemsToSync && itemsToSync.length > 0) {
        for (const it of itemsToSync) {
          const itemQty = Number(it.quantity || 0);
          const itemRate = Number(it.rate || 0);
          const itemBaseRupees = Number(it.total !== undefined ? it.total : Math.round(itemQty * itemRate * 100) / 100);
          const lineCommRate = (it.commission_rate !== undefined && it.commission_rate !== null && String(it.commission_rate).trim() !== '')
            ? normalizeCommissionPercent(it.commission_rate)
            : targetCommRate;
          const itemCommRupees = Math.round(((itemBaseRupees * lineCommRate) / 100) * 100) / 100;
          const itemFinalRupees = Math.round((itemBaseRupees + itemCommRupees) * 100) / 100;

          let itemPaidRupees = 0;
          let itemRemRupees = itemFinalRupees;
          if (targetPaymentType === 'Paid' || (targetFinal > 0 && targetPaid >= targetFinal)) {
            itemPaidRupees = itemFinalRupees;
            itemRemRupees = 0;
          } else if (targetPaymentType === 'Partial' && targetFinal > 0 && targetPaid > 0) {
            const ratio = Math.min(1, targetPaid / targetFinal);
            itemPaidRupees = Math.round(itemFinalRupees * ratio * 100) / 100;
            itemRemRupees = Math.round((itemFinalRupees - itemPaidRupees) * 100) / 100;
          }

          execRun(
            `INSERT INTO transactions (
              customer_id, vegetable_id, vegetable_name_snapshot, weight, unit,
              rate, base_amount, commission_rate, commission_amount, final_amount,
              payment_type, payment_mode, paid_amount, remaining_amount,
              transaction_date, bill_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              targetCustId,
              it.vegetable_id,
              it.vegetable_name || '',
              itemQty,
              it.vegetable_unit || it.unit || 'kg',
              toPaise(itemRate),
              toPaise(itemBaseRupees),
              lineCommRate,
              toPaise(itemCommRupees),
              toPaise(itemFinalRupees),
              targetPaymentType,
              targetPaymentMode,
              toPaise(itemPaidRupees),
              toPaise(itemRemRupees),
              it.item_date || targetDate,
              id,
              it.created_at || oldBill.created_at || new Date().toISOString()
            ]
          );
        }
      }
    }

    recalculateCustomerBalances(newCustId);
    if (newCustId !== oldBill.customer_id) {
      recalculateCustomerBalances(oldBill.customer_id);
    }

    return findById(id);
  });
}

/**
 * Delete a bill and its items.
 *
 * Children go before the parent: with foreign keys enforced, deleting a bill that
 * still has bill_items violates the constraint and the whole delete rolls back.
 */
function remove(id) {
  const oldBill = findById(id);
  if (!oldBill) return false;

  const existingTxs = execSelect(
    `SELECT id, remaining_amount, customer_id, vegetable_name_snapshot, weight, unit, payment_mode
     FROM transactions WHERE bill_id = ?`,
    [id]
  );
  const hasTransactions = existingTxs.length > 0;
  const ownCredit = selfBookedCredit(id);

  return transaction(() => {
    if (hasTransactions) {
      // Consolidated bill: its transactions return to unbilled so the vendor can re-bill them.
      // Invariant: The sales still happened and the customer still owes for them.
      // Therefore, the transactions' debt must NOT be deducted from the customer's balance.

      // Calculate total transaction debt in paise
      const txDebtPaise = existingTxs.reduce((s, t) => s + Number(t.remaining_amount || 0), 0);

      // If the bill had standalone bill-level fees exceeding transaction debt (e.g. hamali/transport),
      // deduct only that bill-level excess.
      const billLevelExcessPaise = Math.max(0, ownCredit - txDebtPaise);
      if (billLevelExcessPaise > 0) {
        execRun(`UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`, [
          billLevelExcessPaise,
          oldBill.customer_id,
        ]);
      }

      // Ensure every returning transaction has its credit_transactions entry
      for (const tx of existingTxs) {
        const txRemPaise = Number(tx.remaining_amount || 0);
        if (txRemPaise > 0) {
          const ctRow = execSelect(
            `SELECT id FROM credit_transactions WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'`,
            [tx.id]
          );
          if (ctRow.length === 0) {
            // Re-create transaction-tied credit row so the unbilled transaction has its audit trail
            execRun(
              `INSERT INTO credit_transactions
                 (customer_id, transaction_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
               VALUES (?, ?, 'CREDIT_ADDED', ?, ?, ?, 0)`,
              [
                oldBill.customer_id,
                tx.id,
                txRemPaise,
                tx.payment_mode || 'Credit',
                `Udhar: ${tx.vegetable_name_snapshot || ''} (${tx.weight || ''}${tx.unit || 'kg'})`
              ]
            );
          }
        }
      }

      // Delete self-booked ledger rows for this bill, and unlink transaction-tied ledger rows
      deleteSelfBookedLedgerRows(id);
      execRun(`UPDATE credit_transactions SET bill_id = NULL WHERE bill_id = ?`, [id]);

      // Return the source transactions to unbilled
      execRun(`UPDATE transactions SET bill_id = NULL WHERE bill_id = ?`, [id]);
    } else {
      // Pure standalone bill: originated its own debt and has no underlying transactions
      if (ownCredit > 0) {
        execRun(`UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`, [
          ownCredit,
          oldBill.customer_id,
        ]);
      }

      deleteSelfBookedLedgerRows(id);
      execRun(`UPDATE credit_transactions SET bill_id = NULL WHERE bill_id = ?`, [id]);
    }

    execRun(`DELETE FROM bill_items WHERE bill_id = ?`, [id]);
    execRun(`DELETE FROM bills WHERE id = ?`, [id]);

    recalculateCustomerBalances(oldBill.customer_id);

    return true;
  });
}

module.exports = {
  findAll,
  findById,
  findByNumber,
  findByCustomerId,
  search,
  create,
  nextBillNumber,
  update,
  remove,
  selfBookedCredit,
};
