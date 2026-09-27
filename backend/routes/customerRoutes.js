/**
 * Customer Routes
 * All routes under /api/customers.
 * IMPORTANT: /search must come before /:id to avoid route collision.
 */

const express = require('express');
const ctrl = require('../controllers/customerController');

const router = express.Router();

// GET /api/customers/search?q=query   ← must be BEFORE /:id
router.get('/search', ctrl.searchCustomers);

// GET    /api/customers
router.get('/',    ctrl.getAll);

// GET    /api/customers/:id/ledger   ← must be BEFORE /:id
router.get('/:id/ledger', ctrl.getLedger);

// POST   /api/customers/bulk         ← must be BEFORE /:id
router.post('/bulk', ctrl.bulkImport);

// POST   /api/customers/deduplicate  ← must be BEFORE /:id
router.post('/deduplicate', ctrl.deduplicate);

// GET    /api/customers/:id
router.get('/:id', ctrl.getById);

// POST   /api/customers
router.post('/',   ctrl.create);


// PUT    /api/customers/:id
router.put('/:id', ctrl.update);

// DELETE /api/customers/:id
router.delete('/:id', ctrl.remove);

module.exports = router;
