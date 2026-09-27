// backend/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

router.get('/daily', reportController.getDailySales);
router.get('/sales-range', reportController.getRangeSales);
router.get('/customers', reportController.getCustomers);
router.get('/vegetables', reportController.getVegetables);
router.get('/credit', reportController.getCredit);
router.get('/commission', reportController.getCommission);
router.get('/all-in-one', reportController.getAllInOne);

module.exports = router;
