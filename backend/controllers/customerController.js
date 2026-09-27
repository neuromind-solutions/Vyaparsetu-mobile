/**
 * Customer Controller
 * Thin HTTP layer — parses request, calls service, returns JSON response.
 * No business logic or SQL here.
 */

const customerService = require('../services/customerService');

/**
 * GET /api/customers
 */
function getAll(req, res, next) {
  try {
    const customers = customerService.getAllCustomers();
    res.json({ success: true, data: customers, count: customers.length });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customers/search?q=
 * NOTE: This route must be mounted BEFORE /:id to avoid "search" being treated as an id.
 */
function searchCustomers(req, res, next) {
  try {
    const { q = '' } = req.query;
    const customers = customerService.searchCustomers(q);
    res.json({ success: true, data: customers, count: customers.length });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customers/:id
 */
function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
    }
    const customer = customerService.getCustomerById(id);
    res.json({ success: true, data: customer });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customers
 */
function create(req, res, next) {
  try {
    const { name, mobile, address, search_keywords, notes, opening_balance, opening_balance_date, commission_rate } = req.body;
    const customer = customerService.createCustomer({ name, mobile, address, search_keywords, notes, opening_balance, opening_balance_date, commission_rate });
    res.status(201).json({ success: true, data: customer, message: 'Customer created successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/customers/:id
 */
function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
    }
    const { name, mobile, address, search_keywords, notes, opening_balance, opening_balance_date, commission_rate } = req.body;
    const customer = customerService.updateCustomer(id, {
      name,
      mobile,
      address,
      search_keywords,
      notes,
      opening_balance,
      opening_balance_date,
      commission_rate,
    });
    res.json({ success: true, data: customer, message: 'Customer updated successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/customers/:id
 */
function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
    }
    customerService.deleteCustomer(id);
    res.json({ success: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customers/:id/ledger
 */
function getLedger(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
    }
    const ledger = customerService.getCustomerLedger(id);
    if (!ledger) return res.status(404).json({ success: false, message: 'Customer not found.' });
    res.json({ success: true, data: ledger });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customers/bulk
 */
function bulkImport(req, res, next) {
  try {
    const { items, updateExisting = true } = req.body;
    const result = customerService.bulkImportCustomers(items, { updateExisting });
    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully processed ${result.total} customers (${result.created} created, ${result.updated} updated, ${result.skipped} skipped).`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customers/deduplicate
 */
function deduplicate(req, res, next) {
  try {
    const result = customerService.deduplicateCustomers();
    res.status(200).json({
      success: true,
      data: result,
      message: `Cleaned up ${result.duplicatesRemoved} duplicate customer(s) across ${result.mergedGroups} group(s).`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getById, searchCustomers, create, update, remove, getLedger, bulkImport, deduplicate };




