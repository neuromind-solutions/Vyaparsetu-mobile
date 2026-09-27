// backend/services/creditService.js
const creditModel = require('../models/creditModel');
const customerModel = require('../models/customerModel');

async function getSummary() {
  try {
    const summary = creditModel.getSummary();
    return { success: true, data: summary };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomersWithBalance() {
  try {
    const list = creditModel.getCustomersWithBalance();
    return { success: true, data: list };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomerDetails(customerId) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };
    return { success: true, data: customer };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomerTransactions(customerId) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };
    const history = creditModel.getCustomerTransactions(customerId);
    return { success: true, data: history };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function collectPayment({ customer_id, amount, payment_mode, note, date, created_at }) {
  if (!customer_id) return { success: false, error: 'Customer required' };
  
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return { success: false, error: 'Payment amount must be greater than 0' };
  }

  if (!payment_mode) return { success: false, error: 'Payment mode required' };
  if (!['Cash', 'UPI', 'Other'].includes(payment_mode)) {
    return { success: false, error: 'Payment mode must be Cash, UPI, or Other' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    // Compare with 2-decimal rounded precision to prevent float rounding mismatch
    const pending = Number(Number(cust.credit_balance).toFixed(2));
    const paid = Number(amt.toFixed(2));

    if (paid > pending) {
      return { success: false, error: `Payment amount (₹${paid}) cannot exceed customer's outstanding balance (₹${pending})` };
    }

    const result = creditModel.recordPayment({
      customer_id,
      amount: paid,
      payment_mode,
      note: note ? note.trim() : `Payment collected via ${payment_mode}`,
      date,
      created_at
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function adjustCredit({ customer_id, amount, note }) {
  if (!customer_id) return { success: false, error: 'Customer required' };

  const amt = Number(amount);
  if (isNaN(amt) || amt === 0) {
    return { success: false, error: 'Adjustment amount cannot be zero' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    const pending = Number(Number(cust.credit_balance).toFixed(2));
    const change = Number(amt.toFixed(2));

    if (pending + change < 0) {
      return { success: false, error: `Negative adjustment cannot exceed customer's credit balance (current: ₹${pending})` };
    }

    const result = creditModel.recordAdjustment({
      customer_id,
      amount: change,
      note: note ? note.trim() : 'Manual credit balance adjustment'
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Records what a customer already owed before they existed in this app.
 *
 * Vendors migrate from a paper notebook, so most customers arrive mid-debt. The only
 * way to represent that until now was to invent a bill, which put revenue that never
 * happened into the sales and commission reports. This writes the balance straight to
 * the ledger instead: one OPENING_BALANCE row and no bill.
 *
 * A customer can only be opened once. Other ledger rows are fine — a vendor who
 * enters a sale before remembering the notebook figure is not blocked — but a second
 * opening balance would silently double the migrated debt, and the vendor would have
 * no way to tell which of the two was the real one. Correcting a wrong opening
 * balance goes through adjustCredit, which is what that path is for.
 */
async function recordOpeningBalance({ customer_id, amount, note }) {
  if (!customer_id) return { success: false, error: 'Customer required' };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { success: false, error: 'Opening balance must be greater than 0' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    if (creditModel.hasOpeningBalance(customer_id)) {
      return {
        success: false,
        error: 'This customer already has an opening balance. Use a credit adjustment to correct it.',
      };
    }

    const result = creditModel.recordOpeningBalance({
      customer_id,
      amount: Number(amt.toFixed(2)),
      note: note && note.trim() ? note.trim() : 'Opening balance (brought forward)',
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function recordDiscount({ customer_id, amount, note }) {
  if (!customer_id) return { success: false, error: 'Customer required' };

  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return { success: false, error: 'Discount amount must be greater than 0' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    const pending = Number(Number(cust.credit_balance).toFixed(2));
    const discountAmt = Number(amt.toFixed(2));

    if (discountAmt > pending) {
      return { success: false, error: `Discount amount (₹${discountAmt}) cannot exceed customer's outstanding balance (₹${pending})` };
    }

    const result = creditModel.recordDiscount({
      customer_id,
      amount: discountAmt,
      note: note ? note.trim() : 'Discount / सूट'
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function undoPayment(transactionId) {
  if (!transactionId) return { success: false, error: 'Transaction ID required' };

  try {
    const result = creditModel.undoPayment(transactionId);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getAllCreditTransactions() {
  try {
    const list = creditModel.getAllTransactions();
    return { success: true, data: list };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  getSummary,
  getCustomersWithBalance,
  getCustomerDetails,
  getCustomerTransactions,
  getAllCreditTransactions,
  collectPayment,
  recordDiscount,
  undoPayment,
  adjustCredit,
  recordOpeningBalance
};
