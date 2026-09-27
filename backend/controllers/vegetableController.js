/**
 * Vegetable Controller
 * Thin HTTP handlers — parse request, call service, return JSON.
 */

const vegetableService = require('../services/vegetableService');

/** GET /api/vegetables */
function getAll(req, res, next) {
  try {
    const vegetables = vegetableService.getAllVegetables();
    res.json({ success: true, data: vegetables, count: vegetables.length });
  } catch (err) { next(err); }
}

/**
 * GET /api/vegetables/search?q=
 * Must be mounted BEFORE /:id in routes.
 */
function searchVegetables(req, res, next) {
  try {
    const { q = '' } = req.query;
    const vegetables = vegetableService.searchVegetables(q);
    res.json({ success: true, data: vegetables, count: vegetables.length });
  } catch (err) { next(err); }
}

/** GET /api/vegetables/:id */
function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID.' });
    const veg = vegetableService.getVegetableById(id);
    res.json({ success: true, data: veg });
  } catch (err) { next(err); }
}

/** POST /api/vegetables */
function create(req, res, next) {
  try {
    const { name, rate, unit, category, search_keywords, notes } = req.body;
    const veg = vegetableService.createVegetable({ name, rate, unit, category, search_keywords, notes });
    res.status(201).json({ success: true, data: veg, message: 'Vegetable created successfully.' });
  } catch (err) { next(err); }
}

/** PUT /api/vegetables/:id */
function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID.' });
    const { name, rate, unit, category, search_keywords, notes } = req.body;
    const veg = vegetableService.updateVegetable(id, { name, rate, unit, category, search_keywords, notes });
    res.json({ success: true, data: veg, message: 'Vegetable updated successfully.' });
  } catch (err) { next(err); }
}

/** DELETE /api/vegetables/:id */
function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID.' });
    vegetableService.deleteVegetable(id);
    res.json({ success: true, message: 'Vegetable deleted successfully.' });
  } catch (err) { next(err); }
}

/** POST /api/vegetables/bulk */
function bulkImport(req, res, next) {
  try {
    const { items, updateExisting = true } = req.body;
    const result = vegetableService.bulkImportVegetables(items, { updateExisting });
    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully processed ${result.total} vegetables (${result.created} created, ${result.updated} updated, ${result.skipped} skipped).`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getById, searchVegetables, create, update, remove, bulkImport };


