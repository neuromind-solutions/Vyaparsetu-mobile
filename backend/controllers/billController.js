// backend/controllers/billController.js
/**
 * Bill Controller – HTTP handlers for billing module.
 */
const billService = require('../services/billService');

// List all bills (optional query param q for search)
async function getAllBills(req, res) {
  const { q } = req.query;
  if (q) {
    const result = await billService.searchBills(q);
    if (result.success) return res.json({ success: true, data: result.data });
    return res.status(500).json({ success: false, error: result.error });
  }
  const result = await billService.getAllBills();
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

async function getBillById(req, res) {
  const { id } = req.params;
  const result = await billService.getBillById(id);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(404).json({ success: false, error: result.error });
}

async function createBill(req, res) {
  const payload = req.body;
  const result = await billService.createNewBill(payload);
  if (result.success) return res.status(201).json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function updateBill(req, res) {
  const { id } = req.params;
  const payload = req.body;
  const result = await billService.updateExistingBill(id, payload);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function deleteBill(req, res) {
  const { id } = req.params;
  const result = await billService.deleteBillById(id);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(404).json({ success: false, error: result.error });
}

// Dedicated search endpoint (GET /search?q=...)
async function searchBills(req, res) {
  const { q } = req.query;
  const result = await billService.searchBills(q);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

async function getBillsByCustomer(req, res) {
  const { customerId } = req.params;
  const result = await billService.getBillsByCustomerId(customerId);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(500).json({ success: false, error: result.error });
}

module.exports = {
  getAllBills,
  getBillById,
  createBill,
  updateBill,
  deleteBill,
  searchBills,
  getBillsByCustomer,
};
