/**
 * Vegetable Routes
 * /search must be mounted BEFORE /:id to avoid Express treating "search" as an ID param.
 */

const express = require('express');
const ctrl = require('../controllers/vegetableController');

const router = express.Router();

// GET /api/vegetables/search?q=  ← BEFORE /:id
router.get('/search', ctrl.searchVegetables);

// POST /api/vegetables/bulk     ← BEFORE /:id
router.post('/bulk', ctrl.bulkImport);

router.get('/',    ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/',   ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;

