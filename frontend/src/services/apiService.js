/**
 * API Service
 * Centralized Axios client for all backend API calls.
 * All HTTP requests in the app should go through this file.
 */

import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import {
  offlineCustomerRepo,
  offlineVegetableRepo,
  offlineTransactionRepo,
  offlineBillRepo,
  offlineCreditRepo,
  offlineReportRepo,
  offlineSettingsRepo,
} from '../db/offlineRepository';

export const isStandaloneMobile = () => {
  if (typeof window === 'undefined') return false;

  // 0. URL parameter for browser-based mobile testing
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mobile') === 'true' || params.get('standalone') === 'true') {
      return true;
    }
  } catch (_) {}

  // 1. Explicit user override
  const explicitMode = localStorage.getItem('vyaparsetu_offline_mode');
  if (explicitMode !== null) return explicitMode === 'true';

  // 2. Capacitor native container (Android APK / iOS)
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    const customUrl = localStorage.getItem('vyaparsetu_api_url');
    return !customUrl;
  }

  // 3. Mobile device or tablet operating without desktop local backend
  const isTouchDevice = Boolean(
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  );
  const isSmallScreen = window.innerWidth < 768;
  const isServedByLocalBackend = window.location.port === '5001' || window.location.port === '5000';

  return (isTouchDevice || isSmallScreen) && !isServedByLocalBackend;
};

// Dynamically resolve API base URL for Desktop, Mobile LAN, and Capacitor
function getBaseUrl() {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('vyaparsetu_api_url');
    if (customUrl) return customUrl;
    // When served by backend in Electron or browser (origin has port like 5001, 5000, 47821, etc.)
    if (window.location.protocol.startsWith('http') && window.location.port !== '5173') {
      return window.location.origin;
    }
    // If accessed over LAN or mobile IP from a mobile device (not localhost/127.0.0.1)
    if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return `${window.location.protocol}//${window.location.hostname}:5000`;
    }
  }
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';
}

const BASE_URL = getBaseUrl();

// Axios instance with defaults
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Response Interceptor ─────────────────────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message =
      error.response?.data?.error?.message ||
      error.message ||
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

// Adaptive execution wrapper: tries network, falls back to offline repo if network error or standalone
async function executeAdaptive(networkCall, offlineFallback) {
  if (isStandaloneMobile()) {
    return offlineFallback();
  }
  try {
    return await networkCall();
  } catch (err) {
    // If network unreachable, gracefully fallback to local offline repository
    if (!err.response || err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch')) {
      console.info('Backend unreachable, using local offline repository');
      return offlineFallback();
    }
    throw err;
  }
}

// ─── Health API ───────────────────────────────────────────────────────────────
export const healthApi = {
  /**
   * GET /api/health
   * @returns {Promise<{ success: boolean, data: object }>}
   */
  getStatus: () => apiClient.get('/api/health'),
};

// ─── License API ──────────────────────────────────────────────────────────────
export const licenseApi = {
  /**
   * GET /api/license/status
   * @returns {Promise<{ success: boolean, data: { activated: boolean, machineId: string, customerName?: string, expiry?: string|null } }>}
   */
  getStatus: () => apiClient.get('/api/license/status'),

  /**
   * POST /api/license/activate
   * @param {string} licenseKey
   */
  activate: (licenseKey) => apiClient.post('/api/license/activate', { licenseKey }),
};

// ─── Customers API ────────────────────────────────────────────────────────────
export const customersApi = {
  getAll: () => executeAdaptive(() => apiClient.get('/api/customers'), () => offlineCustomerRepo.getAll()),
  getById: (id) => executeAdaptive(() => apiClient.get(`/api/customers/${id}`), () => offlineCustomerRepo.getById(id)),
  search: (q) => executeAdaptive(() => apiClient.get('/api/customers/search', { params: { q } }), () => offlineCustomerRepo.search(q)),
  getLedger: (id) => executeAdaptive(() => apiClient.get(`/api/customers/${id}/ledger`), () => offlineCustomerRepo.getLedger(id)),
  create: (data) => executeAdaptive(() => apiClient.post('/api/customers', data), () => offlineCustomerRepo.create(data)),
  update: (id, data) => executeAdaptive(() => apiClient.put(`/api/customers/${id}`, data), () => offlineCustomerRepo.update(id, data)),
  remove: (id) => executeAdaptive(() => apiClient.delete(`/api/customers/${id}`), () => offlineCustomerRepo.remove(id)),
  bulkImport: (data) => executeAdaptive(() => apiClient.post('/api/customers/bulk', data), () => offlineCustomerRepo.bulkImport(data)),
  deduplicate: () => executeAdaptive(() => apiClient.post('/api/customers/deduplicate'), () => offlineCustomerRepo.deduplicate()),
};

// ─── Vegetables API ───────────────────────────────────────────────────────────
export const vegetablesApi = {
  getAll: () => executeAdaptive(() => apiClient.get('/api/vegetables'), () => offlineVegetableRepo.getAll()),
  getById: (id) => executeAdaptive(() => apiClient.get(`/api/vegetables/${id}`), () => offlineVegetableRepo.getById(id)),
  search: (q) => executeAdaptive(() => apiClient.get('/api/vegetables/search', { params: { q } }), () => offlineVegetableRepo.search(q)),
  create: (data) => executeAdaptive(() => apiClient.post('/api/vegetables', data), () => offlineVegetableRepo.create(data)),
  update: (id, data) => executeAdaptive(() => apiClient.put(`/api/vegetables/${id}`, data), () => offlineVegetableRepo.update(id, data)),
  remove: (id) => executeAdaptive(() => apiClient.delete(`/api/vegetables/${id}`), () => offlineVegetableRepo.remove(id)),
  bulkImport: (data) => executeAdaptive(() => apiClient.post('/api/vegetables/bulk', data), () => offlineVegetableRepo.bulkImport(data)),
};

// ─── Bills API ───────────────────────────────────────────────────────────────
export const billsApi = {
  getAll: (params) => executeAdaptive(() => apiClient.get('/api/bills', { params }), () => offlineBillRepo.getAll(params)),
  getById: (id) => executeAdaptive(() => apiClient.get(`/api/bills/${id}`), () => offlineBillRepo.getById(id)),
  search: (q) => executeAdaptive(() => apiClient.get('/api/bills/search', { params: { q } }), () => offlineBillRepo.getAll()),
  create: (data) => executeAdaptive(() => apiClient.post('/api/bills', data), () => offlineBillRepo.generateBillFromTransactions(data)),
  update: (id, data) => executeAdaptive(() => apiClient.put(`/api/bills/${id}`, data), () => offlineBillRepo.update(id, data)),
  remove: (id) => executeAdaptive(() => apiClient.delete(`/api/bills/${id}`), () => offlineBillRepo.remove(id)),
};

// ─── Credit API ──────────────────────────────────────────────────────────────
export const creditApi = {
  getSummary: () => executeAdaptive(() => apiClient.get('/api/credit/summary'), () => offlineCreditRepo.getSummary()),
  getCustomers: () => executeAdaptive(() => apiClient.get('/api/credit/customers'), () => offlineCustomerRepo.getAll()),
  getCustomerById: (customerId) => executeAdaptive(() => apiClient.get(`/api/credit/customer/${customerId}`), () => offlineCustomerRepo.getById(customerId)),
  getTransactions: (customerId) => executeAdaptive(() => apiClient.get(`/api/credit/customer/${customerId}/transactions`), () => offlineCreditRepo.getCustomerTransactions(customerId)),
  getAllTransactions: () => executeAdaptive(() => apiClient.get('/api/credit/all-transactions'), () => offlineCreditRepo.getAll()),
  collectPayment: (data) => executeAdaptive(() => apiClient.post('/api/credit/payment', data), () => offlineCreditRepo.recordPayment(data)),
  undoPayment: (id) => executeAdaptive(() => apiClient.delete(`/api/credit/payment/${id}`), () => offlineCreditRepo.undoPayment(id)),
  recordDiscount: (data) => executeAdaptive(() => apiClient.post('/api/credit/discount', data), () => offlineCreditRepo.giveDiscount(data)),
  adjustCredit: (data) => executeAdaptive(() => apiClient.post('/api/credit/adjustment', data), () => offlineCreditRepo.recordPayment(data)),
  recordOpeningBalance: (data) => executeAdaptive(() => apiClient.post('/api/credit/opening-balance', data), () => offlineCreditRepo.recordPayment(data)),
};

// ─── Reports API ─────────────────────────────────────────────────────────────
export const reportsApi = {
  getDailySales: (date) => executeAdaptive(() => apiClient.get('/api/reports/daily', { params: { date } }), () => offlineReportRepo.getDailySales(date)),
  getRangeSales: (startDate, endDate) => executeAdaptive(() => apiClient.get('/api/reports/sales-range', { params: { startDate, endDate } }), () => offlineReportRepo.getRangeSales(startDate, endDate)),
  getCustomers: (startDate, endDate) => executeAdaptive(() => apiClient.get('/api/reports/customers', { params: { startDate, endDate } }), () => offlineCustomerRepo.getAll()),
  getVegetables: (startDate, endDate) => executeAdaptive(() => apiClient.get('/api/reports/vegetables', { params: { startDate, endDate } }), () => offlineVegetableRepo.getAll()),
  getCredit: (date) => executeAdaptive(() => apiClient.get('/api/reports/credit', { params: { date } }), () => offlineCreditRepo.getSummary()),
  getCommission: (startDate, endDate) => executeAdaptive(() => apiClient.get('/api/reports/commission', { params: { startDate, endDate } }), () => offlineReportRepo.getRangeSales(startDate, endDate)),
  getAllInOne: (startDate, endDate) => executeAdaptive(() => apiClient.get('/api/reports/all-in-one', { params: { startDate, endDate } }), () => offlineReportRepo.getAllInOne(startDate, endDate)),
};

// ─── Backup API ──────────────────────────────────────────────────────────────
export const backupApi = {
  createLocalBackup: () => apiClient.post('/api/backup/local'),
  listBackups: () => apiClient.get('/api/backup/list'),
  restoreBackup: (filename) => apiClient.post('/api/backup/restore', { filename }),
  getLastBackupStatus: () => apiClient.get('/api/backup/status'),
  getInternetStatus: () => apiClient.get('/api/backup/internet-status'),
  getConfig: () => apiClient.get('/api/backup/config'),
  saveConfig: (data) => apiClient.post('/api/backup/config', data),
  performAutoSync: () => apiClient.post('/api/backup/auto-sync'),
  exportBackupUrl: () => `${BASE_URL}/api/backup/export`,
  downloadBackupUrl: (filename) => `${BASE_URL}/api/backup/download/${encodeURIComponent(filename)}`,
  importBackup: (fileData, filename) => apiClient.post('/api/backup/import', { fileData, filename }),
};

// ─── Dashboard API ───────────────────────────────────────────────────────────
export const dashboardApi = {
  getSummary: () => executeAdaptive(() => apiClient.get('/api/dashboard/summary'), () => offlineReportRepo.getSummary()),
};

// ─── Settings API ────────────────────────────────────────────────────────────
export const settingsApi = {
  getAll: () => executeAdaptive(() => apiClient.get('/api/settings'), () => offlineSettingsRepo.getAll()),
  getByKey: (key) => executeAdaptive(() => apiClient.get(`/api/settings/${key}`), async () => {
    const all = await offlineSettingsRepo.getAll();
    return { success: true, data: { value: all.data[key] } };
  }),
  updateByKey: (key, value) => executeAdaptive(() => apiClient.put(`/api/settings/${key}`, { value }), () => offlineSettingsRepo.update({ [key]: value })),
  updateBulk: (settings) => executeAdaptive(() => apiClient.put('/api/settings/bulk', settings), () => offlineSettingsRepo.update(settings)),
};

// ─── Google Drive API ────────────────────────────────────────────────────────
export const driveApi = {
  getAuthUrl: () => apiClient.get('/api/drive/auth-url'),
  getStatus: () => apiClient.get('/api/drive/status'),
  backup: (force = true) => apiClient.post('/api/drive/backup', { force }),
  autoBackup: (force = false) => apiClient.post('/api/drive/auto-backup', { force }),
  listBackups: () => apiClient.get('/api/drive/backups'),
  restore: (fileId) => apiClient.post('/api/drive/restore', { fileId }),
  disconnect: () => apiClient.post('/api/drive/disconnect'),
};

// ─── Transaction API ────────────────────────────────────────────────────────
export const transactionApi = {
  create: (data) => executeAdaptive(() => apiClient.post('/api/transactions', data), () => offlineTransactionRepo.create(data)),
  generateBill: (data) => executeAdaptive(() => apiClient.post('/api/transactions/generate-bill', data), () => offlineBillRepo.generateBillFromTransactions(data)),
  generateStatement: (data) => executeAdaptive(() => apiClient.post('/api/transactions/generate-statement', data), () => offlineBillRepo.generateBillFromTransactions(data)),
  getAll: (params) => executeAdaptive(() => apiClient.get('/api/transactions', { params }), () => offlineTransactionRepo.getAll(params)),
  getPendingSettlements: () => executeAdaptive(() => apiClient.get('/api/transactions/pending-settlements'), () => offlineTransactionRepo.getPendingSettlements()),
  getById: (id) => executeAdaptive(() => apiClient.get(`/api/transactions/${id}`), async () => {
    const all = await offlineTransactionRepo.getAll();
    const item = all.data.find(t => t.id === Number(id));
    return { success: true, data: item };
  }),
  getByCustomer: (customerId, params) => executeAdaptive(() => apiClient.get(`/api/transactions/customer/${customerId}`, { params }), () => offlineTransactionRepo.getAll({ customer_id: customerId })),
  getCustomerDaily: (customerId, date) => executeAdaptive(() => apiClient.get(`/api/transactions/customer/${customerId}/daily`, { params: { date } }), () => offlineTransactionRepo.getCustomerDailyPurchase(customerId, date)),
  getCustomerRange: (customerId, startDate, endDate) => executeAdaptive(() => apiClient.get(`/api/transactions/customer/${customerId}/range`, { params: { startDate, endDate } }), () => offlineTransactionRepo.getCustomerRange(customerId, startDate, endDate)),
  update: (id, data) => executeAdaptive(() => apiClient.put(`/api/transactions/${id}`, data), () => offlineTransactionRepo.update(id, data)),
  remove: (id) => executeAdaptive(() => apiClient.delete(`/api/transactions/${id}`), () => offlineTransactionRepo.remove(id)),
};

export default apiClient;


