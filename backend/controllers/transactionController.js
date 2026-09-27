/**
 * Transaction Controller
 * Controller handlers for customer vegetable transaction API endpoints.
 */

const transactionService = require('../services/transactionService');

async function createTransaction(req, res) {
  const result = await transactionService.createTransaction(req.body);
  if (result.success) {
    return res.status(201).json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function generateBill(req, res) {
  const result = await transactionService.generateBillFromTransactions(req.body);
  if (result.success) {
    return res.status(201).json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function generateStatement(req, res) {
  const result = await transactionService.generateStatement(req.body);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function getAllTransactions(req, res) {
  const result = await transactionService.getAllTransactions(req.query);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(500).json({ success: false, error: result.error });
}

async function getPendingSettlements(req, res) {
  const result = await transactionService.getPendingSettlements();
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(500).json({ success: false, error: result.error });
}

async function getTransactionById(req, res) {
  const { id } = req.params;
  const result = await transactionService.getTransactionById(id);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(404).json({ success: false, error: result.error });
}

async function getCustomerTransactions(req, res) {
  const { customerId } = req.params;
  const result = await transactionService.getCustomerTransactions(customerId, req.query);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function getCustomerDailyPurchase(req, res) {
  const { customerId } = req.params;
  const date = req.query.date;
  const result = await transactionService.getCustomerDailyPurchase(customerId, date);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function getCustomerRangeTransactions(req, res) {
  const { customerId } = req.params;
  const { startDate, endDate } = req.query;
  const result = await transactionService.getCustomerTransactions(customerId, { startDate, endDate });
  if (result.success) {
    return res.json({ success: true, data: result.data });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function updateTransaction(req, res) {
  const { id } = req.params;
  const result = await transactionService.updateTransaction(id, req.body);
  if (result.success) {
    return res.json({ success: true, data: result.data, message: 'Transaction updated successfully.' });
  }
  return res.status(400).json({ success: false, error: result.error });
}

async function deleteTransaction(req, res) {
  const { id } = req.params;
  const result = await transactionService.deleteTransaction(id);
  if (result.success) {
    return res.json({ success: true, message: result.message });
  }
  return res.status(400).json({ success: false, error: result.error });
}

module.exports = {
  createTransaction,
  updateTransaction,
  generateBill,
  generateStatement,
  getAllTransactions,
  getPendingSettlements,
  getTransactionById,
  getCustomerTransactions,
  getCustomerDailyPurchase,
  getCustomerRangeTransactions,
  deleteTransaction
};
