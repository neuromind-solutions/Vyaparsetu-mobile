/**
 * Client Log Routes
 * Single endpoint the React error boundary posts renderer crashes to.
 */

const express = require('express');
const { recordClientError } = require('../controllers/clientLogController');

const router = express.Router();

// POST /api/client-log
router.post('/', recordClientError);

module.exports = router;
