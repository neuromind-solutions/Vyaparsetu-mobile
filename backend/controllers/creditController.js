// backend/controllers/creditController.js
const creditService = require('../services/creditService');

async function getSummary(req, res) {
  const result = await creditService.getSummary();
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

async function getCustomers(req, res) {
  const result = await creditService.getCustomersWithBalance();
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

async function getCustomerById(req, res) {
  const { customerId } = req.params;
  const result = await creditService.getCustomerDetails(customerId);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(404).json({ success: false, error: result.error });
}

async function getTransactions(req, res) {
  const { customerId } = req.params;
  const result = await creditService.getCustomerTransactions(customerId);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

async function collectPayment(req, res) {
  const payload = req.body;
  const result = await creditService.collectPayment(payload);
  if (result.success) return res.status(201).json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function adjustCredit(req, res) {
  const payload = req.body;
  const result = await creditService.adjustCredit(payload);
  if (result.success) return res.status(201).json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function recordOpeningBalance(req, res) {
  const payload = req.body;
  const result = await creditService.recordOpeningBalance(payload);
  if (result.success) return res.status(201).json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function recordDiscount(req, res) {
  const payload = req.body;
  const result = await creditService.recordDiscount(payload);
  if (result.success) return res.status(201).json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function undoPayment(req, res) {
  const { id } = req.params;
  const result = await creditService.undoPayment(id);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getAllCreditTransactions(req, res) {
  const result = await creditService.getAllCreditTransactions();
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

module.exports = {
  getSummary,
  getCustomers,
  getCustomerById,
  getTransactions,
  getAllCreditTransactions,
  collectPayment,
  recordDiscount,
  undoPayment,
  adjustCredit,
  recordOpeningBalance
};
