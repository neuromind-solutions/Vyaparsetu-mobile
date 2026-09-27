// backend/services/reportService.js
const reportModel = require('../models/reportModel');

/** Helper to validate YYYY-MM-DD formatting and validity */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  if (!match) return false;
  const timestamp = Date.parse(dateStr);
  return !isNaN(timestamp);
}

/** Validate date range fields */
function validateRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Start date and End date are required';
  if (!isValidDate(startDate)) return 'Invalid Start date format (use YYYY-MM-DD)';
  if (!isValidDate(endDate)) return 'Invalid End date format (use YYYY-MM-DD)';
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) return 'Start date cannot be greater than End date';
  
  return null; // validation passed
}

async function getDailySalesReport(dateVal) {
  if (!dateVal) return { success: false, error: 'Date is required' };
  if (!isValidDate(dateVal)) return { success: false, error: 'Invalid date format (use YYYY-MM-DD)' };
  
  try {
    const report = reportModel.getSalesSummary(dateVal, dateVal);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getRangeSalesReport(startDate, endDate) {
  const err = validateRange(startDate, endDate);
  if (err) return { success: false, error: err };

  try {
    const report = reportModel.getSalesSummary(startDate, endDate);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomersReport(startDate, endDate) {
  const err = validateRange(startDate, endDate);
  if (err) return { success: false, error: err };

  try {
    const report = reportModel.getCustomerPurchaseSummary(startDate, endDate);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getVegetablesReport(startDate, endDate) {
  const err = validateRange(startDate, endDate);
  if (err) return { success: false, error: err };

  try {
    const report = reportModel.getVegetableSalesSummary(startDate, endDate);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCreditReport(dateVal) {
  if (!dateVal) return { success: false, error: 'Date is required' };
  if (!isValidDate(dateVal)) return { success: false, error: 'Invalid date format (use YYYY-MM-DD)' };

  try {
    const report = reportModel.getCreditSummary(dateVal);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCommissionReport(startDate, endDate) {
  const err = validateRange(startDate, endDate);
  if (err) return { success: false, error: err };

  try {
    const report = reportModel.getCommissionSummary(startDate, endDate);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getAllInOneReport(startDate, endDate) {
  if (startDate || endDate) {
    const err = validateRange(startDate, endDate);
    if (err) return { success: false, error: err };
  }

  try {
    const report = reportModel.getAllInOneReport(startDate, endDate);
    return { success: true, data: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  getDailySalesReport,
  getRangeSalesReport,
  getCustomersReport,
  getVegetablesReport,
  getCreditReport,
  getCommissionReport,
  getAllInOneReport,
};
