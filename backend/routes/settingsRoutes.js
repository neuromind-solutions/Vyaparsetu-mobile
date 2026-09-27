const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/', settingsController.getAll);
router.put('/bulk', settingsController.updateBulk);
router.get('/:key', settingsController.getByKey);
router.put('/:key', settingsController.updateKey);

module.exports = router;
