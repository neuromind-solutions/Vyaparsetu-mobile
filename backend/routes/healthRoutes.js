/**
 * Health Routes
 * Defines all routes related to the health check feature.
 */

const express = require('express');
const { checkHealth } = require('../controllers/healthController');

const router = express.Router();

// GET /api/health
router.get('/', checkHealth);

module.exports = router;
