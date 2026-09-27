/**
 * Customer Service
 * Business logic layer for customer management.
 * Validates inputs and coordinates with the model.
 * Controllers call services — never the model directly.
 */

const customerModel = require('../models/customerModel');
const creditModel = require('../models/creditModel');
const { transaction } = require('../database/db');

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates customer input fields.
 * @param {{ name, mobile }} data
 * @param {number|null} excludeId - skip this ID for mobile uniqueness check (edit case)
 * @throws {Error} with statusCode 400 if validation fails
 */
function validate({ name, mobile, commission_rate }, excludeId = null) {
  const errors = [];

  if (!name || !name.trim()) {
    errors.push('Customer name is required.');
  }

  if (mobile && String(mobile).trim()) {
    const cleanMobile = String(mobile).trim();
    if (!/^\d{10}$/.test(cleanMobile)) {
      errors.push('Mobile number must be exactly 10 digits.');
    } else {
      const existing = customerModel.findByMobile(cleanMobile, excludeId);
      if (existing) {
        errors.push(`Mobile number ${cleanMobile} is already registered.`);
      }
    }
  }

  if (commission_rate !== undefined && commission_rate !== null && String(commission_rate).trim() !== '') {
    const rateNum = Number(commission_rate);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
      errors.push('Commission rate must be a percentage between 0 and 100.');
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(' '));
    err.statusCode = 400;
    err.errors = errors;
    throw err;
  }
}

// ─── Service Methods ──────────────────────────────────────────────────────────

/**
 * Get all customers.
 * @returns {Array}
 */
function getAllCustomers() {
  return customerModel.findAll();
}

/**
 * Get a single customer by ID.
 * @param {number} id
 * @returns {Object}
 * @throws {Error} 404 if not found
 */
function getCustomerById(id) {
  const customer = customerModel.findById(id);
  if (!customer) {
    const err = new Error(`Customer with ID ${id} not found.`);
    err.statusCode = 404;
    throw err;
  }
  return customer;
}

/**
 * Search customers by name or mobile.
 * @param {string} query
 * @returns {Array}
 */
function searchCustomers(query) {
  if (!query || !query.trim()) return customerModel.findAll();
  return customerModel.search(query.trim());
}

/**
 * Create a new customer, optionally carrying forward what they already owe.
 *
 * `opening_balance` is for the notebook migration: a vendor entering a customer who
 * is already in debt. It writes an OPENING_BALANCE ledger row rather than a bill, so
 * the debt shows in the passbook and the outstanding total without inventing sales
 * revenue or commission that never happened.
 *
 * Customer and opening balance are written in one transaction. Separately, a failure
 * between them would leave a customer whose balance the vendor believes was entered
 * and was not — and the vendor's only record of the real figure is the notebook they
 * are working from.
 *
 * @param {{ name, mobile, address, notes, opening_balance?, opening_balance_date? }} data
 * @returns {Object} Created customer
 */
function createCustomer(data) {
  validate(data);

  const raw = data.opening_balance;
  const hasOpening = raw !== undefined && raw !== null && String(raw).trim() !== '';
  let opening = 0;

  if (hasOpening) {
    opening = Number(raw);
    if (!Number.isFinite(opening) || opening < 0) {
      const err = new Error('Opening balance must be a number of 0 or more.');
      err.statusCode = 400;
      throw err;
    }
    opening = Number(opening.toFixed(2));
  }

  if (opening <= 0) {
    return customerModel.create(data);
  }

  return transaction(() => {
    const created = customerModel.create(data);

    // customerModel.create reactivates a soft-deleted record rather than inserting a
    // duplicate, so "add customer" can land on a customer who was opened once
    // already. A second OPENING_BALANCE row would double the migrated debt with no
    // way to tell which figure was real, so refuse and roll the whole thing back —
    // nothing is half-applied, and the vendor is told to use an adjustment instead.
    if (creditModel.hasOpeningBalance(created.id)) {
      const err = new Error(
        'This customer already has an opening balance on record. Use a credit adjustment to change what they owe.'
      );
      err.statusCode = 400;
      throw err;
    }

    creditModel.recordOpeningBalance({
      customer_id: created.id,
      amount: opening,
      date: data.opening_balance_date,
      note: 'Opening balance (brought forward)',
    });
    // Re-read so the caller sees the balance the ledger just set, not the zero the
    // insert returned.
    return customerModel.findById(created.id);
  });
}

/**
 * Update an existing customer.
 * @param {number} id
 * @param {{ name, mobile, address, notes }} data
 * @returns {Object} Updated customer
 */
function updateCustomer(id, data) {
  // Ensure customer exists first
  getCustomerById(id);
  // Validate, excluding current customer's mobile from duplicate check
  validate(data, id);

  const raw = data.opening_balance;
  const hasOpening = raw !== undefined && raw !== null && String(raw).trim() !== '';
  let opening = null;

  if (hasOpening) {
    opening = Number(raw);
    if (!Number.isFinite(opening) || opening < 0) {
      const err = new Error('Opening balance must be a number of 0 or more.');
      err.statusCode = 400;
      throw err;
    }
    opening = Number(opening.toFixed(2));
  }

  return transaction(() => {
    customerModel.update(id, data);

    if (opening !== null || data.opening_balance_date) {
      creditModel.updateOpeningBalance({
        customer_id: id,
        amount: opening !== null ? opening : 0,
        date: data.opening_balance_date,
      });
    }

    return customerModel.findById(id);
  });
}

/**
 * Delete a customer.
 * @param {number} id
 * @returns {boolean}
 */
function deleteCustomer(id) {
  const customer = getCustomerById(id); // throws 404 if not found
  if (Number(customer.credit_balance || 0) > 0) {
    const err = new Error('Cannot delete customer with pending credit balance.');
    err.statusCode = 400;
    throw err;
  }
  return customerModel.remove(id);
}

/**
 * Get the full ledger for a customer.
 * @param {number} id
 * @returns {Object|null}
 */
function getCustomerLedger(id) {
  return customerModel.getLedger(id);
}

/**
 * Bulk import multiple customers.
 * @param {Array<Object>} items
 * @param {Object} options
 */
function bulkImportCustomers(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('No customer records provided for import.');
    err.statusCode = 400;
    throw err;
  }
  const { updateExisting = true } = options;
  return customerModel.bulkUpsert(items, { updateExisting });
}

/**
 * Deduplicate customer records across the entire database.
 * @returns {{ mergedGroups: number, duplicatesRemoved: number }}
 */
function deduplicateCustomers() {
  return customerModel.deduplicate();
}

module.exports = {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerLedger,
  bulkImportCustomers,
  deduplicateCustomers,
};



