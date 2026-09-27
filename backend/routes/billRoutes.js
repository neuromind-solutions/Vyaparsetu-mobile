// Bill Routes (mounted at /api/bills)
const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');

// List all bills (with optional search via query param ?q=)
router.get('/', billController.getAllBills);
router.get('/search', billController.searchBills);
router.get('/customer/:customerId', billController.getBillsByCustomer);
router.get('/:id', billController.getBillById);
router.post('/', billController.createBill);
router.put('/:id', billController.updateBill);
router.delete('/:id', billController.deleteBill);

module.exports = router;
