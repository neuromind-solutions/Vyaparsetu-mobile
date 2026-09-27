const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');

router.get('/status', licenseController.getStatus);
router.post('/activate', licenseController.activate);

module.exports = router;
