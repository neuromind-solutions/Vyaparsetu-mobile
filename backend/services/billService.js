// backend/services/billService.js
/**
 * Bill Service
 * Business logic for creating, retrieving, updating, and deleting bills.
 * All functions return a standardized { success: boolean, data?, error? } object.
 */
const {
  create: createBill,
  findAll,
  findById,
  findByCustomerId,
  update: updateBill,
  remove: deleteBill,
  search
} = require('../models/billModel');
const { findById: findCustomer } = require('../models/customerModel');
const { findById: findVegetable } = require('../models/vegetableModel');
const { calculateBill } = require('../utils/billingCalc');

/** Validate basic bill payload structure before processing */
function validateBillPayload(payload) {
  const errors = [];
  if (!payload.customer_id) errors.push('Customer ID required');
  if (!payload.date) errors.push('Date required');
  if (!payload.payment_type) errors.push('Payment Type required');
  if (!['Cash', 'UPI', 'Credit', 'Partial'].includes(payload.payment_type)) {
    errors.push('Payment Type must be Cash, UPI, Credit, or Partial');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    errors.push('At least one bill item required');
  } else {
    payload.items.forEach((it, idx) => {
      if (!it.vegetable_id) errors.push(`Item ${idx + 1}: vegetable_id required`);
      if (typeof it.quantity !== 'number' || it.quantity <= 0) {
        errors.push(`Item ${idx + 1}: Quantity must be greater than 0`);
      }
      if (typeof it.rate !== 'number' || it.rate < 0) {
        errors.push(`Item ${idx + 1}: Rate must be greater than or equal to 0`);
      }
    });
  }
  return errors;
}

async function getAllBills() {
  try {
    const rows = await findAll();
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getBillById(id) {
  try {
    const bill = await findById(id);
    return bill ? { success: true, data: bill } : { success: false, error: 'Bill not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getBillsByCustomerId(customerId) {
  try {
    const bills = await findByCustomerId(customerId);
    return { success: true, data: bills };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function searchBills(q) {
  try {
    const rows = await search(q);
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function createNewBill(payload) {
  // 1. Basic validation
  const validation = validateBillPayload(payload);
  if (validation.length) return { success: false, error: validation.join(', ') };

  // 2. Ensure customer exists
  const cust = await findCustomer(payload.customer_id);
  if (!cust) return { success: false, error: 'Customer not found' };

  // 3. Ensure each vegetable exists and resolve name
  const items = [];
  for (const it of payload.items) {
    const veg = await findVegetable(it.vegetable_id);
    if (!veg) return { success: false, error: `Vegetable ID ${it.vegetable_id} not found` };
    items.push({
      vegetable_id: it.vegetable_id,
      vegetable_name: veg.name, // always use official name from vegetable master
      quantity: Number(it.quantity),
      rate: Number(it.rate),
      item_date: it.item_date || null
    });
  }

  // Fetch commission rate: payload rate > settings > default 8
  const { getSettingByKey } = require('./settingsService');
  let commissionRate = 8.0;
  if (payload.commission_rate !== undefined && payload.commission_rate !== null && String(payload.commission_rate).trim() !== '') {
    const parsed = parseFloat(payload.commission_rate);
    if (!isNaN(parsed) && parsed >= 0) commissionRate = parsed;
  } else {
    try {
      const rateSetting = getSettingByKey('commission_rate');
      if (rateSetting !== null && rateSetting !== undefined) {
        const parsed = parseFloat(rateSetting);
        if (!isNaN(parsed) && parsed >= 0) {
          commissionRate = parsed;
        }
      }
    } catch (err) {
      // fallback is already 8.0
    }
  }

  // 4. Run billing calculations
  const calculated = calculateBill({
    items,
    discount_type: payload.discount_type,
    discount_value: payload.discount_value,
    paid_amount: payload.paid_amount,
    commission_rate: commissionRate,
    hamali_amount: payload.hamali_amount,
    transport_amount: payload.transport_amount
  });

  // 5. Business logic validations
  if (calculated.discount_amount > calculated.subtotal) {
    return { success: false, error: 'Discount cannot exceed subtotal' };
  }
  if (calculated.paid_amount > calculated.final_amount) {
    return { success: false, error: 'Paid amount cannot exceed final amount' };
  }

  // 6. Save in database
  try {
    const bill = await createBill({
      bill_number: payload.bill_number,
      customer_id: payload.customer_id,
      date: payload.date,
      subtotal: calculated.subtotal,
      discount_type: calculated.discount_type,
      discount_value: calculated.discount_value,
      discount_amount: calculated.discount_amount,
      commission_rate: calculated.commission_rate,
      commission_amount: calculated.commission_amount,
      hamali_amount: calculated.hamali_amount,
      transport_amount: calculated.transport_amount,
      final_amount: calculated.final_amount,
      paid_amount: calculated.paid_amount,
      remaining_amount: calculated.remaining_amount,
      payment_type: payload.payment_type,
      payment_status: calculated.payment_status,
      items: calculated.items
    });
    return { success: true, data: bill };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function updateExistingBill(id, payload) {
  // 1. Basic validation
  const validation = validateBillPayload(payload);
  if (validation.length) return { success: false, error: validation.join(', ') };

  // 2. Ensure bill exists
  const existing = await findById(id);
  if (!existing) return { success: false, error: 'Bill not found' };

  // 3. Ensure customer exists
  const cust = await findCustomer(payload.customer_id);
  if (!cust) return { success: false, error: 'Customer not found' };

  // 4. Ensure each vegetable exists and resolve name
  const items = [];
  for (const it of payload.items) {
    const veg = await findVegetable(it.vegetable_id);
    if (!veg) return { success: false, error: `Vegetable ID ${it.vegetable_id} not found` };
    items.push({
      vegetable_id: it.vegetable_id,
      vegetable_name: veg.name,
      quantity: Number(it.quantity),
      rate: Number(it.rate),
      item_date: it.item_date || null
    });
  }

  // Fetch commission rate: payload rate > existing bill rate > settings > default 8
  const { getSettingByKey } = require('./settingsService');
  let commissionRate = 8.0;
  if (payload.commission_rate !== undefined && payload.commission_rate !== null && String(payload.commission_rate).trim() !== '') {
    const parsed = parseFloat(payload.commission_rate);
    if (!isNaN(parsed) && parsed >= 0) commissionRate = parsed;
  } else if (existing.commission_rate !== undefined && existing.commission_rate !== null) {
    const parsed = parseFloat(existing.commission_rate);
    if (!isNaN(parsed) && parsed >= 0) commissionRate = parsed;
  } else {
    try {
      const rateSetting = getSettingByKey('commission_rate');
      if (rateSetting !== null && rateSetting !== undefined) {
        const parsed = parseFloat(rateSetting);
        if (!isNaN(parsed) && parsed >= 0) {
          commissionRate = parsed;
        }
      }
    } catch (err) {
      // fallback is already 8.0
    }
  }

  // 5. Run billing calculations
  const calculated = calculateBill({
    items,
    discount_type: payload.discount_type,
    discount_value: payload.discount_value,
    paid_amount: payload.paid_amount,
    commission_rate: commissionRate,
    hamali_amount: payload.hamali_amount !== undefined ? payload.hamali_amount : existing.hamali_amount,
    transport_amount: payload.transport_amount !== undefined ? payload.transport_amount : existing.transport_amount
  });

  // 6. Business logic validations
  if (calculated.discount_amount > calculated.subtotal) {
    return { success: false, error: 'Discount cannot exceed subtotal' };
  }
  if (calculated.paid_amount > calculated.final_amount) {
    return { success: false, error: 'Paid amount cannot exceed final amount' };
  }

  // 7. Update in database
  try {
    const bill = await updateBill(id, {
      bill_number: payload.bill_number,
      customer_id: payload.customer_id,
      date: payload.date,
      subtotal: calculated.subtotal,
      discount_type: calculated.discount_type,
      discount_value: calculated.discount_value,
      discount_amount: calculated.discount_amount,
      commission_rate: calculated.commission_rate,
      commission_amount: calculated.commission_amount,
      hamali_amount: calculated.hamali_amount,
      transport_amount: calculated.transport_amount,
      final_amount: calculated.final_amount,
      paid_amount: calculated.paid_amount,
      remaining_amount: calculated.remaining_amount,
      payment_type: payload.payment_type,
      payment_status: calculated.payment_status,
      items: calculated.items
    });
    return { success: true, data: bill };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function deleteBillById(id) {
  try {
    const ok = await deleteBill(id);
    return { success: ok, data: ok ? 'Deleted' : 'Not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  getAllBills,
  getBillById,
  getBillsByCustomerId,
  searchBills,
  createNewBill,
  updateExistingBill,
  deleteBillById
};
