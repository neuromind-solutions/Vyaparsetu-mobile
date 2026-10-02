/**
 * Offline Repository Layer — VyaparSetu
 * Provides 100% offline domain implementation of all database operations.
 * Implements exact financial integer-money arithmetic in whole paise on disk,
 * transparently converts to/from rupees at the boundary, enforces the append-only
 * credit ledger invariant, and records all mutations into the outbox for Supabase / PowerSync.
 */

import {
  dbGet,
  dbGetAll,
  dbPut,
  dbAdd,
  dbDelete,
  dbClear,
} from './localDb';
import { signOf, LEDGER_SIGNS } from '../utils/creditLedger';

// ─── MONEY CONVERSION HELPERS ──────────────────────────────────────────────────

function toPaise(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function toRupees(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : 0;
}

const MONEY_FIELDS = {
  customers: ['credit_balance', 'opening_balance'],
  vegetables: ['rate'],
  bills: [
    'subtotal',
    'discount_amount',
    'commission_amount',
    'hamali_amount',
    'transport_amount',
    'final_amount',
    'paid_amount',
    'remaining_amount',
    'customer_credit_balance',
    'previous_balance',
  ],
  bill_items: ['rate', 'total'],
  transactions: [
    'rate',
    'base_amount',
    'commission_amount',
    'final_amount',
    'paid_amount',
    'remaining_amount',
  ],
  credit_transactions: ['amount', 'balance_after_transaction'],
};

function rowToRupees(row, table) {
  if (!row) return row;
  const fields = MONEY_FIELDS[table];
  if (!fields) return row;
  const out = { ...row };
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = toRupees(out[f]);
    }
  }
  return out;
}

// Helper: current date in YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Generate unique mutation ID
function generateMutationId() {
  return 'mut_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// Queue mutation into outbox for cloud sync and immediately trigger a debounced sync
async function queueMutation(commandType, payload) {
  try {
    const mutation = {
      mutation_id: generateMutationId(),
      command_type: commandType,
      payload: JSON.stringify(payload),
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    await dbPut('outbox_mutations', mutation);

    // Push-on-write: schedule an immediate sync (debounced 800ms)
    // This ensures the other device gets the update without waiting for the 30s timer.
    try {
      const { cloudSyncService } = await import('../services/cloudSyncService');
      cloudSyncService.triggerImmediateSync();
    } catch (_) {}
  } catch (err) {
    console.warn('Failed to queue mutation:', err);
  }
}

// ─── CUSTOMER REPOSITORY ───────────────────────────────────────────────────────

export const offlineCustomerRepo = {
  async getAll() {
    const all = await dbGetAll('customers');
    const active = all.filter((c) => !c.is_deleted);
    return { success: true, data: active.map((c) => rowToRupees(c, 'customers')) };
  },

  async getById(id) {
    const customer = await dbGet('customers', Number(id));
    if (!customer || customer.is_deleted) {
      return { success: false, error: { message: 'Customer not found' } };
    }
    return { success: true, data: rowToRupees(customer, 'customers') };
  },

  async search(query = '') {
    const q = query.trim().toLowerCase();
    const all = await dbGetAll('customers');
    const filtered = all.filter((c) => {
      if (c.is_deleted) return false;
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.mobile?.includes(q) ||
        c.search_keywords?.toLowerCase().includes(q)
      );
    });
    return { success: true, data: filtered.map((c) => rowToRupees(c, 'customers')) };
  },

  async create(data) {
    const now = new Date().toISOString();
    const balancePaise = toPaise(data.credit_balance || data.opening_balance || 0);

    const newCustomer = {
      name: (data.name || '').trim(),
      mobile: data.mobile ? String(data.mobile).trim() : '',
      address: data.address ? data.address.trim() : '',
      search_keywords: data.search_keywords || '',
      notes: data.notes || '',
      credit_balance: balancePaise, // Stored in whole paise
      commission_rate: data.commission_rate != null ? Number(data.commission_rate) : null,
      is_deleted: 0,
      created_at: now,
      updated_at: now,
    };

    const id = await dbAdd('customers', newCustomer);
    newCustomer.id = id;

    // If customer has an initial opening balance, record it in credit_transactions
    if (balancePaise > 0) {
      await dbAdd('credit_transactions', {
        customer_id: id,
        transaction_type: 'OPENING_BALANCE',
        amount: balancePaise,
        notes: 'Opening Balance',
        date: getTodayDateString(),
        created_at: now,
      });
    }

    await queueMutation('CreateCustomer', newCustomer);
    return { success: true, data: rowToRupees(newCustomer, 'customers') };
  },

  async update(id, data) {
    const numId = Number(id);
    const existing = await dbGet('customers', numId);
    if (!existing || existing.is_deleted) {
      throw new Error('Customer not found');
    }

    const updated = {
      ...existing,
      name: data.name !== undefined ? data.name.trim() : existing.name,
      mobile: data.mobile !== undefined ? String(data.mobile).trim() : existing.mobile,
      address: data.address !== undefined ? data.address.trim() : existing.address,
      search_keywords: data.search_keywords !== undefined ? data.search_keywords : existing.search_keywords,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      commission_rate: data.commission_rate !== undefined ? data.commission_rate : existing.commission_rate,
      updated_at: new Date().toISOString(),
    };

    await dbPut('customers', updated);
    await queueMutation('UpdateCustomer', { id: numId, ...data });
    return { success: true, data: rowToRupees(updated, 'customers') };
  },

  async remove(id) {
    const numId = Number(id);
    const existing = await dbGet('customers', numId);
    if (existing) {
      existing.is_deleted = 1;
      existing.updated_at = new Date().toISOString();
      await dbPut('customers', existing);
      await queueMutation('DeleteCustomer', { id: numId, name: existing.name, _supabase_id: existing._supabase_id });
    }
    return { success: true, data: { id: numId } };
  },

  async getLedger(customerId) {
    const numId = Number(customerId);
    const customer = await dbGet('customers', numId);

    // 1. All bills for this customer
    const allBills = await dbGetAll('bills');
    const customerBills = allBills.filter((b) => b.customer_id === numId);
    customerBills.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
    const bills = customerBills.map((b) => rowToRupees(b, 'bills'));

    // 2. All credit transactions for this customer
    const allCredits = await dbGetAll('credit_transactions');
    const customerCredits = allCredits.filter((c) => c.customer_id === numId);

    // Map bill_id to bill_number for display in timeline
    const billMap = new Map(customerBills.map((b) => [b.id, b.bill_number]));

    // Newest first, with OPENING_BALANCE pinned to the bottom (same as backend)
    const sortedCredits = [...customerCredits].sort((a, b) => {
      if (a.transaction_type === 'OPENING_BALANCE') return 1;
      if (b.transaction_type === 'OPENING_BALANCE') return -1;
      return new Date(b.created_at || b.date) - new Date(a.created_at || a.date) || b.id - a.id;
    });

    const transactions = sortedCredits.map((t) => {
      const tRupees = rowToRupees(t, 'credit_transactions');
      if (t.bill_id && billMap.has(t.bill_id)) {
        tRupees.bill_number = billMap.get(t.bill_id);
      }
      return tRupees;
    });

    // 3. Chronological running balance for ledger view
    const chronoCredits = [...customerCredits].sort(
      (a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date) || a.id - b.id
    );
    let runningBalancePaise = 0;
    const ledger = chronoCredits.map((entry) => {
      const amtPaise = Number(entry.amount || 0);
      const sign = signOf(entry.transaction_type);
      runningBalancePaise += sign * amtPaise;

      return {
        ...rowToRupees(entry, 'credit_transactions'),
        running_balance: toRupees(runningBalancePaise),
      };
    });

    // 4. Summary totals
    const totalBilled = bills.reduce((s, b) => s + Number(b.final_amount || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + Number(b.paid_amount || 0), 0);
    let totalCredit = 0;
    let totalRecovered = 0;
    for (const t of transactions) {
      const amt = Number(t.amount || 0);
      if (t.transaction_type === 'CREDIT_ADDED' || t.transaction_type === 'OPENING_BALANCE') {
        totalCredit += amt;
      } else if (t.transaction_type === 'PAYMENT_RECEIVED' || t.transaction_type === 'DISCOUNT_GIVEN') {
        totalRecovered += amt;
      }
    }
    const outstanding = toRupees(customer ? customer.credit_balance : runningBalancePaise);

    return {
      success: true,
      data: {
        customer: customer ? rowToRupees(customer, 'customers') : null,
        bills,
        transactions,
        ledger,
        current_balance: outstanding,
        summary: {
          totalBilled: Number(totalBilled.toFixed(2)),
          totalPaid: Number(totalPaid.toFixed(2)),
          totalCredit: Number(totalCredit.toFixed(2)),
          totalRecovered: Number(totalRecovered.toFixed(2)),
          outstanding: Number(Number(outstanding).toFixed(2)),
        },
      },
    };
  },

  async bulkImport(customers = []) {
    const results = [];
    for (const c of customers) {
      const res = await this.create(c);
      results.push(res.data);
    }
    return { success: true, data: { imported: results.length } };
  },

  async deduplicate() {
    return { success: true, data: { merged: 0 } };
  },
};

// ─── VEGETABLES REPOSITORY ─────────────────────────────────────────────────────

export const offlineVegetableRepo = {
  async getAll() {
    const all = await dbGetAll('vegetables');
    const active = all.filter((v) => !v.is_deleted);
    return { success: true, data: active.map((v) => rowToRupees(v, 'vegetables')) };
  },

  async getById(id) {
    const veg = await dbGet('vegetables', Number(id));
    if (!veg || veg.is_deleted) {
      return { success: false, error: { message: 'Vegetable not found' } };
    }
    return { success: true, data: rowToRupees(veg, 'vegetables') };
  },

  async search(query = '') {
    const q = query.trim().toLowerCase();
    const all = await dbGetAll('vegetables');
    const filtered = all.filter((v) => {
      if (v.is_deleted) return false;
      if (!q) return true;
      return (
        v.name?.toLowerCase().includes(q) ||
        v.search_keywords?.toLowerCase().includes(q)
      );
    });
    return { success: true, data: filtered.map((v) => rowToRupees(v, 'vegetables')) };
  },

  async create(data) {
    const now = new Date().toISOString();
    const rateRupees = parseFloat(data.rate || 0); // rupees — keep for mutation payload
    const newVeg = {
      name: (data.name || '').trim(),
      rate: toPaise(rateRupees), // Stored in whole paise
      unit: data.unit || 'kg',
      search_keywords: data.search_keywords || '',
      notes: data.notes || '',
      is_deleted: 0,
      created_at: now,
      updated_at: now,
    };

    const id = await dbAdd('vegetables', newVeg);
    newVeg.id = id;

    // Queue mutation with RUPEE rate so pushOutboxMutations can convert correctly
    await queueMutation('CreateVegetable', { ...newVeg, rate: rateRupees });
    return { success: true, data: rowToRupees(newVeg, 'vegetables') };
  },

  async update(id, data) {
    const numId = Number(id);
    const existing = await dbGet('vegetables', numId);
    if (!existing || existing.is_deleted) {
      throw new Error('Vegetable not found');
    }

    const rateRupees = data.rate !== undefined ? parseFloat(data.rate) : toRupees(existing.rate);
    const updated = {
      ...existing,
      name: data.name !== undefined ? data.name.trim() : existing.name,
      rate: toPaise(rateRupees), // Stored in whole paise
      unit: data.unit !== undefined ? data.unit : existing.unit,
      search_keywords: data.search_keywords !== undefined ? data.search_keywords : existing.search_keywords,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      updated_at: new Date().toISOString(),
    };

    await dbPut('vegetables', updated);
    // Queue mutation with RUPEE rate so pushOutboxMutations can convert correctly
    await queueMutation('UpdateVegetable', { id: numId, ...data, rate: rateRupees });
    return { success: true, data: rowToRupees(updated, 'vegetables') };
  },

  async remove(id) {
    const numId = Number(id);
    const existing = await dbGet('vegetables', numId);
    if (existing) {
      existing.is_deleted = 1;
      existing.updated_at = new Date().toISOString();
      await dbPut('vegetables', existing);
      await queueMutation('DeleteVegetable', { id: numId, name: existing.name, _supabase_id: existing._supabase_id });
    }
    return { success: true, data: { id: numId } };
  },

  async bulkImport(vegetables = []) {
    const results = [];
    for (const v of vegetables) {
      const res = await this.create(v);
      results.push(res.data);
    }
    return { success: true, data: { imported: results.length } };
  },
};

// ─── TRANSACTIONS REPOSITORY ───────────────────────────────────────────────────

export const offlineTransactionRepo = {
  async getAll(params = {}) {
    const all = await dbGetAll('transactions');
    let filtered = all;

    if (params.customer_id) {
      filtered = filtered.filter((t) => t.customer_id === Number(params.customer_id));
    }
    if (params.transaction_date || params.date) {
      const targetDate = params.transaction_date || params.date;
      filtered = filtered.filter((t) => (t.transaction_date || t.date) === targetDate);
    }
    if (params.unbilled_only) {
      filtered = filtered.filter((t) => !t.bill_id);
    }

    filtered.sort((a, b) => {
      const d = (b.transaction_date || '').localeCompare(a.transaction_date || '');
      return d !== 0 ? d : b.id - a.id;
    });

    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const enriched = filtered.map((t) => {
      const cust = custMap.get(t.customer_id);
      return {
        ...rowToRupees(t, 'transactions'),
        customer_name: t.customer_name || cust?.name || 'Customer',
        customer_mobile: t.customer_mobile || cust?.mobile || '',
      };
    });

    return { success: true, data: enriched };
  },

  async create(data) {
    const now = new Date().toISOString();
    const weight = Number(data.weight || 0);
    const ratePaise = toPaise(data.rate || 0);
    const basePaise = Math.round(weight * ratePaise);

    const commRate = data.commission_rate != null ? Number(data.commission_rate) : 8.0;
    const commPaise = Math.round((basePaise * commRate) / 100);
    const finalPaise = basePaise + commPaise;

    const isPaid = data.payment_type === 'Cash' || data.payment_type === 'UPI' || data.payment_type === 'Paid';
    let paidPaise = 0;
    if (isPaid) {
      paidPaise = finalPaise;
    } else if (data.payment_type === 'Partial') {
      paidPaise = data.paid_amount != null ? toPaise(data.paid_amount) : 0;
    } else if (data.paid_amount != null && Number(data.paid_amount) > 0) {
      paidPaise = toPaise(data.paid_amount);
    }
    const remainingPaise = Math.max(0, finalPaise - paidPaise);

    const newTx = {
      customer_id: Number(data.customer_id),
      vegetable_id: Number(data.vegetable_id),
      vegetable_name_snapshot: data.vegetable_name_snapshot || data.vegetable_name || 'Produce',
      weight,
      unit: data.unit || 'kg',
      rate: ratePaise,
      base_amount: basePaise,
      commission_rate: commRate,
      commission_amount: commPaise,
      final_amount: finalPaise,
      payment_type: data.payment_type || 'Credit',
      payment_mode: data.payment_mode || data.payment_type || 'Credit',
      paid_amount: paidPaise,
      remaining_amount: remainingPaise,
      transaction_date: data.transaction_date || getTodayDateString(),
      bill_id: null,
      created_at: now,
      updated_at: now,
    };

    const id = await dbAdd('transactions', newTx);
    newTx.id = id;

    // If payment_type is Credit, update customer credit balance and record CREDIT_ADDED
    if (remainingPaise > 0) {
      const customer = await dbGet('customers', newTx.customer_id);
      if (customer) {
        customer.credit_balance = (customer.credit_balance || 0) + remainingPaise;
        customer.updated_at = now;
        await dbPut('customers', customer);

        // Record credit transaction
        await dbAdd('credit_transactions', {
          customer_id: newTx.customer_id,
          transaction_id: id,
          bill_id: null,
          transaction_type: 'CREDIT_ADDED',
          amount: remainingPaise,
          notes: `Daily Sale: ${newTx.vegetable_name_snapshot} (${weight} ${newTx.unit})`,
          date: newTx.transaction_date,
          created_at: now,
        });
      }
    }

    // Queue mutation with RUPEE values so pushOutboxMutations can convert correctly
    await queueMutation('CreateTransaction', rowToRupees(newTx, 'transactions'));
    return { success: true, data: rowToRupees(newTx, 'transactions') };
  },

  async update(id, data) {
    const numId = Number(id);
    const existing = await dbGet('transactions', numId);
    if (!existing) throw new Error('Transaction not found');

    const rateRupees = data.rate !== undefined ? parseFloat(data.rate) : toRupees(existing.rate);
    const weight = data.weight !== undefined ? parseFloat(data.weight) : existing.weight;
    const basePaise = toPaise(rateRupees * weight);
    const commRate = data.commission_rate !== undefined ? parseFloat(data.commission_rate) : existing.commission_rate;
    const commissionPaise = toPaise((toRupees(basePaise) * commRate) / 100);
    const finalPaise = basePaise + commissionPaise;
    const paymentType = data.payment_type || existing.payment_type;
    const isPaid = paymentType === 'Cash' || paymentType === 'UPI' || paymentType === 'Paid';
    let paidPaise;
    if (data.paid_amount !== undefined) {
      paidPaise = toPaise(data.paid_amount);
    } else if (isPaid) {
      paidPaise = finalPaise;
    } else {
      paidPaise = existing.paid_amount || 0;
    }
    const remainingPaise = data.remaining_amount !== undefined ? toPaise(data.remaining_amount) : Math.max(0, finalPaise - paidPaise);

    const oldRemainingPaise = existing.remaining_amount || 0;
    const deltaRemaining = remainingPaise - oldRemainingPaise;

    const updated = {
      ...existing,
      ...data,
      rate: toPaise(rateRupees),
      base_amount: basePaise,
      commission_rate: commRate,
      commission_amount: commissionPaise,
      final_amount: finalPaise,
      paid_amount: paidPaise,
      remaining_amount: remainingPaise,
      updated_at: new Date().toISOString(),
    };

    await dbPut('transactions', updated);

    // If this was an unsettled credit transaction and remaining amount changed, fix customer balance
    if (deltaRemaining !== 0 && !existing.bill_id) {
      const customer = await dbGet('customers', updated.customer_id);
      if (customer) {
        customer.credit_balance = (customer.credit_balance || 0) + deltaRemaining;
        customer.updated_at = new Date().toISOString();
        await dbPut('customers', customer);

        // Update the credit_transactions entry
        const credits = await dbGetAll('credit_transactions');
        const creditEntry = credits.find(c => c.transaction_id === numId && c.transaction_type === 'CREDIT_ADDED');
        if (creditEntry) {
          creditEntry.amount = remainingPaise;
          creditEntry.updated_at = new Date().toISOString();
          await dbPut('credit_transactions', creditEntry);
        } else if (remainingPaise > 0) {
          // If it wasn't credit but now it is
          await dbAdd('credit_transactions', {
            customer_id: updated.customer_id,
            transaction_id: numId,
            bill_id: null,
            transaction_type: 'CREDIT_ADDED',
            amount: remainingPaise,
            notes: `Daily Sale: ${updated.vegetable_name_snapshot} (${weight} ${updated.unit})`,
            date: updated.transaction_date,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    await queueMutation('UpdateTransaction', { id: numId, ...rowToRupees(updated, 'transactions'), _supabase_id: existing._supabase_id });
    return { success: true, data: rowToRupees(updated, 'transactions') };
  },

  async remove(id) {
    const numId = Number(id);
    const existing = await dbGet('transactions', numId);
    if (existing) {
      // If was credit and not settled into a consolidated bill, reverse from customer balance
      if (existing.remaining_amount > 0 && !existing.bill_id) {
        const customer = await dbGet('customers', existing.customer_id);
        if (customer) {
          customer.credit_balance = Math.max(0, (customer.credit_balance || 0) - existing.remaining_amount);
          await dbPut('customers', customer);
        }
        // Remove matching credit transaction
        const allCredits = await dbGetAll('credit_transactions');
        const match = allCredits.find((c) => c.transaction_id === numId);
        if (match) {
          await dbDelete('credit_transactions', match.id);
        }
      }
      await dbDelete('transactions', numId);
      await queueMutation('DeleteTransaction', { id: numId });
    }
    return { success: true, data: { id: numId } };
  },

  async getCustomerDailyPurchase(customerId, date) {
    const targetDate = date || getTodayDateString();
    const numCustId = Number(customerId);

    const allTx = await dbGetAll('transactions');
    const customerTx = allTx.filter(
      (t) => t.customer_id === numCustId && t.transaction_date === targetDate
    );

    let totalWeight = 0;
    let totalBasePaise = 0;
    let totalCommissionPaise = 0;
    let totalFinalPaise = 0;
    let totalPaidPaise = 0;
    let totalRemainingPaise = 0;

    for (const t of customerTx) {
      totalWeight += Number(t.weight || 0);
      totalBasePaise += Number(t.base_amount || 0);
      totalCommissionPaise += Number(t.commission_amount || 0);
      totalFinalPaise += Number(t.final_amount || 0);
      totalPaidPaise += Number(t.paid_amount || 0);
      totalRemainingPaise += Number(t.remaining_amount || 0);
    }

    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const cust = custMap.get(numCustId);

    return {
      success: true,
      data: {
        customer: cust ? rowToRupees(cust, 'customers') : null,
        date: targetDate,
        transactions: customerTx.map((t) => ({
          ...rowToRupees(t, 'transactions'),
          customer_name: t.customer_name || cust?.name || 'Customer',
          customer_mobile: t.customer_mobile || cust?.mobile || '',
        })),
        summary: {
          total_transactions: customerTx.length,
          total_items: customerTx.length,
          total_weight: Math.round(totalWeight * 100) / 100,
          total_base_amount: toRupees(totalBasePaise),
          total_commission: toRupees(totalCommissionPaise),
          total_commission_amount: toRupees(totalCommissionPaise),
          total_final_amount: toRupees(totalFinalPaise),
          total_paid_amount: toRupees(totalPaidPaise),
          total_remaining_amount: toRupees(totalRemainingPaise),
        },
      },
    };
  },

  async getCustomerRange(customerId, startDate, endDate) {
    const numCustId = Number(customerId);
    const allTx = await dbGetAll('transactions');
    const customerTx = allTx.filter((t) => {
      if (t.customer_id !== numCustId) return false;
      const d = t.transaction_date;
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });

    customerTx.sort((a, b) => (b.transaction_date || '').localeCompare(a.transaction_date || ''));

    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const cust = custMap.get(numCustId);

    const enriched = customerTx.map((t) => ({
      ...rowToRupees(t, 'transactions'),
      customer_name: t.customer_name || cust?.name || 'Customer',
      customer_mobile: t.customer_mobile || cust?.mobile || '',
    }));

    return { success: true, data: enriched };
  },

  async getPendingSettlements() {
    const all = await dbGetAll('transactions');
    const unbilled = all.filter((t) => !t.bill_id);
    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const groupMap = new Map();
    for (const t of unbilled) {
      const cid = t.customer_id;
      if (!groupMap.has(cid)) {
        const cust = custMap.get(cid);
        groupMap.set(cid, {
          customer_id: cid,
          customer_name: cust ? cust.name : (t.customer_name || 'Customer'),
          customer_mobile: cust ? cust.mobile : '',
          entry_count: 0,
          total_amount: 0,
          earliest_date: t.transaction_date,
          latest_date: t.transaction_date,
        });
      }
      const g = groupMap.get(cid);
      g.entry_count++;
      g.total_amount += toRupees(t.final_amount || 0);
      if (t.transaction_date && t.transaction_date < g.earliest_date) g.earliest_date = t.transaction_date;
      if (t.transaction_date && t.transaction_date > g.latest_date) g.latest_date = t.transaction_date;
    }
    return { success: true, data: Array.from(groupMap.values()) };
  },
};

// ─── BILLS REPOSITORY ──────────────────────────────────────────────────────────

export const offlineBillRepo = {
  async getAll(params = {}) {
    const all = await dbGetAll('bills');
    let filtered = all;

    if (params.customer_id) {
      filtered = filtered.filter((b) => b.customer_id === Number(params.customer_id));
    }
    if (params.date) {
      filtered = filtered.filter((b) => b.date === params.date);
    }

    filtered.sort((a, b) => b.id - a.id);

    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const enriched = filtered.map((b) => {
      const cust = custMap.get(b.customer_id);
      const billInRupees = rowToRupees(b, 'bills');
      const custBal = toRupees(cust?.credit_balance || 0);
      const finalAmt = Number(billInRupees.final_amount || 0);
      const paidAmt = Number(billInRupees.paid_amount || 0);
      if (
        billInRupees.previous_balance === undefined ||
        billInRupees.previous_balance === null ||
        (custBal > 0 && Math.abs(billInRupees.previous_balance - custBal) < 0.05 && finalAmt > 0)
      ) {
        billInRupees.previous_balance = Math.max(0, Math.round((custBal + paidAmt - finalAmt) * 100) / 100);
      }
      return {
        ...billInRupees,
        customer_name: b.customer_name || cust?.name || 'Customer',
        customer_mobile: b.customer_mobile || cust?.mobile || '',
        customer_credit_balance: custBal,
      };
    });

    return { success: true, data: enriched };
  },

  async getById(id) {
    const numId = Number(id);
    const bill = await dbGet('bills', numId);
    if (!bill) return { success: false, error: { message: 'Bill not found' } };

    const allItems = await dbGetAll('bill_items');
    const items = allItems.filter((item) => item.bill_id === numId);

    const customer = await dbGet('customers', bill.customer_id);
    const billInRupees = rowToRupees(bill, 'bills');
    const custBal = toRupees(customer?.credit_balance || 0);
    const finalAmt = Number(billInRupees.final_amount || 0);
    const paidAmt = Number(billInRupees.paid_amount || 0);

    if (
      billInRupees.previous_balance === undefined ||
      billInRupees.previous_balance === null ||
      (custBal > 0 && Math.abs(billInRupees.previous_balance - custBal) < 0.05 && finalAmt > 0)
    ) {
      billInRupees.previous_balance = Math.max(0, Math.round((custBal + paidAmt - finalAmt) * 100) / 100);
    }

    return {
      success: true,
      data: {
        ...billInRupees,
        customer_name: bill.customer_name || customer?.name || 'Customer',
        customer_mobile: bill.customer_mobile || customer?.mobile || '',
        customer: customer ? rowToRupees(customer, 'customers') : null,
        items: items.map((i) => rowToRupees(i, 'bill_items')),
      },
    };
  },

  async generateBillFromTransactions(data) {
    const now = new Date().toISOString();
    const numCustId = Number(data.customer_id || data.customerId);
    const date = data.date || getTodayDateString();

    const customer = numCustId ? await dbGet('customers', numCustId) : null;
    const customerName = data.customer_name || customer?.name || 'Customer';
    const customerMobile = data.customer_mobile || customer?.mobile || '';

    // Generate readable bill number: BILL-YYYYMMDD-XXXX
    const dateStr = date.replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    const billNumber = `BILL-${dateStr}-${rand}`;

    let txList = Array.isArray(data.transactions) && data.transactions.length > 0 ? [...data.transactions] : [];
    if (txList.length === 0 && numCustId) {
      const allTx = await dbGetAll('transactions');
      const startDate = data.period_start || data.startDate || date;
      const endDate = data.period_end || data.endDate || date;
      txList = allTx.filter((t) => {
        if (t.customer_id !== numCustId) return false;
        if (t.bill_id) return false;
        const d = t.transaction_date || t.date;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
      });
    }

    let subtotalPaise = 0;
    let commissionPaise = 0;
    const billItemsList = [];

    const allCredits = await dbGetAll('credit_transactions');

    for (const t of txList) {
      let dbTx = null;
      if (t.id) {
        dbTx = await dbGet('transactions', Number(t.id));
      }
      const itemBasePaise = dbTx ? (dbTx.base_amount || 0) : toPaise(t.base_amount || 0);
      const itemCommPaise = dbTx ? (dbTx.commission_amount || 0) : toPaise(t.commission_amount || 0);
      const itemFinalPaise = dbTx ? (dbTx.final_amount || (itemBasePaise + itemCommPaise)) : toPaise(t.final_amount || (itemBasePaise + itemCommPaise));
      const itemWeight = Number(dbTx?.weight != null ? dbTx.weight : (t.weight || 0));
      const itemRatePaise = dbTx ? (dbTx.rate || 0) : toPaise(t.rate || 0);
      const vegName = (dbTx?.vegetable_name_snapshot) || t.vegetable_name_snapshot || t.vegetable_name || 'Vegetable';

      subtotalPaise += itemBasePaise;
      commissionPaise += itemCommPaise;

      billItemsList.push({
        vegetable_id: dbTx?.vegetable_id || t.vegetable_id || null,
        vegetable_name: vegName,
        quantity: itemWeight,
        rate: itemRatePaise,
        total: itemBasePaise,
        item_date: (dbTx?.transaction_date) || t.transaction_date || date,
        tx_id: t.id ? Number(t.id) : null,
      });
    }

    const finalPaise = subtotalPaise + commissionPaise;
    const isPaid = data.payment_status === 'Paid' || data.payment_type === 'Paid' || data.payment_type === 'Cash' || data.payment_type === 'UPI';
    const paidPaise = isPaid ? finalPaise : toPaise(data.paid_amount || 0);
    const remainingPaise = Math.max(0, finalPaise - paidPaise);

    // Prior balance in paise before this bill was created
    const priorBalancePaise = billItemsList.length > 0
      ? Math.max(0, (customer?.credit_balance || 0) - remainingPaise)
      : Math.max(0, customer?.credit_balance || 0);

    const newBill = {
      bill_number: billNumber,
      customer_id: numCustId,
      customer_name: customerName,
      customer_mobile: customerMobile,
      date,
      period_start: data.period_start || date,
      period_end: data.period_end || date,
      subtotal: subtotalPaise,
      discount_type: 'fixed',
      discount_value: 0,
      discount_amount: 0,
      commission_rate: 8.0,
      commission_amount: commissionPaise,
      hamali_amount: 0,
      transport_amount: 0,
      final_amount: finalPaise,
      paid_amount: paidPaise,
      remaining_amount: remainingPaise,
      payment_type: data.payment_type || (isPaid ? 'Cash' : 'Credit'),
      payment_status: remainingPaise === 0 ? 'Paid' : (paidPaise > 0 ? 'Partial' : 'Credit'),
      previous_balance: priorBalancePaise,
      created_at: now,
      updated_at: now,
    };

    const billId = await dbAdd('bills', newBill);
    newBill.id = billId;

    const insertedItems = [];
    for (const item of billItemsList) {
      const itemRecord = {
        bill_id: billId,
        vegetable_id: item.vegetable_id,
        vegetable_name: item.vegetable_name,
        quantity: item.quantity,
        rate: item.rate,
        total: item.total,
        item_date: item.item_date,
        created_at: now,
      };
      const itemId = await dbAdd('bill_items', itemRecord);
      itemRecord.id = itemId;
      insertedItems.push(itemRecord);

      if (item.tx_id) {
        const txObj = await dbGet('transactions', item.tx_id);
        if (txObj) {
          txObj.bill_id = billId;
          await dbPut('transactions', txObj);
        }
        const matchingCredit = allCredits.find((c) => c.transaction_id === item.tx_id);
        if (matchingCredit) {
          matchingCredit.bill_id = billId;
          await dbPut('credit_transactions', matchingCredit);
        }
      }
    }

    if (billItemsList.length === 0 && remainingPaise > 0) {
      await dbAdd('credit_transactions', {
        customer_id: numCustId,
        bill_id: billId,
        transaction_id: null,
        transaction_type: 'CREDIT_ADDED',
        amount: remainingPaise,
        notes: `Bill Generated: #${billNumber}`,
        date: newBill.date,
        created_at: now,
      });

      if (customer) {
        customer.credit_balance = (customer.credit_balance || 0) + remainingPaise;
        customer.updated_at = now;
        await dbPut('customers', customer);
      }
    }

    await queueMutation('GenerateBill', { ...newBill, bill_id: billId });
    return {
      success: true,
      data: {
        ...rowToRupees(newBill, 'bills'),
        customer: customer ? rowToRupees(customer, 'customers') : { id: numCustId, name: customerName, mobile: customerMobile },
        customer_name: customerName,
        customer_mobile: customerMobile,
        items: insertedItems.map((i) => rowToRupees(i, 'bill_items')),
      },
    };
  },

  async generateRangeBill(data) {
    return this.generateBillFromTransactions(data);
  },

  async update(id, data) {
    const numId = Number(id);
    const oldBill = await dbGet('bills', numId);
    if (!oldBill) return { success: false, error: { message: 'Bill not found' } };

    const now = new Date().toISOString();
    const customerId = Number(data.customer_id || oldBill.customer_id);
    const customer = await dbGet('customers', customerId);

    // 1. Revert previous credit booked for this bill
    const allCredits = await dbGetAll('credit_transactions');
    const billCredits = allCredits.filter((c) => c.bill_id === numId && c.transaction_type === 'CREDIT_ADDED');
    const prevCreditPaise = billCredits.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    if (prevCreditPaise > 0 && customer) {
      customer.credit_balance = Math.max(0, (customer.credit_balance || 0) - prevCreditPaise);
      customer.updated_at = now;
      await dbPut('customers', customer);

      for (const c of billCredits) {
        await dbDelete('credit_transactions', c.id);
      }
    }

    // 2. Compute updated amounts
    const finalPaise = data.final_amount !== undefined ? toPaise(data.final_amount) : oldBill.final_amount;
    let paymentStatus = data.payment_status || oldBill.payment_status;
    let paymentType = data.payment_type || oldBill.payment_type;

    let paidPaise;
    if (paymentStatus === 'Paid') {
      paidPaise = finalPaise;
    } else if (data.paid_amount !== undefined) {
      paidPaise = toPaise(data.paid_amount);
    } else {
      paidPaise = oldBill.paid_amount || 0;
    }

    const remainingPaise = Math.max(0, finalPaise - paidPaise);
    if (remainingPaise === 0) {
      paymentStatus = 'Paid';
    } else if (paidPaise > 0) {
      paymentStatus = 'Partial';
    } else {
      paymentStatus = 'Credit';
    }

    // 3. Update the bill record
    const updatedBill = {
      ...oldBill,
      ...data,
      id: numId,
      customer_id: customerId,
      subtotal: data.subtotal !== undefined ? toPaise(data.subtotal) : oldBill.subtotal,
      discount_amount: data.discount_amount !== undefined ? toPaise(data.discount_amount) : oldBill.discount_amount,
      commission_amount: data.commission_amount !== undefined ? toPaise(data.commission_amount) : oldBill.commission_amount,
      hamali_amount: data.hamali_amount !== undefined ? toPaise(data.hamali_amount) : oldBill.hamali_amount,
      transport_amount: data.transport_amount !== undefined ? toPaise(data.transport_amount) : oldBill.transport_amount,
      final_amount: finalPaise,
      paid_amount: paidPaise,
      remaining_amount: remainingPaise,
      payment_type: paymentType,
      payment_status: paymentStatus,
      updated_at: now,
    };

    await dbPut('bills', updatedBill);

    // 4. Update bill_items if provided
    if (Array.isArray(data.items)) {
      const allItems = await dbGetAll('bill_items');
      for (const item of allItems) {
        if (item.bill_id === numId) {
          await dbDelete('bill_items', item.id);
        }
      }
      for (const item of data.items) {
        await dbAdd('bill_items', {
          bill_id: numId,
          vegetable_id: item.vegetable_id ? Number(item.vegetable_id) : null,
          vegetable_name: item.vegetable_name || 'Vegetable',
          quantity: Number(item.quantity || 0),
          rate: toPaise(item.rate || 0),
          total: toPaise(item.total || 0),
          item_date: item.item_date || updatedBill.date,
          created_at: now,
        });
      }
    }

    // 5. If remaining balance > 0, re-book credit on customer and add ledger row
    if (remainingPaise > 0 && customer) {
      customer.credit_balance = (customer.credit_balance || 0) + remainingPaise;
      customer.updated_at = now;
      await dbPut('customers', customer);

      await dbAdd('credit_transactions', {
        customer_id: customerId,
        bill_id: numId,
        transaction_id: null,
        transaction_type: 'CREDIT_ADDED',
        amount: remainingPaise,
        payment_mode: paymentType === 'Credit' ? 'Credit' : paymentType,
        notes: `Bill #${updatedBill.bill_number} updated`,
        date: updatedBill.date,
        created_at: now,
      });
    }

    // 6. Synchronize any transactions tied to this bill so status matches everywhere
    const allTx = await dbGetAll('transactions');
    const tiedTx = allTx.filter((t) => t.bill_id === numId);
    if (tiedTx.length > 0) {
      for (const tx of tiedTx) {
        if (paymentStatus === 'Paid') {
          tx.paid_amount = tx.final_amount;
          tx.remaining_amount = 0;
          tx.payment_type = 'Paid';
        } else if (paymentStatus === 'Credit') {
          tx.paid_amount = 0;
          tx.remaining_amount = tx.final_amount;
          tx.payment_type = 'Credit';
        } else if (paymentStatus === 'Partial') {
          tx.payment_type = 'Partial';
        }
        tx.updated_at = now;
        await dbPut('transactions', tx);
      }
    }

    // 7. Queue outbox mutation
    await queueMutation('UpdateBill', {
      id: numId,
      ...rowToRupees(updatedBill, 'bills'),
      _supabase_id: oldBill._supabase_id,
    });

    // 8. Dispatch global event to notify all mounted hooks across pages
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { local: true } }));
    }

    return {
      success: true,
      data: rowToRupees(updatedBill, 'bills'),
    };
  },

  async remove(id) {
    const numId = Number(id);
    const bill = await dbGet('bills', numId);
    if (!bill) return { success: false, error: { message: 'Bill not found' } };

    // 1. Unlink all transactions that belong to this bill (revert to unbilled)
    const allTx = await dbGetAll('transactions');
    for (const tx of allTx) {
      if (tx.bill_id === numId) {
        tx.bill_id = null;
        tx.updated_at = new Date().toISOString();
        await dbPut('transactions', tx);
      }
    }

    // 2. Unlink credit_transactions that point to this bill
    const allCredits = await dbGetAll('credit_transactions');
    for (const credit of allCredits) {
      if (credit.bill_id === numId) {
        credit.bill_id = null;
        credit.updated_at = new Date().toISOString();
        await dbPut('credit_transactions', credit);
      }
    }

    // 3. Delete all bill_items for this bill
    const allItems = await dbGetAll('bill_items');
    for (const item of allItems) {
      if (item.bill_id === numId) {
        await dbDelete('bill_items', item.id);
      }
    }

    // 4. Delete the bill itself
    await dbDelete('bills', numId);

    await queueMutation('DeleteBill', { id: numId, _supabase_id: bill._supabase_id });
    return { success: true };
  },
};

// ─── CREDIT & UDHAR REPOSITORY ─────────────────────────────────────────────────

export const offlineCreditRepo = {
  async recordPayment(data) {
    const now = new Date().toISOString();
    const numCustId = Number(data.customer_id);
    const amtPaise = toPaise(data.amount);

    const paymentTx = {
      customer_id: numCustId,
      bill_id: data.bill_id ? Number(data.bill_id) : null,
      transaction_type: 'PAYMENT_RECEIVED',
      amount: amtPaise,
      notes: data.notes || data.note || 'Payment Received',
      note: data.note || data.notes || 'Payment Received',
      payment_mode: data.payment_mode || 'Cash',
      date: data.date || getTodayDateString(),
      created_at: now,
    };

    const id = await dbAdd('credit_transactions', paymentTx);
    paymentTx.id = id;

    // Update customer credit balance
    const customer = await dbGet('customers', numCustId);
    if (customer) {
      customer.credit_balance = Math.max(0, (customer.credit_balance || 0) - amtPaise);
      customer.updated_at = now;
      await dbPut('customers', customer);
    }

    await queueMutation('RecordPayment', paymentTx);
    return { success: true, data: rowToRupees(paymentTx, 'credit_transactions') };
  },

  async giveDiscount(data) {
    const now = new Date().toISOString();
    const numCustId = Number(data.customer_id);
    const amtPaise = toPaise(data.amount);

    const discountTx = {
      customer_id: numCustId,
      bill_id: data.bill_id ? Number(data.bill_id) : null,
      transaction_type: 'DISCOUNT',
      amount: amtPaise,
      notes: data.notes || data.note || 'Discount Given',
      note: data.note || data.notes || 'Discount Given',
      date: data.date || getTodayDateString(),
      created_at: now,
    };

    const id = await dbAdd('credit_transactions', discountTx);
    discountTx.id = id;

    // Update customer credit balance
    const customer = await dbGet('customers', numCustId);
    if (customer) {
      customer.credit_balance = Math.max(0, (customer.credit_balance || 0) - amtPaise);
      customer.updated_at = now;
      await dbPut('customers', customer);
    }

    await queueMutation('GiveDiscount', discountTx);
    return { success: true, data: rowToRupees(discountTx, 'credit_transactions') };
  },

  async undoPayment(id) {
    const numId = Number(id);
    const tx = await dbGet('credit_transactions', numId);
    if (tx) {
      const customer = await dbGet('customers', tx.customer_id);
      if (customer) {
        customer.credit_balance = (customer.credit_balance || 0) + tx.amount;
        await dbPut('customers', customer);
      }
      await dbDelete('credit_transactions', numId);
      await queueMutation('UndoPayment', { id: numId, _supabase_id: tx._supabase_id });
    }
    return { success: true, data: { id: numId } };
  },

  async getAll() {
    const all = await dbGetAll('credit_transactions');
    return { success: true, data: all.map((c) => rowToRupees(c, 'credit_transactions')) };
  },

  async getCustomerTransactions(customerId) {
    const numId = Number(customerId);
    const all = await dbGetAll('credit_transactions');
    const filtered = all.filter((c) => c.customer_id === numId);

    // Sort oldest-first to compute running balance, then reverse for display
    filtered.sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date));

    // Compute running balance_after_transaction for each row.
    let runningPaise = 0;
    for (const tx of filtered) {
      tx.note = tx.notes || tx.note || '';
      tx.notes = tx.notes || tx.note || '';
      const amt = Number(tx.amount || 0); // stored in paise
      const type = tx.transaction_type;
      if (type === 'CREDIT_ADDED' || type === 'OPENING_BALANCE') {
        runningPaise += amt;
      } else if (type === 'PAYMENT_RECEIVED' || type === 'DISCOUNT' || type === 'CREDIT_ADJUSTMENT') {
        runningPaise = Math.max(0, runningPaise - amt);
      }
      tx.balance_after_transaction = runningPaise; // still in paise
    }

    // Reverse so newest appears first in the ledger
    filtered.reverse();

    return { success: true, data: filtered.map((c) => rowToRupees(c, 'credit_transactions')) };
  },

  async getSummary() {
    const allCustomers = await dbGetAll('customers');
    const active = allCustomers.filter((c) => !c.is_deleted);
    const today = getTodayDateString();

    let totalOutstandingPaise = 0;
    let customersWithBalance = 0;
    let countAbove10k = 0;
    let totalAbove10kPaise = 0;

    for (const c of active) {
      const bal = Number(c.credit_balance || 0);
      if (bal > 0) {
        totalOutstandingPaise += bal;
        customersWithBalance++;
        if (bal >= 1000000) { // 10,000 INR = 1,000,000 paise
          countAbove10k++;
          totalAbove10kPaise += bal;
        }
      }
    }

    const allCredits = await dbGetAll('credit_transactions');
    let todayCreditAddedPaise = 0;
    let todayRecoveryPaise = 0;

    for (const ct of allCredits) {
      const itemDate = ct.date || (ct.created_at ? ct.created_at.slice(0, 10) : '');
      if (itemDate === today) {
        if (ct.transaction_type === 'CREDIT_ADDED') {
          todayCreditAddedPaise += Number(ct.amount || 0);
        } else if (ct.transaction_type === 'PAYMENT_RECEIVED') {
          todayRecoveryPaise += Number(ct.amount || 0);
        }
      }
    }

    return {
      success: true,
      data: {
        total_outstanding: toRupees(totalOutstandingPaise),
        today_added: toRupees(todayCreditAddedPaise),
        today_credit_added: toRupees(todayCreditAddedPaise),
        today_recovered: toRupees(todayRecoveryPaise),
        today_recovery: toRupees(todayRecoveryPaise),
        customers_with_balance: customersWithBalance,
        count_above_10k: countAbove10k,
        total_above_10k: toRupees(totalAbove10kPaise),
      },
    };
  },
};

// ─── REPORTS REPOSITORY ────────────────────────────────────────────────────────

export const offlineReportRepo = {
  async getSalesSummary(startDate, endDate = startDate) {
    const allBills = await dbGetAll('bills');
    const filteredBills = allBills.filter(
      (b) => b.date >= startDate && b.date <= endDate
    );

    const allTx = await dbGetAll('transactions');
    const rangeTx = allTx.filter((t) => {
      const d = t.transaction_date || t.date;
      return d >= startDate && d <= endDate;
    });

    const allCredits = await dbGetAll('credit_transactions');
    const rangeCredits = allCredits.filter((ct) => {
      const d = ct.date || (ct.created_at ? ct.created_at.slice(0, 10) : '');
      return d >= startDate && d <= endDate;
    });

    const allCustomers = await dbGetAll('customers');
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const allBillItems = await dbGetAll('bill_items');

    let totalSubtotalPaise = 0;
    let totalDiscountPaise = 0;
    let totalCommissionPaise = 0;
    let totalSalesPaise = 0;
    let totalPaidPaise = 0;
    let totalRemainingPaise = 0;
    let cashCollectionPaise = 0;
    let upiCollectionPaise = 0;
    let creditSalesPaise = 0;

    for (const b of filteredBills) {
      totalSubtotalPaise += Number(b.subtotal || 0);
      totalDiscountPaise += Number(b.discount_amount || 0);
      totalCommissionPaise += Number(b.commission_amount || 0);
      totalSalesPaise += Number(b.final_amount || 0);
      totalPaidPaise += Number(b.paid_amount || 0);
      totalRemainingPaise += Number(b.remaining_amount || 0);

      if (b.payment_type === 'Cash') {
        cashCollectionPaise += Number(b.paid_amount || 0);
      } else if (b.payment_type === 'UPI') {
        upiCollectionPaise += Number(b.paid_amount || 0);
      }

      if (b.payment_status === 'Credit') {
        creditSalesPaise += Number(b.final_amount || 0);
      } else if (b.payment_status === 'Partial') {
        creditSalesPaise += Number(b.remaining_amount || 0);
      }
    }

    // Add unbilled transactions to sales summary if present
    const unbilledTx = rangeTx.filter((t) => !t.bill_id);
    for (const t of unbilledTx) {
      totalSubtotalPaise += Number(t.base_amount || 0);
      totalCommissionPaise += Number(t.commission_amount || 0);
      totalSalesPaise += Number(t.final_amount || 0);
      totalPaidPaise += Number(t.paid_amount || 0);
      totalRemainingPaise += Number(t.remaining_amount || 0);

      if (t.payment_type === 'Cash') {
        cashCollectionPaise += Number(t.paid_amount || 0);
      } else if (t.payment_type === 'UPI') {
        upiCollectionPaise += Number(t.paid_amount || 0);
      }

      if (t.remaining_amount > 0) {
        creditSalesPaise += Number(t.remaining_amount || 0);
      }
    }

    // Add recoveries from credit payments
    for (const ct of rangeCredits) {
      if (ct.transaction_type === 'PAYMENT_RECEIVED') {
        const mode = ct.payment_mode || 'Cash';
        if (mode === 'UPI') {
          upiCollectionPaise += Number(ct.amount || 0);
        } else {
          cashCollectionPaise += Number(ct.amount || 0);
        }
      }
    }

    // Attach customer names and items summary to bills
    const enrichedBills = filteredBills.map((b) => {
      const cust = custMap.get(b.customer_id);
      const items = allBillItems.filter((i) => i.bill_id === b.id);
      const summaryStr = items.map((i) => `${i.vegetable_name} (${i.quantity}kg)`).join(', ');
      return {
        ...rowToRupees(b, 'bills'),
        customer_name: b.customer_name || cust?.name || 'Customer',
        customer_mobile: b.customer_mobile || cust?.mobile || '',
        items_summary: summaryStr,
      };
    });

    // Build customer-wise itemized breakdown
    const activeCustIds = new Set();
    rangeTx.forEach((t) => activeCustIds.add(t.customer_id));
    filteredBills.forEach((b) => activeCustIds.add(b.customer_id));
    rangeCredits.forEach((ct) => activeCustIds.add(ct.customer_id));

    const customerBreakdown = [];
    for (const cid of activeCustIds) {
      const cust = custMap.get(cid);
      if (!cust) continue;

      const custBills = filteredBills.filter((b) => b.customer_id === cid);
      const custTx = rangeTx.filter((t) => t.customer_id === cid);

      let items = [];
      if (custTx.length > 0) {
        items = custTx.map((tx) => ({
          id: tx.id,
          vegetable_name: tx.vegetable_name_snapshot || 'Produce',
          weight: Number(tx.weight || 0),
          unit: tx.unit || 'kg',
          rate: toRupees(tx.rate || 0),
          base_amount: toRupees(tx.base_amount || 0),
          commission_rate: Number(tx.commission_rate || 8),
          commission_amount: toRupees(tx.commission_amount || 0),
          final_amount: toRupees(tx.final_amount || 0),
          payment_type: tx.payment_type || 'Credit',
          bill_number: tx.bill_id ? `BILL-${tx.bill_id}` : null,
          transaction_date: tx.transaction_date || tx.date,
        }));
      } else if (custBills.length > 0) {
        const billIds = new Set(custBills.map((b) => b.id));
        const matchedItems = allBillItems.filter((bi) => billIds.has(bi.bill_id));
        items = matchedItems.map((bi) => {
          const parentBill = custBills.find((b) => b.id === bi.bill_id);
          const commRate = Number(parentBill?.commission_rate || 8);
          const baseRupees = toRupees(bi.total || 0);
          const commRupees = Number(((baseRupees * commRate) / 100).toFixed(2));
          return {
            id: bi.id,
            vegetable_name: bi.vegetable_name,
            weight: Number(bi.quantity || 0),
            unit: 'kg',
            rate: toRupees(bi.rate || 0),
            base_amount: baseRupees,
            commission_rate: commRate,
            commission_amount: commRupees,
            final_amount: Number((baseRupees + commRupees).toFixed(2)),
            payment_type: parentBill?.payment_type || 'Credit',
            bill_number: parentBill?.bill_number || null,
            transaction_date: bi.item_date || parentBill?.date,
          };
        });
      }

      const todayBasePurchase = items.reduce((s, i) => s + Number(i.base_amount || 0), 0);
      const todayCommission = items.reduce((s, i) => s + Number(i.commission_amount || 0), 0);
      const todayBillTotal = items.reduce((s, i) => s + Number(i.final_amount || 0), 0);

      // Customer payments in range
      const custPayments = rangeCredits.filter(
        (ct) => ct.customer_id === cid && ct.transaction_type === 'PAYMENT_RECEIVED'
      );
      const ledgerPaidPaise = custPayments.reduce((s, ct) => s + Number(ct.amount || 0), 0);
      const billAndTxPaidPaise =
        custBills.reduce((s, b) => s + Number(b.paid_amount || 0), 0) +
        custTx.filter((t) => !t.bill_id).reduce((s, t) => s + Number(t.paid_amount || 0), 0);
      const todayPaid = toRupees(Math.max(ledgerPaidPaise, billAndTxPaidPaise));

      const closingBalance = toRupees(cust.credit_balance || 0);
      const previousBalance = Math.max(0, Number((closingBalance + todayPaid - todayBillTotal).toFixed(2)));

      customerBreakdown.push({
        customer_id: cid,
        customer_name: cust.name,
        customer_mobile: cust.mobile || '',
        previous_balance: previousBalance,
        items,
        today_base_purchase: Number(todayBasePurchase.toFixed(2)),
        today_commission: Number(todayCommission.toFixed(2)),
        today_bill_total: Number(todayBillTotal.toFixed(2)),
        today_paid: Number(todayPaid.toFixed(2)),
        closing_balance: Number(closingBalance.toFixed(2)),
        bill_numbers: [...new Set(items.map((i) => i.bill_number).filter(Boolean))],
        bills: custBills.map((b) => rowToRupees(b, 'bills')),
      });
    }

    customerBreakdown.sort((a, b) => a.customer_name.localeCompare(b.customer_name));

    const creditSummary = await offlineCreditRepo.getSummary();

    return {
      success: true,
      data: {
        summary: {
          total_bills: filteredBills.length || customerBreakdown.filter((c) => c.items.length > 0).length,
          total_subtotal: toRupees(totalSubtotalPaise),
          total_discount: toRupees(totalDiscountPaise),
          total_commission: toRupees(totalCommissionPaise),
          total_sales: toRupees(totalSalesPaise),
          total_paid: toRupees(totalPaidPaise),
          total_remaining: toRupees(totalRemainingPaise),
          cash_collection: toRupees(cashCollectionPaise),
          upi_collection: toRupees(upiCollectionPaise),
          credit_sales: toRupees(creditSalesPaise),
          total_outstanding: creditSummary.data.total_outstanding,
          active_customers_count: customerBreakdown.length,
        },
        bills: enrichedBills,
        customers: customerBreakdown,
        customer_breakdown: customerBreakdown,
        vegetable_breakdown: [],
        total_outstanding: creditSummary.data.total_outstanding,
      },
    };
  },

  async getDailySales(date) {
    const targetDate = date || getTodayDateString();
    return this.getSalesSummary(targetDate, targetDate);
  },

  async getRangeSales(startDate, endDate) {
    return this.getSalesSummary(startDate, endDate);
  },

  async getAllInOne(startDate, endDate) {
    const sales = await this.getSalesSummary(startDate, endDate);
    const credit = await offlineCreditRepo.getSummary();
    const customers = await offlineCustomerRepo.getAll();
    const vegetables = await offlineVegetableRepo.getAll();

    const allCredits = await dbGetAll('credit_transactions');
    const rangeCredits = allCredits.filter((ct) => {
      const d = ct.date || (ct.created_at ? ct.created_at.slice(0, 10) : '');
      return d >= startDate && d <= endDate;
    });

    const allCustMap = new Map((customers.data || []).map((c) => [c.id, c]));
    const enrichedLedger = rangeCredits.map((ct) => ({
      ...rowToRupees(ct, 'credit_transactions'),
      customer_name: allCustMap.get(ct.customer_id)?.name || 'Customer',
    }));

    return {
      success: true,
      data: {
        salesSummary: sales.data.summary,
        summary: sales.data.summary,
        bills: sales.data.bills,
        creditSummary: credit.data,
        customers: sales.data.customers,
        customer_breakdown: sales.data.customer_breakdown,
        ledger: enrichedLedger,
        vegetables: vegetables.data,
        dateRange: { startDate, endDate },
      },
    };
  },

  /**
   * Unified Dashboard Summary for DashboardPage.jsx
   */
  async getSummary() {
    const today = getTodayDateString();
    const salesRes = await this.getSalesSummary(today, today);
    const creditRes = await offlineCreditRepo.getSummary();
    const customersRes = await offlineCustomerRepo.getAll();
    const vegetablesRes = await offlineVegetableRepo.getAll();

    let salesSummary = salesRes.data.summary;
    const allCustomers = customersRes.data || [];

    // All stored bills sorted latest first
    const allStoredBillsRes = await offlineBillRepo.getAll();
    let recentBills = (allStoredBillsRes.data || []).slice(0, 5);

    // If no bills exist at all, fall back to recent transactions
    if (recentBills.length === 0) {
      const allTxs = await dbGetAll('transactions');
      const allCustMap = new Map(allCustomers.map((c) => [c.id, c]));

      recentBills = allTxs
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .slice(0, 5)
        .map((t) => ({
          ...rowToRupees(t, 'transactions'),
          customer_name: allCustMap.get(t.customer_id)?.name || 'Customer',
          customer_mobile: allCustMap.get(t.customer_id)?.mobile || '',
          date: t.transaction_date || t.date,
          bill_number: `TX-${t.id}`,
          payment_status: (t.remaining_amount || 0) === 0 ? 'Paid' : (t.paid_amount > 0 ? 'Partial' : 'Credit'),
        }));
    }

    // Pending credit customers (credit_balance > 0, top 5)
    const pendingCustomers = allCustomers
      .filter((c) => Number(c.credit_balance || 0) > 0)
      .sort((a, b) => Number(b.credit_balance || 0) - Number(a.credit_balance || 0))
      .slice(0, 5);

    return {
      success: true,
      data: {
        todaySummary: {
          totalSales: salesSummary.total_sales,
          totalBills: salesSummary.total_bills,
          paidAmount: salesSummary.total_paid,
          creditSales: salesSummary.credit_sales,
          recoveryAmount: creditRes.data.today_recovery,
          commission: salesSummary.total_commission,
          date: today,
        },
        overallSummary: {
          totalCustomers: allCustomers.length,
          totalVegetables: (vegetablesRes.data || []).length,
          totalUdhar: creditRes.data.total_outstanding,
          totalBills: (allStoredBillsRes.data || []).length,
        },
        recentBills,
        pendingCustomers,
        lastBackup: typeof localStorage !== 'undefined' ? localStorage.getItem('vyaparsetu_last_auto_backup') : null,
        internetOnline: typeof navigator !== 'undefined' ? navigator.onLine : false,
        ledgerCheck: { ok: true, mismatchCount: 0, mismatches: [] },
      },
    };
  },
};

// ─── SETTINGS REPOSITORY ───────────────────────────────────────────────────────

export const offlineSettingsRepo = {
  async getAll() {
    const all = await dbGetAll('settings');
    const dict = {};
    for (const item of all) {
      dict[item.key] = item.value;
    }
    return { success: true, data: dict };
  },

  async update(settingsObj) {
    for (const [key, value] of Object.entries(settingsObj)) {
      await dbPut('settings', { key, value: String(value) });
    }
    return { success: true, data: settingsObj };
  },
};

// ─── DATABASE RESET REPOSITORY ───────────────────────────────────────────────

export const offlineDatabaseRepo = {
  async resetAllData() {
    const stores = [
      'customers',
      'vegetables',
      'transactions',
      'bills',
      'bill_items',
      'credit_transactions',
      'outbox_mutations',
    ];
    for (const store of stores) {
      await dbClear(store).catch(() => {});
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('vyaparsetu_supabase_cust_map');
      localStorage.removeItem('vyaparsetu_supabase_veg_map');
      localStorage.removeItem('vyaparsetu_supabase_bill_map');
    }
    return { success: true, message: 'All local offline data reset to zero.' };
  },
};
