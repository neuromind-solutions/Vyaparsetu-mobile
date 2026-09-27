/**
 * Transaction Service
 * Business logic, validation, calculations, credit balance updates,
 * and bill consolidation for customer vegetable transactions.
 */

const transactionModel = require('../models/transactionModel');
const customerModel = require('../models/customerModel');
const vegetableModel = require('../models/vegetableModel');
const billModel = require('../models/billModel');
const creditModel = require('../models/creditModel');
const settingsModel = require('../models/settingsModel');
const {
  calculateTransactionTotals,
  normalizeCommissionPercent,
  DEFAULT_COMMISSION_PERCENT,
} = require('../utils/calculation');
const { execRun, execGet, execSelect, transaction } = require('../database/db');
const { toPaise } = require('../utils/money');
const logger = require('../utils/logger');

/**
 * Returns local YYYY-MM-DD date string.
 */
function getLocalDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The shop's commission rate, as a percentage.
 *
 * Read from settings rather than taken from the request. The rate is a property of
 * the shop, not of one sale, and accepting it from the client meant a stale or
 * hand-edited payload could bill a customer at any rate at all — the frontend was
 * sending 0.08 while the schema default was 8, so the same sale was charged 8% or
 * 800% depending on which value arrived.
 */
function getShopCommissionPercent() {
  const stored = settingsModel.getSetting('commission_rate');
  if (stored === null || stored === undefined || stored === '') {
    return DEFAULT_COMMISSION_PERCENT;
  }
  return normalizeCommissionPercent(stored);
}

/**
 * Creates a new customer vegetable transaction and updates credit balance if unpaid.
 */
async function createTransaction(payload) {
  const {
    customer_id,
    vegetable_id,
    vegetable_name_snapshot,
    weight,
    rate,
    unit,
    payment_type = 'Credit', // 'Paid', 'Credit', 'Partial'
    payment_mode = 'Cash',  // 'Cash', 'UPI', 'Credit', 'Other'
    paid_amount,
    transaction_date
  } = payload || {};

  // 1. Validate Customer
  if (!customer_id) {
    return { success: false, error: 'Customer selection is required' };
  }
  const customer = customerModel.findById(customer_id);
  if (!customer) {
    return { success: false, error: 'Selected customer does not exist' };
  }

  // 2. Validate Vegetable
  if (!vegetable_id) {
    return { success: false, error: 'Vegetable selection is required' };
  }
  const vegetable = vegetableModel.findById(vegetable_id);
  if (!vegetable) {
    return { success: false, error: 'Selected vegetable does not exist' };
  }

  // 3. Validate Weight
  const numWeight = Number(weight);
  if (isNaN(numWeight) || numWeight <= 0) {
    return { success: false, error: 'Weight must be greater than 0' };
  }

  // 4. Validate Rate
  const numRate = Number(rate);
  if (isNaN(numRate) || numRate < 0) {
    return { success: false, error: 'Rate must be 0 or greater' };
  }

  // 5. Calculate Base, Commission, Final Amount at custom or shop's configured rate
  const effectiveCommissionRate = payload.commission_rate !== undefined && payload.commission_rate !== null && String(payload.commission_rate).trim() !== ''
    ? normalizeCommissionPercent(payload.commission_rate)
    : getShopCommissionPercent();
  const totals = calculateTransactionTotals(numWeight, numRate, effectiveCommissionRate);

  // 6. Payment Amount Calculations
  let finalPaid = 0;
  let finalRemaining = totals.finalAmount;

  if (payment_type === 'Paid') {
    finalPaid = totals.finalAmount;
    finalRemaining = 0;
  } else if (payment_type === 'Partial') {
    const rawPaid = Number(paid_amount) || 0;
    finalPaid = Math.min(totals.finalAmount, Math.max(0, Math.round(rawPaid * 100) / 100));
    finalRemaining = Math.round((totals.finalAmount - finalPaid) * 100) / 100;
  } else {
    // Credit
    finalPaid = 0;
    finalRemaining = totals.finalAmount;
  }

  // Snapshot name from payload or DB
  const vegName = vegetable_name_snapshot && vegetable_name_snapshot.trim()
    ? vegetable_name_snapshot.trim()
    : vegetable.name;

  // Set local date if not specified
  const tDate = transaction_date && transaction_date.trim()
    ? transaction_date.trim()
    : getLocalDateString();

  try {
    // The sale, the customer's balance and the ledger row are one fact recorded in
    // three places. Written separately, a failure between them left the balance
    // and the passbook disagreeing with no way to tell which was right.
    const created = transaction(() => {
      const newTransaction = transactionModel.create({
        customer_id: Number(customer_id),
        vegetable_id: Number(vegetable_id),
        vegetable_name_snapshot: vegName,
        weight: numWeight,
        unit: unit || vegetable.unit || 'kg',
        rate: numRate,
        base_amount: totals.baseAmount,
        commission_rate: totals.commissionRate,
        commission_amount: totals.commissionAmount,
        final_amount: totals.finalAmount,
        payment_type,
        payment_mode: payment_type === 'Credit' ? 'Credit' : payment_mode,
        paid_amount: finalPaid,
        remaining_amount: finalRemaining,
        transaction_date: tDate
      });

      if (finalRemaining > 0) {
        const remainingPaise = toPaise(finalRemaining);

        execRun(`UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`, [
          remainingPaise,
          customer_id,
        ]);

        const balanceRow = execGet(`SELECT credit_balance FROM customers WHERE id = ?`, [
          customer_id,
        ]);
        const balanceAfter = balanceRow?.credit_balance || 0;

        // transaction_id ties this ledger row to the sale, so deleting the sale
        // can reverse exactly the debt it booked.
        execRun(
          `INSERT INTO credit_transactions
             (customer_id, transaction_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
           VALUES (?, ?, 'CREDIT_ADDED', ?, ?, ?, ?)`,
          [
            customer_id,
            newTransaction.id,
            remainingPaise,
            payment_mode || 'Credit',
            `Udhar added: ${vegName} (${numWeight}kg)`,
            balanceAfter,
          ]
        );
      }

      return newTransaction;
    });

    return { success: true, data: created };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * The commission rate to record on a consolidated bill, as a percentage.
 *
 * Every sale on one day carries the same shop rate, so a daily bill just reuses it.
 * A range can straddle a rate change — the vendor edited Settings mid-week — and
 * there is then no single rate that is true of every line. Rather than pick one and
 * misreport the others, the effective rate is derived from the money actually
 * charged, which is the figure that has to reconcile.
 *
 * The amounts are what the customer owes either way; this column is reference only.
 */
function billRateFor(transactions, subtotal, commissionAmount) {
  // `?? shopRate` before normalizing, not after: normalizeCommissionPercent reads a
  // SQL NULL as a deliberate 0%, which is right for a rate the vendor set and wrong
  // for a rate that is simply absent.
  const shopRate = getShopCommissionPercent();
  const rates = new Set(
    transactions.map((t) => normalizeCommissionPercent(t.commission_rate ?? shopRate))
  );
  if (rates.size === 1) {
    return [...rates][0];
  }
  if (subtotal <= 0) {
    return shopRate;
  }
  return Math.round((commissionAmount / subtotal) * 10000) / 100;
}

/**
 * Parses a YYYY-MM-DD date string, returning null for anything that is not one.
 *
 * Stricter than a shape check on purpose: `2026-02-31` matches the pattern but is not
 * a day, and a bill whose period ends on a date that does not exist is a support call
 * nobody can reproduce. Round-tripping through Date.UTC rejects it.
 */
function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return { text, utc };
}

/**
 * The widest period one bill may cover, in days, inclusive of both ends.
 *
 * A vendor consolidating a notebook can legitimately want a month or a season. A
 * range of years is a mistyped year, and billing it would sweep a customer's entire
 * history onto one sheet — recoverable only by deleting the bill.
 */
const MAX_BILL_PERIOD_DAYS = 366;

/**
 * Consolidates a customer's unbilled transactions for a single day into a formal Bill.
 *
 * Only *unbilled* transactions are consolidated, and they are claimed by the bill as
 * part of the same database transaction that creates it. Running this twice therefore
 * finds nothing the second time instead of billing the customer again.
 *
 * For period/range reports, use `generateStatement` instead — it returns a read-only
 * bill-shaped object without saving anything to the database.
 *
 * The bill does not book credit: `createTransaction` already did, when each sale
 * was entered. The existing ledger rows are relabelled with the new bill's id so
 * the passbook still points at the bill, and the customer's balance is untouched.
 */
async function generateBillFromTransactions({ customerId, date, startDate, endDate }) {
  const wantsRange = Boolean(
    (typeof startDate === 'string' && startDate.trim()) ||
    (typeof endDate === 'string' && endDate.trim())
  );

  let periodStart = null;
  let periodEnd = null;
  let targetDate;

  if (wantsRange) {
    const from = parseDateOnly(startDate);
    const to = parseDateOnly(endDate);
    if (!from || !to) {
      return { success: false, error: 'A date range needs a valid start and end date (YYYY-MM-DD)' };
    }
    if (from.utc > to.utc) {
      return { success: false, error: 'The start date must not be after the end date' };
    }
    const span = Math.round((to.utc - from.utc) / 86400000) + 1;
    if (span > MAX_BILL_PERIOD_DAYS) {
      return {
        success: false,
        error: `A single bill can cover at most ${MAX_BILL_PERIOD_DAYS} days — this range covers ${span}`,
      };
    }

    periodStart = from.text;
    periodEnd = to.text;
    targetDate = to.text;
  } else {
    targetDate = date ? date.trim() : getLocalDateString();
  }

  const customer = customerModel.findById(customerId);
  if (!customer) return { success: false, error: 'Customer not found' };

  const rawTransactions = wantsRange
    ? transactionModel.findUnbilledByCustomerAndDateRange(customerId, periodStart, periodEnd)
    : transactionModel.findUnbilledByCustomerAndDate(customerId, targetDate);

  if (!rawTransactions || rawTransactions.length === 0) {
    const alreadyBilled = wantsRange
      ? transactionModel.findByCustomerAndDateRange(customerId, periodStart, periodEnd)
      : transactionModel.findByCustomerAndDate(customerId, targetDate);

    if (alreadyBilled && alreadyBilled.length > 0) {
      return {
        success: false,
        error: wantsRange
          ? 'Every transaction in this period has already been billed for this customer'
          : "This day's transactions have already been billed for this customer",
      };
    }
    return {
      success: false,
      error: wantsRange
        ? 'No transactions found for this customer in the selected period'
        : 'No transactions found for this customer on the selected date',
    };
  }

  // Sort chronologically so the bill prints entries in sequence
  const transactions = [...rawTransactions].sort(
    (a, b) => a.transaction_date.localeCompare(b.transaction_date) || (a.id - b.id)
  );

  // Calculate totals across the transactions being consolidated
  const subtotal = transactions.reduce((acc, t) => acc + Number(t.base_amount || 0), 0);
  const commissionAmount = transactions.reduce((acc, t) => acc + Number(t.commission_amount || 0), 0);
  const finalAmount = transactions.reduce((acc, t) => acc + Number(t.final_amount || 0), 0);
  const paidAmount = transactions.reduce((acc, t) => acc + Number(t.paid_amount || 0), 0);
  const remainingAmount = transactions.reduce((acc, t) => acc + Number(t.remaining_amount || 0), 0);

  let paymentStatus = 'Credit';
  if (remainingAmount <= 0) {
    paymentStatus = 'Paid';
  } else if (paidAmount > 0) {
    paymentStatus = 'Partial';
  }

  // Keep each transaction entry as its own distinct line item on the bill
  const items = transactions.map((t) => ({
    vegetable_id: t.vegetable_id,
    vegetable_name: t.vegetable_name_snapshot,
    quantity: Number(t.weight || 0),
    rate: Number(t.rate || 0),
    total: Number(t.base_amount || 0),
    vegetable_unit: t.unit || 'kg',
    item_date: t.transaction_date || targetDate,
  }));

  const billCommissionRate = billRateFor(transactions, subtotal, commissionAmount);

  const transactionIds = transactions.map((t) => t.id);

  try {
    const createdBill = transaction(() => {
      const bill = billModel.create(
        {
          customer_id: Number(customerId),
          customer_name: customer.name,
          customer_mobile: customer.mobile,
          date: targetDate,
          period_start: periodStart,
          period_end: periodEnd,
          subtotal: Math.round(subtotal * 100) / 100,
          discount_type: 'fixed',
          discount_value: 0,
          discount_amount: 0,
          commission_rate: billCommissionRate,
          commission_amount: Math.round(commissionAmount * 100) / 100,
          hamali_amount: 0,
          transport_amount: 0,
          final_amount: Math.round(finalAmount * 100) / 100,
          paid_amount: Math.round(paidAmount * 100) / 100,
          remaining_amount: Math.round(remainingAmount * 100) / 100,
          payment_type: paymentStatus === 'Credit' ? 'Credit' : 'Cash',
          payment_status: paymentStatus,
          items
        },
        // The transactions already booked this debt.
        { bookCredit: false }
      );

      const claimed = transactionModel.markAsBilled(transactionIds, bill.id);
      if (claimed !== transactionIds.length) {
        throw new Error('Transactions were billed concurrently — no bill was created');
      }

      // Point the existing ledger rows at this bill so the passbook and the bill
      // agree, and heal any transaction that was missing a ledger row.
      for (const t of transactions) {
        const tRem = Number(t.remaining_amount || 0);
        if (tRem > 0) {
          const ctRow = execSelect(
            `SELECT id FROM credit_transactions WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'`,
            [t.id]
          );
          if (ctRow.length === 0) {
            const createdAt = t.created_at || (t.transaction_date ? `${t.transaction_date} 06:00:00` : new Date().toISOString().replace('T', ' ').slice(0, 19));
            execRun(
              `INSERT INTO credit_transactions
                 (customer_id, transaction_id, bill_id, transaction_type, amount, payment_mode, note, balance_after_transaction, created_at)
               VALUES (?, ?, ?, 'CREDIT_ADDED', ?, ?, ?, 0, ?)`,
              [
                Number(customerId),
                t.id,
                bill.id,
                toPaise(tRem),
                t.payment_mode || 'Credit',
                `Udhar added: ${t.vegetable_name_snapshot || ''}${t.weight ? ` (${t.weight}${t.unit || 'kg'})` : ''}`,
                createdAt
              ]
            );
            execRun(`UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`, [
              toPaise(tRem),
              Number(customerId),
            ]);
          } else {
            execRun(
              `UPDATE credit_transactions SET bill_id = ?
               WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'`,
              [bill.id, t.id]
            );
          }
        }
      }

      creditModel.recalculateCustomerBalances(Number(customerId));

      return billModel.findById(bill.id);
    });

    return { success: true, data: createdBill };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Generates a read-only period statement for a customer across a date range.
 *
 * This is NOT saved to the database — it returns a bill-shaped object for the
 * frontend to render, print, download as PDF, or share via WhatsApp. The vendor
 * can regenerate it any time for any date range without cluttering the Invoices.
 *
 * All transactions (billed and unbilled) within the range are included, so the
 * customer gets a complete picture of their purchases across the period.
 */
async function generateStatement({ customerId, startDate, endDate }) {
  const from = parseDateOnly(startDate);
  const to = parseDateOnly(endDate);
  if (!from || !to) {
    return { success: false, error: 'A date range needs a valid start and end date (YYYY-MM-DD)' };
  }
  if (from.utc > to.utc) {
    return { success: false, error: 'The start date must not be after the end date' };
  }
  const span = Math.round((to.utc - from.utc) / 86400000) + 1;
  if (span > MAX_BILL_PERIOD_DAYS) {
    return {
      success: false,
      error: `A statement can cover at most ${MAX_BILL_PERIOD_DAYS} days — this range covers ${span}`,
    };
  }

  const periodStart = from.text;
  const periodEnd = to.text;

  const customer = customerModel.findById(customerId);
  if (!customer) return { success: false, error: 'Customer not found' };

  const rawTransactions = transactionModel.findByCustomerAndDateRange(
    customerId, periodStart, periodEnd
  );

  if (!rawTransactions || rawTransactions.length === 0) {
    return {
      success: false,
      error: 'No transactions found for this customer in the selected period',
    };
  }

  // Sort chronologically (oldest date first)
  const transactions = [...rawTransactions].sort(
    (a, b) => a.transaction_date.localeCompare(b.transaction_date) || (a.id - b.id)
  );

  // Calculate totals
  const subtotal = transactions.reduce((acc, t) => acc + Number(t.base_amount || 0), 0);
  const commissionAmount = transactions.reduce((acc, t) => acc + Number(t.commission_amount || 0), 0);
  const finalAmount = transactions.reduce((acc, t) => acc + Number(t.final_amount || 0), 0);
  const paidAmount = transactions.reduce((acc, t) => acc + Number(t.paid_amount || 0), 0);
  const remainingAmount = transactions.reduce((acc, t) => acc + Number(t.remaining_amount || 0), 0);

  let paymentStatus = 'Credit';
  if (remainingAmount <= 0) {
    paymentStatus = 'Paid';
  } else if (paidAmount > 0) {
    paymentStatus = 'Partial';
  }

  // Keep each transaction entry as its own distinct line item on the statement
  const items = transactions.map((t) => ({
    vegetable_id: t.vegetable_id,
    vegetable_name: t.vegetable_name_snapshot,
    quantity: Number(t.weight || 0),
    rate: Number(t.rate || 0),
    total: Number(t.base_amount || 0),
    vegetable_unit: t.unit || 'kg',
    item_date: t.transaction_date,
  }));

  const billCommissionRate = billRateFor(transactions, subtotal, commissionAmount);

  // Read the customer's current credit balance for "previous outstanding" display
  const { localDateSql } = require('../utils/businessDay');
  const { toRupees } = require('../utils/money');
  const customerBalance = Number(customer.credit_balance || 0);

  // Query payments received from this customer during the statement period
  const payRows = execSelect(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM credit_transactions
     WHERE customer_id = ?
       AND transaction_type = 'PAYMENT_RECEIVED'
       AND (${localDateSql('created_at')} >= ? AND ${localDateSql('created_at')} <= ?)`,
    [Number(customerId), periodStart, periodEnd]
  );
  const ledgerPaidPaise = payRows[0]?.total_paid || 0;
  const ledgerPaidRupees = toRupees(ledgerPaidPaise);
  const finalPaidAmount = Math.max(paidAmount, ledgerPaidRupees);
  const finalPaidRounded = Math.round(finalPaidAmount * 100) / 100;
  const previousBalance = Math.max(0, Math.round((customerBalance + finalPaidRounded - finalAmount) * 100) / 100);

  // Return a bill-shaped object WITHOUT saving anything
  return {
    success: true,
    data: {
      // No id or bill_number — this is a statement, not a saved invoice
      id: null,
      bill_number: null,
      customer_id: Number(customerId),
      customer_name: customer.name,
      customer_mobile: customer.mobile,
      customer_credit_balance: customerBalance,
      previous_balance: previousBalance,
      payments_received: finalPaidRounded,
      date: periodEnd,
      period_start: periodStart,
      period_end: periodEnd,
      subtotal: Math.round(subtotal * 100) / 100,
      discount_type: 'fixed',
      discount_value: 0,
      discount_amount: 0,
      commission_rate: billCommissionRate,
      commission_amount: Math.round(commissionAmount * 100) / 100,
      hamali_amount: 0,
      transport_amount: 0,
      final_amount: Math.round(finalAmount * 100) / 100,
      paid_amount: finalPaidRounded,
      remaining_amount: Math.round(remainingAmount * 100) / 100,
      payment_type: paymentStatus === 'Credit' ? 'Credit' : 'Cash',
      payment_status: paymentStatus,
      items,
    },
  };
}

/**
 * Auto-bills unbilled transactions from dates before today.
 *
 * Runs once on server startup. For each (customer, date) pair that has unbilled
 * transactions from a past date, generates and saves a daily bill. This ensures
 * that if a vendor forgot to click "Generate Bill" yesterday, the entries are
 * still captured as invoices.
 */
async function autoBillPastTransactions() {
  const today = getLocalDateString();
  try {
    const unbilledDays = execSelect(
      `SELECT DISTINCT customer_id, transaction_date
       FROM transactions
       WHERE bill_id IS NULL AND transaction_date < ?
       ORDER BY transaction_date ASC`,
      [today]
    );

    if (unbilledDays.length === 0) {
      logger.info('Auto-bill: no unbilled past transactions found.');
      return { generated: 0 };
    }

    let generated = 0;
    for (const { customer_id, transaction_date } of unbilledDays) {
      const result = await generateBillFromTransactions({
        customerId: customer_id,
        date: transaction_date,
      });
      if (result.success) {
        generated++;
        logger.info(
          `Auto-bill: generated bill for customer #${customer_id} on ${transaction_date} → ${result.data.bill_number}`
        );
      } else {
        logger.warn(
          `Auto-bill: skipped customer #${customer_id} on ${transaction_date} — ${result.error}`
        );
      }
    }

    logger.info(`Auto-bill: generated ${generated} bill(s) for past unbilled transactions.`);
    return { generated };
  } catch (err) {
    logger.error(`Auto-bill failed: ${err.message}`);
    return { generated: 0, error: err.message };
  }
}

/**
 * Get single transaction by ID.
 */
async function getTransactionById(id) {
  try {
    const transaction = transactionModel.findById(id);
    if (!transaction) return { success: false, error: 'Transaction not found' };
    return { success: true, data: transaction };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get all transactions for a specific customer with optional date or range filters.
 */
async function getCustomerTransactions(customerId, query = {}) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };

    const { date, startDate, endDate } = query;
    let list = [];

    if (date) {
      list = transactionModel.findByCustomerAndDate(customerId, date);
    } else if (startDate && endDate) {
      list = transactionModel.findByCustomerAndDateRange(customerId, startDate, endDate);
    } else {
      list = transactionModel.findAll({ customerId });
    }

    return { success: true, data: list };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get daily purchase summary & transactions list for a customer on a specific date.
 */
async function getCustomerDailyPurchase(customerId, date) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };

    const targetDate = date ? date.trim() : getLocalDateString();
    const summary = transactionModel.getDailyCustomerSummary(customerId, targetDate);
    const transactions = transactionModel.findByCustomerAndDate(customerId, targetDate);

    return {
      success: true,
      data: {
        customer,
        date: targetDate,
        summary,
        transactions
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get transactions list across all customers or filtered by parameters.
 */
async function getAllTransactions(query = {}) {
  try {
    const list = transactionModel.findAll(query);
    return { success: true, data: list };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Delete a transaction by ID after confirmation.
 *
 * Deleting an udhar sale must also cancel the debt it created. Previously it
 * removed the row and left the balance standing, so the customer kept owing money
 * for a sale the vendor had already decided never happened — and the passbook no
 * longer replayed to the balance.
 */
async function deleteTransaction(id) {
  try {
    const existing = transactionModel.findById(id);
    if (!existing) return { success: false, error: 'Transaction not found' };

    // A transaction inside a bill cannot be deleted on its own: the bill's totals
    // and its line items would no longer match the sales behind them. Delete the
    // bill first, which releases its transactions.
    if (existing.bill_id) {
      return {
        success: false,
        error:
          'This transaction is part of a generated bill. Delete the bill first, then delete the transaction.',
      };
    }

    transaction(() => {
      // Reverse exactly what this sale booked, read from the ledger rather than
      // recomputed, so a later change to the pricing rules cannot make the
      // reversal disagree with the original charge.
      const bookedRow = execGet(
        `SELECT COALESCE(SUM(amount), 0) AS booked FROM credit_transactions
         WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'`,
        [id]
      );
      const booked = Number(bookedRow?.booked || 0);

      if (booked > 0) {
        execRun(`UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`, [
          booked,
          existing.customer_id,
        ]);
      }

      // The ledger rows go with the sale. Keeping a reversal entry would be the
      // other reasonable choice, but the vendor's passbook is short and read by
      // hand — a cancelled sale is clearer absent than present twice.
      execRun(`DELETE FROM credit_transactions WHERE transaction_id = ?`, [id]);

      transactionModel.deleteById(id);
    });

    return { success: true, message: 'Transaction deleted successfully' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update an existing transaction by ID.
 * Recalculates financial totals, rolls back previous credit ledger booking,
 * and records new credit/udhar debt if applicable within a transaction.
 */
async function updateTransaction(id, payload) {
  try {
    const existing = transactionModel.findById(id);
    if (!existing) return { success: false, error: 'Transaction not found' };

    // Disallow editing if already consolidated into a bill
    if (existing.bill_id) {
      return {
        success: false,
        error: 'This transaction is part of a generated bill. Delete or cancel the bill first, then edit the transaction.',
      };
    }

    const {
      customer_id = existing.customer_id,
      vegetable_id = existing.vegetable_id,
      vegetable_name_snapshot,
      weight = existing.weight,
      rate = existing.rate,
      unit = existing.unit || 'kg',
      payment_type = existing.payment_type || 'Credit',
      payment_mode = existing.payment_mode || 'Cash',
      paid_amount,
      transaction_date = existing.transaction_date,
    } = payload || {};

    // 1. Validate Customer
    const customer = customerModel.findById(customer_id);
    if (!customer) {
      return { success: false, error: 'Selected customer does not exist' };
    }

    // 2. Validate Vegetable
    const vegetable = vegetableModel.findById(vegetable_id);
    if (!vegetable) {
      return { success: false, error: 'Selected vegetable does not exist' };
    }

    // 3. Validate Weight
    const numWeight = Number(weight);
    if (isNaN(numWeight) || numWeight <= 0) {
      return { success: false, error: 'Weight must be greater than 0' };
    }

    // 4. Validate Rate
    const numRate = Number(rate);
    if (isNaN(numRate) || numRate < 0) {
      return { success: false, error: 'Rate must be 0 or greater' };
    }

    // 5. Calculate Base, Commission, Final Amount at custom or shop's configured rate
    const effectiveCommissionRate = payload.commission_rate !== undefined && payload.commission_rate !== null && String(payload.commission_rate).trim() !== ''
      ? normalizeCommissionPercent(payload.commission_rate)
      : (existing.commission_rate !== undefined ? existing.commission_rate : getShopCommissionPercent());
    const totals = calculateTransactionTotals(numWeight, numRate, effectiveCommissionRate);

    // 6. Payment Amount Calculations
    let finalPaid = 0;
    let finalRemaining = totals.finalAmount;

    if (payment_type === 'Paid') {
      finalPaid = totals.finalAmount;
      finalRemaining = 0;
    } else if (payment_type === 'Partial') {
      const rawPaid = Number(paid_amount !== undefined ? paid_amount : existing.paid_amount) || 0;
      finalPaid = Math.min(totals.finalAmount, Math.max(0, Math.round(rawPaid * 100) / 100));
      finalRemaining = Math.round((totals.finalAmount - finalPaid) * 100) / 100;
    } else {
      // Credit
      finalPaid = 0;
      finalRemaining = totals.finalAmount;
    }

    const vegName = vegetable_name_snapshot && vegetable_name_snapshot.trim()
      ? vegetable_name_snapshot.trim()
      : vegetable.name;

    const tDate = transaction_date && transaction_date.trim()
      ? transaction_date.trim()
      : existing.transaction_date;

    const updated = transaction(() => {
      // Step A: Revert old credit booking from old customer
      const bookedRow = execGet(
        `SELECT COALESCE(SUM(amount), 0) AS booked FROM credit_transactions
         WHERE transaction_id = ? AND transaction_type = 'CREDIT_ADDED'`,
        [id]
      );
      const booked = Number(bookedRow?.booked || 0);

      if (booked > 0) {
        execRun(`UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`, [
          booked,
          existing.customer_id,
        ]);
      }

      // Step B: Delete old credit_transactions for this transaction
      execRun(`DELETE FROM credit_transactions WHERE transaction_id = ?`, [id]);

      // Step C: Update the transaction record
      const result = transactionModel.updateById(id, {
        customer_id: Number(customer_id),
        vegetable_id: Number(vegetable_id),
        vegetable_name_snapshot: vegName,
        weight: numWeight,
        unit: unit || vegetable.unit || 'kg',
        rate: numRate,
        base_amount: totals.baseAmount,
        commission_rate: totals.commissionRate,
        commission_amount: totals.commissionAmount,
        final_amount: totals.finalAmount,
        payment_type,
        payment_mode: payment_type === 'Credit' ? 'Credit' : payment_mode,
        paid_amount: finalPaid,
        remaining_amount: finalRemaining,
        transaction_date: tDate,
      });

      // Step D: If there is remaining credit/udhar, add debt to customer and write ledger entry
      if (finalRemaining > 0) {
        const remainingPaise = toPaise(finalRemaining);
        execRun(`UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`, [
          remainingPaise,
          Number(customer_id),
        ]);

        const updatedCustomer = customerModel.findById(customer_id);
        const newBalancePaise = toPaise(updatedCustomer.credit_balance);

        execRun(
          `INSERT INTO credit_transactions (
            customer_id, transaction_id, transaction_type, amount, payment_mode, note, balance_after_transaction
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            Number(customer_id),
            id,
            'CREDIT_ADDED',
            remainingPaise,
            payment_type === 'Credit' ? 'Credit' : payment_mode,
            `Edited sale: ${numWeight} ${unit} ${vegName} @ ₹${numRate}`,
            newBalancePaise,
          ]
        );
      }

      return result;
    });

    logger.info(`Transaction ${id} updated successfully`);
    return { success: true, data: updated };
  } catch (err) {
    logger.error(`Failed to update transaction ${id}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Customers with entries still waiting to be billed, oldest first.
 *
 * Read-only aggregate — nothing here decides anything, it only tells the vendor where
 * the unbilled work is so the range bill is reachable without guessing dates.
 */
async function getPendingSettlements() {
  try {
    return { success: true, data: transactionModel.findPendingSettlements() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  createTransaction,
  updateTransaction,
  generateBillFromTransactions,
  generateStatement,
  autoBillPastTransactions,
  getTransactionById,
  getCustomerTransactions,
  getCustomerDailyPurchase,
  getAllTransactions,
  getPendingSettlements,
  deleteTransaction,
  getLocalDateString
};
