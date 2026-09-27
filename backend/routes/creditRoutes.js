// backend/routes/creditRoutes.js
const express = require('express');
const router = express.Router();
const creditController = require('../controllers/creditController');

router.get('/summary', creditController.getSummary);
router.get('/all-transactions', creditController.getAllCreditTransactions);
router.get('/customers', creditController.getCustomers);
router.get('/customer/:customerId', creditController.getCustomerById);
router.get('/customer/:customerId/transactions', creditController.getTransactions);
router.post('/payment', creditController.collectPayment);
router.delete('/payment/:id', creditController.undoPayment);
router.post('/discount', creditController.recordDiscount);
router.post('/adjustment', creditController.adjustCredit);
router.post('/opening-balance', creditController.recordOpeningBalance);

module.exports = router;
