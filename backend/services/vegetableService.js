/**
 * Vegetable Service
 * Business logic and validation for vegetable management.
 * Controllers call services — never the model directly.
 */

const vegetableModel = require('../models/vegetableModel');

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates vegetable input.
 * @param {{ name, rate }} data
 * @param {number|null} excludeId  — skip this ID for name uniqueness (edit case)
 * @throws {Error} with statusCode 400
 */
function validate({ name, rate }, excludeId = null) {
  const errors = [];

  if (!name || !name.trim()) {
    errors.push('Vegetable name is required.');
  } else {
    const existing = vegetableModel.findByName(name.trim(), excludeId);
    if (existing) {
      errors.push(`Vegetable "${name.trim()}" already exists.`);
    }
  }

  if (rate === undefined || rate === null || rate === '') {
    errors.push('Rate is required.');
  } else {
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0) {
      errors.push('Rate must be a number greater than or equal to 0.');
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(' '));
    err.statusCode = 400;
    err.errors = errors;
    throw err;
  }
}

// ─── Service Methods ──────────────────────────────────────────────────────────

function getAllVegetables() {
  return vegetableModel.findAll();
}

function getVegetableById(id) {
  const veg = vegetableModel.findById(id);
  if (!veg) {
    const err = new Error(`Vegetable with ID ${id} not found.`);
    err.statusCode = 404;
    throw err;
  }
  return veg;
}

function searchVegetables(query) {
  if (!query || !query.trim()) return vegetableModel.findAll();
  return vegetableModel.search(query.trim());
}

function createVegetable(data) {
  validate(data);
  return vegetableModel.create({
    ...data,
    rate: parseFloat(data.rate),
  });
}

function updateVegetable(id, data) {
  getVegetableById(id);
  validate(data, id);
  return vegetableModel.update(id, {
    ...data,
    rate: parseFloat(data.rate),
  });
}

function deleteVegetable(id) {
  getVegetableById(id);
  return vegetableModel.remove(id);
}

function bulkImportVegetables(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('No vegetable records provided for import.');
    err.statusCode = 400;
    throw err;
  }
  const { updateExisting = true } = options;
  return vegetableModel.bulkUpsert(items, { updateExisting });
}

module.exports = {
  getAllVegetables,
  getVegetableById,
  searchVegetables,
  createVegetable,
  updateVegetable,
  deleteVegetable,
  bulkImportVegetables,
};

