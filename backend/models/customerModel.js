/**
 * Customer Model
 * All raw SQL queries for the customers table live here.
 * Services call these functions — never call db directly from controllers.
 */

const { execSelect, execRun } = require('../database/db');
const { rowToRupees } = require('../utils/money');
const { splitSigned } = require('../utils/creditLedger');

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get all customers, ordered by name.
 * @returns {Array}
 */
function findAll() {
  return execSelect(
    `SELECT c.id, c.name, c.mobile, c.address, c.search_keywords, c.notes, c.credit_balance, c.commission_rate, c.created_at, c.updated_at,
            ot.amount AS opening_balance,
            ot.created_at AS opening_balance_date
     FROM customers c
     LEFT JOIN (
       SELECT customer_id, amount, created_at
       FROM credit_transactions
       WHERE transaction_type = 'OPENING_BALANCE'
     ) ot ON ot.customer_id = c.id
     WHERE c.is_deleted = 0
     ORDER BY c.name ASC`
  ).map((c) => rowToRupees(c, 'customers'));
}

/**
 * Find a single customer by ID.
 * @param {number} id
 * @returns {Object|null}
 */
function findById(id) {
  const rows = execSelect(
    `SELECT c.id, c.name, c.mobile, c.address, c.search_keywords, c.notes, c.credit_balance, c.commission_rate, c.created_at, c.updated_at,
            ot.amount AS opening_balance,
            ot.created_at AS opening_balance_date
     FROM customers c
     LEFT JOIN (
       SELECT customer_id, amount, created_at
       FROM credit_transactions
       WHERE transaction_type = 'OPENING_BALANCE'
     ) ot ON ot.customer_id = c.id
     WHERE c.id = ?`,
    [id]
  );
  return rowToRupees(rows[0] || null, 'customers');
}

/**
 * Find a customer by mobile number (used for duplicate check).
 * @param {string} mobile
 * @param {number|null} excludeId - skip this ID (for edit validation)
 * @returns {Object|null}
 */
function findByMobile(mobile, excludeId = null) {
  if (!mobile || !String(mobile).trim()) return null;
  const cleanMobile = String(mobile).trim();
  const sql = excludeId
    ? `SELECT id FROM customers WHERE mobile = ? AND mobile != '' AND id != ? AND is_deleted = 0`
    : `SELECT id FROM customers WHERE mobile = ? AND mobile != '' AND is_deleted = 0`;
  const params = excludeId ? [cleanMobile, excludeId] : [cleanMobile];
  const rows = execSelect(sql, params);
  return rows[0] || null;
}

/**
 * Search customers by name, mobile, or search_keywords (case-insensitive LIKE).
 * @param {string} query
 * @returns {Array}
 */
function search(query) {
  const cleanQuery = (query || '').trim();
  const like = `%${cleanQuery}%`;
  return execSelect(
    `SELECT c.id, c.name, c.mobile, c.address, c.search_keywords, c.notes, c.credit_balance, c.commission_rate, c.created_at, c.updated_at,
            ot.amount AS opening_balance,
            ot.created_at AS opening_balance_date
     FROM customers c
     LEFT JOIN (
       SELECT customer_id, amount, created_at
       FROM credit_transactions
       WHERE transaction_type = 'OPENING_BALANCE'
     ) ot ON ot.customer_id = c.id
     WHERE (c.name LIKE ? OR (c.mobile != '' AND c.mobile LIKE ?) OR (c.search_keywords != '' AND c.search_keywords LIKE ?)) AND c.is_deleted = 0
     ORDER BY c.name ASC`,
    [like, like, like]
  ).map((c) => rowToRupees(c, 'customers'));
}

/**
 * Insert a new customer or reactivate a deleted one.
 * @param {{ name, mobile, address, search_keywords, notes, commission_rate }} data
 * @returns {Object} The newly created/updated customer
 */
function create({ name, mobile = '', address = '', search_keywords = '', notes = '', commission_rate = null }) {
  const cleanMobile = (mobile || '').trim();
  const cleanKeywords = (search_keywords || '').trim();
  const cleanCommRate = (commission_rate !== undefined && commission_rate !== null && commission_rate !== '' && !isNaN(Number(commission_rate)))
    ? Number(commission_rate)
    : null;

  if (cleanMobile) {
    // Check if a record already exists with this mobile (even if deleted)
    const rows = execSelect(`SELECT id FROM customers WHERE mobile = ?`, [cleanMobile]);

    if (rows.length > 0) {
      // Reactivate and update the existing soft-deleted record
      const existingId = rows[0].id;
      execRun(
        `UPDATE customers
         SET name = ?, address = ?, search_keywords = ?, notes = ?, commission_rate = ?, is_deleted = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name.trim(), (address || '').trim(), cleanKeywords, (notes || '').trim(), cleanCommRate, existingId]
      );
      return findById(existingId);
    }
  }

  // Insert fresh record
  const result = execRun(
    `INSERT INTO customers (name, mobile, address, search_keywords, notes, credit_balance, commission_rate)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [name.trim(), cleanMobile, (address || '').trim(), cleanKeywords, (notes || '').trim(), cleanCommRate]
  );

  return findById(result.lastInsertRowid);
}

/**
 * Update an existing customer.
 * @param {number} id
 * @param {{ name, mobile, address, search_keywords, notes, commission_rate }} data
 * @returns {Object|null} Updated customer or null if not found
 */
function update(id, { name, mobile = '', address = '', search_keywords = '', notes = '', commission_rate = null }) {
  const cleanMobile = (mobile || '').trim();
  const cleanKeywords = (search_keywords || '').trim();
  const cleanCommRate = (commission_rate !== undefined && commission_rate !== null && commission_rate !== '' && !isNaN(Number(commission_rate)))
    ? Number(commission_rate)
    : null;
  execRun(
    `UPDATE customers
     SET name = ?, mobile = ?, address = ?, search_keywords = ?, notes = ?, commission_rate = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name.trim(), cleanMobile, (address || '').trim(), cleanKeywords, (notes || '').trim(), cleanCommRate, id]
  );
  return findById(id);
}

/**
 * Delete a customer by ID.
 * @param {number} id
 * @returns {boolean} true if deleted
 */
function remove(id) {
  const existing = findById(id);
  if (!existing) return false;
  execRun(`UPDATE customers SET is_deleted = 1 WHERE id = ?`, [id]);
  return true;
}

/**
 * Get full ledger for a customer: profile + all bills + all credit transactions + summary.
 * @param {number} customerId
 * @returns {Object|null}
 */
function getLedger(customerId) {
  const customer = findById(customerId);
  if (!customer) return null;

  // All bills for this customer
  const bills = execSelect(
    `SELECT b.id, b.bill_number, b.date, b.subtotal, b.discount_amount,
            b.commission_amount, b.hamali_amount, b.transport_amount,
            b.final_amount, b.paid_amount, b.remaining_amount,
            b.payment_type, b.payment_status
     FROM bills b
     WHERE b.customer_id = ?
     ORDER BY b.date DESC, b.id DESC`,
    [customerId]
  ).map((b) => rowToRupees(b, 'bills'));

  // All credit transactions for this customer.
  //
  // Newest first, except an opening balance, which is pinned to the bottom however
  // late it was entered: it represents what the customer owed before any of this,
  // so a passbook that showed it above later rows would read as though the debt
  // appeared today. Shops migrating off a notebook often enter a sale first and
  // remember the old balance afterwards, which is exactly when this matters.
  const transactions = execSelect(
    `SELECT ct.id, ct.transaction_type, ct.amount, ct.payment_mode,
            ct.note, ct.balance_after_transaction, ct.created_at,
            b.bill_number
     FROM credit_transactions ct
     LEFT JOIN bills b ON ct.bill_id = b.id
     WHERE ct.customer_id = ?
     ORDER BY CASE WHEN ct.transaction_type = 'OPENING_BALANCE' THEN 1 ELSE 0 END ASC,
              ct.created_at DESC, ct.id DESC`,
    [customerId]
  ).map((t) => rowToRupees(t, 'credit_transactions'));

  // Summary totals
  //
  // totalCredit − totalRecovered must land exactly on outstanding, because the
  // vendor reads those three figures side by side and a customer will do the
  // subtraction. Adjustments were previously left out of both, so any written-off
  // or corrected balance made the summary contradict the outstanding beside it.
  //
  // splitSigned derives both sides from the same signs that move credit_balance
  // (utils/creditLedger), so the identity holds by construction rather than by two
  // hand-maintained filter lists happening to agree. A row lands on whichever side
  // its sign puts it: a positive adjustment is debt added, a negative one is debt
  // forgiven and reads as recovery.
  const totalBilled = bills.reduce((s, b) => s + Number(b.final_amount || 0), 0);
  const totalPaid   = bills.reduce((s, b) => s + Number(b.paid_amount  || 0), 0);
  const { totalCredit, totalRecovered } = splitSigned(transactions);

  return {
    customer,
    bills,
    transactions,
    summary: {
      totalBilled:    Number(totalBilled.toFixed(2)),
      totalPaid:      Number(totalPaid.toFixed(2)),
      totalCredit:    Number(totalCredit.toFixed(2)),
      totalRecovered: Number(totalRecovered.toFixed(2)),
      outstanding:    Number(Number(customer.credit_balance).toFixed(2)),
    }
  };
}

/**
 * Bulk insert or update customers within a transaction.
 * @param {Array<{ name: string, mobile: string, address?: string, notes?: string, opening_balance?: number }>} items
 * @param {{ updateExisting?: boolean }} options
 */
function bulkUpsert(items, { updateExisting = true } = {}) {
  const { transaction } = require('../database/db');
  const creditModel = require('./creditModel');

  return transaction(() => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    items.forEach((item, index) => {
      try {
        const name = (item.name || '').trim();
        if (!name) {
          errors.push({ row: index + 1, mobile: item.mobile || '', error: 'Customer name is required.' });
          return;
        }

        const mobile = String(item.mobile || '').trim();
        if (mobile && !/^\d{10}$/.test(mobile)) {
          errors.push({ row: index + 1, name, mobile, error: 'Mobile number must be exactly 10 digits if provided.' });
          return;
        }

        const address = (item.address || '').trim();
        const notes = (item.notes || '').trim();
        const keywords = (item.search_keywords || item.keywords || '').trim();
        const openingRaw = item.opening_balance;
        const openingDate = item.opening_balance_date || item.date || null;
        let opening = 0;
        if (openingRaw !== undefined && openingRaw !== null && String(openingRaw).trim() !== '') {
          const num = Number(openingRaw);
          if (Number.isFinite(num) && num > 0) {
            opening = Number(num.toFixed(2));
          }
        }

        let rows = [];
        if (mobile) {
          rows = execSelect(`SELECT id, is_deleted FROM customers WHERE mobile = ?`, [mobile]);
        }
        // Fallback: If not found by mobile (or mobile was not provided), match by exact customer name (case-insensitive)
        if (rows.length === 0 && name) {
          rows = execSelect(`SELECT id, is_deleted FROM customers WHERE LOWER(TRIM(name)) = LOWER(?)`, [name]);
        }

        if (rows.length > 0) {
          const existing = rows[0];
          if (updateExisting || existing.is_deleted === 1) {
            execRun(
              `UPDATE customers
               SET name = ?,
                   mobile = CASE WHEN ? != '' THEN ? ELSE mobile END,
                   address = CASE WHEN ? != '' THEN ? ELSE address END,
                   search_keywords = CASE WHEN ? != '' THEN ? ELSE search_keywords END,
                   notes = CASE WHEN ? != '' THEN ? ELSE notes END,
                   is_deleted = 0,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [name, mobile, mobile, address, address, keywords, keywords, notes, notes, existing.id]
            );

            if (existing.is_deleted === 1) {
              created++;
            } else {
              updated++;
            }

            if (opening > 0 && !creditModel.hasOpeningBalance(existing.id)) {
              creditModel.recordOpeningBalance({
                customer_id: existing.id,
                amount: opening,
                date: openingDate,
                note: 'Opening balance (imported)',
              });
            }
          } else {
            skipped++;
          }
        } else {
          const res = execRun(
            `INSERT INTO customers (name, mobile, address, search_keywords, notes, credit_balance)
             VALUES (?, ?, ?, ?, ?, 0)`,
            [name, mobile, address, keywords, notes]
          );

          const newId = res.lastInsertRowid;
          created++;

          if (opening > 0 && newId) {
            creditModel.recordOpeningBalance({
              customer_id: newId,
              amount: opening,
              date: openingDate,
              note: 'Opening balance (imported)',
            });
          }
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

/**
 * Detect and merge duplicate customer records in the database.
 * Duplicates are identified by identical mobile numbers or identical customer names (case-insensitive).
 * Re-assigns bills & transactions to the primary customer record, transfers missing fields,
 * reconciles credit balance, and soft-deletes duplicate records.
 *
 * @returns {{ mergedGroups: number, duplicatesRemoved: number }}
 */
function deduplicate() {
  const { transaction } = require('../database/db');
  const { signedSumSql } = require('../utils/creditLedger');

  return transaction(() => {
    const customers = execSelect(
      `SELECT id, name, mobile, address, notes, credit_balance, created_at
       FROM customers
       WHERE is_deleted = 0
       ORDER BY id ASC`
    );

    let duplicatesRemoved = 0;
    let mergedGroups = 0;
    const handledIds = new Set();

    for (let i = 0; i < customers.length; i++) {
      const primary = customers[i];
      if (handledIds.has(primary.id)) continue;

      const pMobile = (primary.mobile || '').trim();
      const pName = (primary.name || '').trim().toLowerCase();

      // Find other active records that share the same non-empty mobile or the exact same name
      const dups = customers.filter((c) => {
        if (c.id === primary.id || handledIds.has(c.id)) return false;
        const cMobile = (c.mobile || '').trim();
        const cName = (c.name || '').trim().toLowerCase();

        if (pMobile && cMobile && pMobile === cMobile) return true;
        if (pName && cName && pName === cName) return true;
        return false;
      });

      if (dups.length === 0) continue;

      mergedGroups++;

      for (const dup of dups) {
        handledIds.add(dup.id);
        duplicatesRemoved++;

        // 1. Transfer bills
        execRun(`UPDATE bills SET customer_id = ? WHERE customer_id = ?`, [primary.id, dup.id]);

        // 2. Transfer credit_transactions
        const primaryHasOpening = execSelect(
          `SELECT id FROM credit_transactions WHERE customer_id = ? AND transaction_type = 'OPENING_BALANCE'`,
          [primary.id]
        ).length > 0;

        const dupTxs = execSelect(
          `SELECT id, transaction_type FROM credit_transactions WHERE customer_id = ?`,
          [dup.id]
        );

        for (const tx of dupTxs) {
          if (tx.transaction_type === 'OPENING_BALANCE' && primaryHasOpening) {
            execRun(`DELETE FROM credit_transactions WHERE id = ?`, [tx.id]);
          } else {
            execRun(`UPDATE credit_transactions SET customer_id = ? WHERE id = ?`, [primary.id, tx.id]);
          }
        }

        // 3. Fill missing fields on primary
        if (!pMobile && (dup.mobile || '').trim()) {
          execRun(`UPDATE customers SET mobile = ? WHERE id = ?`, [(dup.mobile || '').trim(), primary.id]);
        }
        if (!primary.address && (dup.address || '').trim()) {
          execRun(`UPDATE customers SET address = ? WHERE id = ?`, [(dup.address || '').trim(), primary.id]);
        }
        if (!primary.notes && (dup.notes || '').trim()) {
          execRun(`UPDATE customers SET notes = ? WHERE id = ?`, [(dup.notes || '').trim(), primary.id]);
        }

        // 4. Mark duplicate as deleted
        execRun(`UPDATE customers SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [dup.id]);
      }

      // 5. Reconcile primary credit balance
      const sumSql = signedSumSql('ct');
      const balRow = execSelect(
        `SELECT ${sumSql} AS total_balance FROM credit_transactions ct WHERE ct.customer_id = ?`,
        [primary.id]
      );
      const newBalPaise = balRow[0]?.total_balance || 0;
      execRun(`UPDATE customers SET credit_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newBalPaise, primary.id]);
    }

    return {
      mergedGroups,
      duplicatesRemoved,
    };
  });
}

module.exports = { findAll, findById, findByMobile, search, create, update, remove, getLedger, bulkUpsert, deduplicate };


