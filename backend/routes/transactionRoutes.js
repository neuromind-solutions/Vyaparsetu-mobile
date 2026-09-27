/**
 * Transaction Routes
 * Endpoints for transaction entry, daily customer purchase history, and bill generation.
 */

const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

router.post('/', transactionController.createTransaction);
router.post('/generate-bill', transactionController.generateBill);
router.post('/generate-statement', transactionController.generateStatement);
router.get('/', transactionController.getAllTransactions);
// Must stay above '/:id'. Express matches in declaration order and ':id' matches any
// single segment, so declared after it this would arrive as getTransactionById('pending-settlements').
router.get('/pending-settlements', transactionController.getPendingSettlements);
router.get('/:id', transactionController.getTransactionById);
router.get('/customer/:customerId', transactionController.getCustomerTransactions);
router.get('/customer/:customerId/daily', transactionController.getCustomerDailyPurchase);
router.get('/customer/:customerId/range', transactionController.getCustomerRangeTransactions);
router.put('/:id', transactionController.updateTransaction);
router.delete('/:id', transactionController.deleteTransaction);

module.exports = router;
