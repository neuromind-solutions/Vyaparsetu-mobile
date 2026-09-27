// backend/controllers/reportController.js
const reportService = require('../services/reportService');

async function getDailySales(req, res) {
  const { date } = req.query;
  const result = await reportService.getDailySalesReport(date);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getRangeSales(req, res) {
  const { startDate, endDate } = req.query;
  const result = await reportService.getRangeSalesReport(startDate, endDate);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getCustomers(req, res) {
  const { startDate, endDate } = req.query;
  const result = await reportService.getCustomersReport(startDate, endDate);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getVegetables(req, res) {
  const { startDate, endDate } = req.query;
  const result = await reportService.getVegetablesReport(startDate, endDate);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getCredit(req, res) {
  const { date } = req.query;
  const result = await reportService.getCreditReport(date);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getCommission(req, res) {
  const { startDate, endDate } = req.query;
  const result = await reportService.getCommissionReport(startDate, endDate);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

async function getAllInOne(req, res) {
  const { startDate, endDate } = req.query;
  const result = await reportService.getAllInOneReport(startDate, endDate);
  if (result.success) return res.json({ success: true, data: result.data });
  res.status(400).json({ success: false, error: result.error });
}

module.exports = {
  getDailySales,
  getRangeSales,
  getCustomers,
  getVegetables,
  getCredit,
  getCommission,
  getAllInOne,
};
