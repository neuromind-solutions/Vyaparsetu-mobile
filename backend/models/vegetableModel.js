/**
 * Vegetable Model
 * All SQL queries for the vegetables table.
 * Services call these — no direct DB access from controllers.
 *
 * Search strategy:
 *   - name LIKE '%q%'            → direct name match
 *   - search_keywords LIKE '%q%' → keyword alias match
 *   Both are OR'd so partial typing like "shev" hits शेवगा
 *   and any keyword containing "shev".
 */

const { execSelect, execRun } = require('../database/db');
const { toPaise, rowToRupees } = require('../utils/money');

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get all vegetables ordered by name.
 */
function findAll() {
  return execSelect(
    `SELECT id, name, rate, unit, category, search_keywords, notes, created_at, updated_at
     FROM vegetables
     WHERE is_deleted = 0
     ORDER BY name ASC`
  ).map((v) => rowToRupees(v, 'vegetables'));
}

/**
 * Find a single vegetable by ID.
 */
function findById(id) {
  const rows = execSelect(
    `SELECT id, name, rate, unit, category, search_keywords, notes, created_at, updated_at
     FROM vegetables WHERE id = ?`,
    [id]
  );
  return rowToRupees(rows[0] || null, 'vegetables');
}

/**
 * Find by name — used for duplicate check (case-insensitive).
 * @param {string} name
 * @param {number|null} excludeId
 */
function findByName(name, excludeId = null) {
  const sql = excludeId
    ? `SELECT id FROM vegetables WHERE LOWER(name) = LOWER(?) AND id != ? AND is_deleted = 0`
    : `SELECT id FROM vegetables WHERE LOWER(name) = LOWER(?) AND is_deleted = 0`;
  const params = excludeId ? [name.trim(), excludeId] : [name.trim()];
  const rows = execSelect(sql, params);
  return rows[0] || null;
}

/**
 * Smart search — matches name OR search_keywords OR category using LIKE.
 * Partial match: "shev" → शेवगा (if keyword contains "shev")
 * Structure is ready for fuzzy/FTS upgrade later.
 * @param {string} query
 */
function search(query) {
  const like = `%${query.trim()}%`;
  return execSelect(
    `SELECT id, name, rate, unit, category, search_keywords, notes, created_at, updated_at
     FROM vegetables
     WHERE (name LIKE ? OR search_keywords LIKE ? OR category LIKE ?) AND is_deleted = 0
     ORDER BY
       CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
       name ASC`,
    [like, like, like, like]
  ).map((v) => rowToRupees(v, 'vegetables'));
}

/**
 * Insert a new vegetable or reactivate a deleted one.
 */
function create({ name, rate, unit = 'kg', category = 'General', search_keywords = '', notes = '' }) {
  // Check if a record already exists with this name (even if deleted)
  const rows = execSelect(`SELECT id FROM vegetables WHERE LOWER(name) = LOWER(?)`, [name.trim()]);

  if (rows.length > 0) {
    // Reactivate and update existing soft-deleted record
    const existingId = rows[0].id;
    execRun(
      `UPDATE vegetables
       SET rate = ?, unit = ?, category = ?, search_keywords = ?, notes = ?, is_deleted = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [toPaise(rate), unit.trim(), (category || 'General').trim(), search_keywords.trim(), notes.trim(), existingId]
    );
  } else {
    // Insert fresh record
    execRun(
      `INSERT INTO vegetables (name, rate, unit, category, search_keywords, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), toPaise(rate), unit.trim(), (category || 'General').trim(), search_keywords.trim(), notes.trim()]
    );
  }

  const resultRows = execSelect(
    `SELECT id, name, rate, unit, category, search_keywords, notes, created_at, updated_at
     FROM vegetables WHERE LOWER(name) = LOWER(?)`,
    [name.trim()]
  );
  return rowToRupees(resultRows[0], 'vegetables');
}

/**
 * Update an existing vegetable.
 */
function update(id, { name, rate, unit = 'kg', category = 'General', search_keywords = '', notes = '' }) {
  execRun(
    `UPDATE vegetables
     SET name = ?, rate = ?, unit = ?, category = ?, search_keywords = ?, notes = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name.trim(), toPaise(rate), unit.trim(), (category || 'General').trim(), search_keywords.trim(), notes.trim(), id]
  );
  return findById(id);
}

/**
 * Delete a vegetable by ID.
 */
function remove(id) {
  const existing = findById(id);
  if (!existing) return false;
  execRun(`UPDATE vegetables SET is_deleted = 1 WHERE id = ?`, [id]);
  return true;
}

/**
 * Bulk insert or update vegetables within a transaction.
 * @param {Array<{ name: string, rate: number, unit?: string, category?: string, search_keywords?: string, notes?: string }>} items
 * @param {{ updateExisting?: boolean }} options
 */
function bulkUpsert(items, { updateExisting = true } = {}) {
  const { transaction } = require('../database/db');

  return transaction(() => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    items.forEach((item, index) => {
      try {
        const name = (item.name || '').trim();
        if (!name) {
          errors.push({ row: index + 1, name: '', error: 'Vegetable name is required.' });
          return;
        }

        const rateNum = parseFloat(item.rate);
        if (isNaN(rateNum) || rateNum < 0) {
          errors.push({ row: index + 1, name, error: 'Valid rate (>= 0) is required.' });
          return;
        }

        const unit = (item.unit || 'kg').trim();
        const category = (item.category || 'General').trim();
        const keywords = (item.search_keywords || '').trim();
        const notes = (item.notes || '').trim();

        // Check if item exists (including soft deleted)
        const rows = execSelect(`SELECT id, is_deleted FROM vegetables WHERE LOWER(name) = LOWER(?)`, [name]);

        if (rows.length > 0) {
          const existing = rows[0];
          if (updateExisting || existing.is_deleted === 1) {
            execRun(
              `UPDATE vegetables
               SET rate = ?, unit = ?, category = ?, search_keywords = ?, notes = ?, is_deleted = 0, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [toPaise(rateNum), unit, category, keywords, notes, existing.id]
            );
            if (existing.is_deleted === 1) {
              created++;
            } else {
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          execRun(
            `INSERT INTO vegetables (name, rate, unit, category, search_keywords, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, toPaise(rateNum), unit, category, keywords, notes]
          );
          created++;
        }
      } catch (err) {
        errors.push({ row: index + 1, name: item.name || '', error: err.message });
      }
    });

    return {
      total: items.length,
      created,
      updated,
      skipped,
      errors,
    };
  });
}

module.exports = { findAll, findById, findByName, search, create, update, remove, bulkUpsert };


