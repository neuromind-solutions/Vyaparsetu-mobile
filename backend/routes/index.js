/**
 * Root API Router
 * Mounts all feature routers under /api.
 * Add new module routes here as modules are developed.
 */

const express = require('express');
const healthRoutes    = require('./healthRoutes');
const customerRoutes  = require('./customerRoutes');
const vegetableRoutes = require('./vegetableRoutes');
const billRoutes      = require('./billRoutes');
const creditRoutes    = require('./creditRoutes');
const reportRoutes    = require('./reportRoutes');
const backupRoutes    = require('./backupRoutes');
const settingsRoutes  = require('./settingsRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const googleDriveRoutes = require('./googleDriveRoutes');
const transactionRoutes = require('./transactionRoutes');
const clientLogRoutes = require('./clientLogRoutes');

const router = express.Router();

// ─── Feature Routes ───────────────────────────────────────────────────────────
router.use('/health',       healthRoutes);
router.use('/customers',    customerRoutes);
router.use('/vegetables',   vegetableRoutes);
router.use('/bills',        billRoutes);
router.use('/credit',       creditRoutes);
router.use('/reports',      reportRoutes);
router.use('/backup',       backupRoutes);
router.use('/settings',     settingsRoutes);
router.use('/dashboard',    dashboardRoutes);
router.use('/drive',        googleDriveRoutes);
router.use('/transactions', transactionRoutes);
router.use('/client-log',   clientLogRoutes);

module.exports = router;


