// backend/models/billItemModel.js
const { execSelect, execRun } = require('../database/db');
const { toPaise, rowToRupees } = require('../utils/money');

function getByBillId(billId) {
  return execSelect(
    `SELECT bi.*, v.unit AS vegetable_unit
     FROM bill_items bi
     LEFT JOIN vegetables v ON bi.vegetable_id = v.id
     WHERE bi.bill_id = ?
     ORDER BY bi.item_date ASC, bi.id ASC`,
    [billId]
  ).map((it) => rowToRupees(it, 'bill_items'));
}

/**
 * Writes a bill's line items.
 *
 * item_date is the day the line was actually sold, which is what lets a range bill
 * print its lines grouped datewise. A single-day bill leaves it NULL: the day is
 * already on the bill, and every line written before ranges existed is NULL too, so
 * NULL and "belongs to the bill's own date" mean the same thing.
 */
function createMany(billId, items) {
  for (const it of items) {
    execRun(
      `INSERT INTO bill_items (bill_id, vegetable_id, vegetable_name, quantity, rate, total, item_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        billId,
        it.vegetable_id,
        it.vegetable_name || '',
        it.quantity,
        toPaise(it.rate),
        toPaise(it.total),
        it.item_date || null
      ]
    );
  }
  return true;
}

function deleteByBillId(billId) {
  execRun(`DELETE FROM bill_items WHERE bill_id = ?`, [billId]);
  return true;
}

module.exports = {
  getByBillId,
  createMany,
  deleteByBillId
};
