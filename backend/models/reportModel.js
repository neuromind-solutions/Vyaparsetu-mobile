// backend/models/reportModel.js
const { execSelect } = require('../database/db');
const { toRupees, rowToRupees } = require('../utils/money');
const { localDateSql } = require('../utils/businessDay');

/** Get sales summary + bills list + customer-wise vegetable breakdown for date range */
function getSalesSummary(startDate, endDate = startDate) {
  // 1. Get aggregated summary statistics
  const summaryRes = execSelect(
    `SELECT 
      COUNT(*) as total_bills,
      COALESCE(SUM(subtotal), 0) as total_subtotal,
      COALESCE(SUM(discount_amount), 0) as total_discount,
      COALESCE(SUM(commission_amount), 0) as total_commission,
      COALESCE(SUM(final_amount), 0) as total_sales,
      COALESCE(SUM(paid_amount), 0) as total_paid,
      COALESCE(SUM(remaining_amount), 0) as total_remaining,
      COALESCE(SUM(CASE WHEN payment_type = 'Cash' THEN paid_amount ELSE 0 END), 0) as cash_collection,
      COALESCE(SUM(CASE WHEN payment_type = 'UPI' THEN paid_amount ELSE 0 END), 0) as upi_collection,
      COALESCE(SUM(CASE WHEN payment_status = 'Credit' THEN final_amount WHEN payment_status = 'Partial' THEN remaining_amount ELSE 0 END), 0) as credit_sales
     FROM bills
     WHERE date BETWEEN ? AND ?`,
    [startDate, endDate]
  );
  
  // 2. Get invoice rows
  const bills = execSelect(
    `SELECT b.*, c.name as customer_name, c.mobile as customer_mobile
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.date BETWEEN ? AND ?
     ORDER BY b.date DESC, b.id DESC`,
    [startDate, endDate]
  ).map((b) => rowToRupees(b, 'bills'));

  const summary = summaryRes[0] || {};

  // 3. Shop settings
  const settingsRows = execSelect(`SELECT key, value FROM settings`);
  const settingsObj = {};
  for (const s of settingsRows) {
    settingsObj[s.key] = s.value;
  }

  // 4. Shop-wide total outstanding udhar
  const outstandingRes = execSelect(`SELECT COALESCE(SUM(credit_balance), 0) AS total_outstanding FROM customers WHERE is_deleted = 0`);
  const totalOutstanding = toRupees(outstandingRes[0]?.total_outstanding || 0);

  // 5. Customer-wise itemized breakdown for this date / date range
  const activeCustRows = execSelect(
    `SELECT DISTINCT c.id, c.name, c.mobile, c.credit_balance
     FROM customers c
     WHERE c.id IN (
       SELECT customer_id FROM transactions WHERE transaction_date BETWEEN ? AND ?
       UNION
       SELECT customer_id FROM bills WHERE date BETWEEN ? AND ?
       UNION
       SELECT customer_id FROM credit_transactions WHERE transaction_type = 'PAYMENT_RECEIVED' AND ${localDateSql('created_at')} BETWEEN ? AND ?
     )
     ORDER BY c.name ASC`,
    [startDate, endDate, startDate, endDate, startDate, endDate]
  );

  const customerBreakdown = activeCustRows.map((c) => {
    const custBills = bills.filter((b) => b.customer_id === c.id);

    // Check transactions for this customer in range
    const txRows = execSelect(
      `SELECT t.*, b.bill_number
       FROM transactions t
       LEFT JOIN bills b ON t.bill_id = b.id
       WHERE t.customer_id = ? AND t.transaction_date BETWEEN ? AND ?
       ORDER BY t.transaction_date ASC, t.created_at ASC, t.id ASC`,
      [c.id, startDate, endDate]
    ).map((t) => rowToRupees(t, 'transactions'));

    const unbilledTx = txRows.filter((t) => !t.bill_id);

    let items = [];
    if (txRows.length > 0) {
      items = txRows.map((tx) => ({
        id: tx.id,
        vegetable_name: tx.vegetable_name_snapshot,
        weight: Number(tx.weight),
        unit: tx.unit || 'kg',
        rate: Number(tx.rate),
        base_amount: Number(tx.base_amount),
        commission_rate: Number(tx.commission_rate || 8),
        commission_amount: Number(tx.commission_amount),
        final_amount: Number(tx.final_amount),
        payment_type: tx.payment_type,
        bill_number: tx.bill_number || null,
        transaction_date: tx.transaction_date
      }));
    } else if (custBills.length > 0) {
      // Manual bills or legacy bills without direct transaction rows
      const billItems = execSelect(
        `SELECT bi.*, v.unit as vegetable_unit, b.bill_number, b.date, b.commission_rate, b.payment_type
         FROM bill_items bi
         JOIN bills b ON bi.bill_id = b.id
         LEFT JOIN vegetables v ON bi.vegetable_id = v.id
         WHERE b.customer_id = ? AND b.date BETWEEN ? AND ?
         ORDER BY b.date ASC, bi.id ASC`,
        [c.id, startDate, endDate]
      ).map((bi) => rowToRupees(bi, 'bill_items'));

      items = billItems.map((bi) => {
        const commRate = Number(bi.commission_rate || 8);
        const commAmt = Number(((bi.total * commRate) / 100).toFixed(2));
        return {
          id: bi.id,
          vegetable_name: bi.vegetable_name,
          weight: Number(bi.quantity),
          unit: bi.vegetable_unit || 'kg',
          rate: Number(bi.rate),
          base_amount: Number(bi.total),
          commission_rate: commRate,
          commission_amount: commAmt,
          final_amount: Number((bi.total + commAmt).toFixed(2)),
          payment_type: bi.payment_type || 'Credit',
          bill_number: bi.bill_number || null,
          transaction_date: bi.item_date || bi.date
        };
      });
    }

    const billedFinalAmount = custBills.reduce((s, b) => s + Number(b.final_amount || 0), 0);
    const billedBaseAmount = custBills.reduce((s, b) => s + Number(b.subtotal || 0), 0);
    const billedCommission = custBills.reduce((s, b) => s + Number(b.commission_amount || 0), 0);
    const billedPaidAmount = custBills.reduce((s, b) => s + Number(b.paid_amount || 0), 0);

    const unbilledFinalAmount = unbilledTx.reduce((s, t) => s + Number(t.final_amount || 0), 0);
    const unbilledBaseAmount = unbilledTx.reduce((s, t) => s + Number(t.base_amount || 0), 0);
    const unbilledCommission = unbilledTx.reduce((s, t) => s + Number(t.commission_amount || 0), 0);
    const unbilledPaidAmount = unbilledTx.reduce((s, t) => s + Number(t.paid_amount || 0), 0);

    const todayBasePurchase = Number((billedBaseAmount + unbilledBaseAmount).toFixed(2));
    const todayCommission = Number((billedCommission + unbilledCommission).toFixed(2));
    const todayBillTotal = Number((billedFinalAmount + unbilledFinalAmount).toFixed(2));

    // Payments received in this date window
    const payRows = execSelect(
      `SELECT COALESCE(SUM(amount), 0) AS total_paid
       FROM credit_transactions
       WHERE customer_id = ? AND transaction_type = 'PAYMENT_RECEIVED'
         AND ${localDateSql('created_at')} BETWEEN ? AND ?`,
      [c.id, startDate, endDate]
    );
    const ledgerPaid = toRupees(payRows[0]?.total_paid || 0);
    const todayPaid = Number(Math.max(ledgerPaid, billedPaidAmount + unbilledPaidAmount).toFixed(2));

    const closingBalance = Number(toRupees(c.credit_balance).toFixed(2));
    const previousBalance = Math.max(0, Number((closingBalance + todayPaid - todayBillTotal).toFixed(2)));

    return {
      customer_id: c.id,
      customer_name: c.name,
      customer_mobile: c.mobile,
      previous_balance: previousBalance,
      items,
      today_base_purchase: todayBasePurchase,
      today_commission: todayCommission,
      today_bill_total: todayBillTotal,
      today_paid: todayPaid,
      closing_balance: closingBalance,
      bill_numbers: [...new Set(items.map((i) => i.bill_number).filter(Boolean))],
      bills: custBills,
      unbilled_final: unbilledFinalAmount,
    };
  });

  const allDayFinalAmount = customerBreakdown.reduce((s, c) => s + c.today_bill_total, 0);
  const allDayPaid = customerBreakdown.reduce((s, c) => s + c.today_paid, 0);
  const totalUnbilledFinal = customerBreakdown.reduce((s, c) => s + (c.unbilled_final || 0), 0);
  const effectiveSales = Number((toRupees(summary.total_sales || 0) + totalUnbilledFinal).toFixed(2));
  const effectivePaid = Number(Math.max(toRupees(summary.total_paid || 0), allDayPaid).toFixed(2));

  const totalTxCommission = customerBreakdown.reduce((s, c) => s + (c.today_commission || 0), 0);
  const effectiveCommission = Number((toRupees(summary.total_commission || 0) || totalTxCommission).toFixed(2));

  return {
    shop: settingsObj,
    meta: {
      startDate,
      endDate,
      generated_at: new Date().toISOString()
    },
    summary: {
      ...summary,
      total_bills: Number(summary.total_bills || 0) || customerBreakdown.filter(c => c.items?.length > 0).length,
      total_subtotal: toRupees(summary.total_subtotal),
      total_discount: toRupees(summary.total_discount),
      total_commission: effectiveCommission,
      total_sales: effectiveSales,
      total_paid: effectivePaid,
      total_remaining: toRupees(summary.total_remaining),
      cash_collection: toRupees(summary.cash_collection),
      upi_collection: toRupees(summary.upi_collection),
      credit_sales: toRupees(summary.credit_sales),
      total_outstanding: totalOutstanding,
      active_customers_count: customerBreakdown.length,
    },
    bills,
    customers: customerBreakdown,
  };
}

/** Get purchase summary per customer */
function getCustomerPurchaseSummary(startDate, endDate) {
  return execSelect(
    `SELECT 
      c.id as customer_id,
      c.name as customer_name,
      c.mobile as customer_mobile,
      COUNT(b.id) as total_bills,
      COALESCE(SUM(b.final_amount), 0) as total_purchase,
      COALESCE(SUM(b.paid_amount), 0) as total_paid,
      c.credit_balance as total_pending_credit
     FROM customers c
     LEFT JOIN bills b ON c.id = b.customer_id AND b.date BETWEEN ? AND ?
     WHERE c.is_deleted = 0 OR (c.is_deleted = 1 AND b.id IS NOT NULL)
     GROUP BY c.id
     ORDER BY total_purchase DESC, c.name ASC`,
    [startDate, endDate]
  ).map((r) => ({
    ...r,
    total_purchase: toRupees(r.total_purchase),
    total_paid: toRupees(r.total_paid),
    total_pending_credit: toRupees(r.total_pending_credit),
  }));
}

/** Get vegetable sales summary */
function getVegetableSalesSummary(startDate, endDate) {
  return execSelect(
    `SELECT 
      bi.vegetable_id,
      bi.vegetable_name,
      v.unit as vegetable_unit,
      COALESCE(SUM(bi.quantity), 0) as total_quantity,
      COALESCE(SUM(bi.total), 0) as total_sales,
      COUNT(DISTINCT bi.bill_id) as total_bills
     FROM bill_items bi
     JOIN bills b ON bi.bill_id = b.id
     LEFT JOIN vegetables v ON bi.vegetable_id = v.id
     WHERE b.date BETWEEN ? AND ?
     GROUP BY bi.vegetable_id, bi.vegetable_name
     ORDER BY total_sales DESC`,
    [startDate, endDate]
  ).map((r) => ({
    ...r,
    total_sales: toRupees(r.total_sales),
  }));
}

/** Get credit balances, additions, and collections on a specific date */
function getCreditSummary(dateVal) {
  // Total outstanding balance across all customers (cumulative total)
  const outstandingRes = execSelect(`SELECT COALESCE(SUM(credit_balance), 0) AS total_outstanding FROM customers WHERE is_deleted = 0`);
  const totalOutstanding = outstandingRes[0]?.total_outstanding || 0.0;

  // Credit added on that date — CREDIT_ADDED only, on purpose. This is an activity
  // figure: how much udhar the shop extended that day. An opening balance entered while
  // migrating a notebook, or a correcting adjustment, moves the outstanding total but is
  // not credit the shop gave out, so neither belongs here. The reconciling view of every
  // row is customerModel.getLedger's splitSigned summary.
  const addedRes = execSelect(
    `SELECT COALESCE(SUM(amount), 0) AS credit_added
     FROM credit_transactions
     WHERE transaction_type = 'CREDIT_ADDED'
       AND ${localDateSql('created_at')} = ?`,
    [dateVal]
  );
  const creditAdded = addedRes[0]?.credit_added || 0.0;

  // Recovery amount on that date — money actually collected, so PAYMENT_RECEIVED only.
  const recoveredRes = execSelect(
    `SELECT COALESCE(SUM(amount), 0) AS credit_recovered
     FROM credit_transactions
     WHERE transaction_type = 'PAYMENT_RECEIVED'
       AND ${localDateSql('created_at')} = ?`,
    [dateVal]
  );
  const creditRecovered = recoveredRes[0]?.credit_recovered || 0.0;

  // Customer outstanding balance listing with today's recovery and last update date
  const customers = execSelect(
    `SELECT c.id, c.name, c.mobile, c.credit_balance,
            (
              SELECT COALESCE(SUM(ct.amount), 0)
              FROM credit_transactions ct
              WHERE ct.customer_id = c.id
                AND ct.transaction_type = 'PAYMENT_RECEIVED'
                AND ${localDateSql('ct.created_at')} = ?
            ) AS today_recovery,
            COALESCE(
              (SELECT ${localDateSql('ct.created_at')} FROM credit_transactions ct WHERE ct.customer_id = c.id ORDER BY ct.created_at DESC, ct.id DESC LIMIT 1),
              ${localDateSql('c.created_at')}
            ) AS last_transaction_date
     FROM customers c 
     WHERE c.credit_balance > 0 AND c.is_deleted = 0
     ORDER BY last_transaction_date DESC, c.credit_balance DESC, c.name ASC`,
    [dateVal]
  );

  // Customer recoveries made on this specific date
  const recoveries = execSelect(
    `SELECT ct.id, ct.amount, ct.payment_mode, ct.note, ct.created_at,
            c.id AS customer_id, c.name AS customer_name, c.mobile AS customer_mobile
     FROM credit_transactions ct
     JOIN customers c ON ct.customer_id = c.id
     WHERE ct.transaction_type = 'PAYMENT_RECEIVED'
       AND ${localDateSql('ct.created_at')} = ?
     ORDER BY ct.created_at DESC, ct.id DESC`,
    [dateVal]
  ).map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    customer_mobile: r.customer_mobile,
    payment_mode: r.payment_mode,
    note: r.note,
    created_at: r.created_at,
    amount: toRupees(r.amount)
  }));

  return {
    summary: {
      total_outstanding: toRupees(totalOutstanding),
      credit_added: toRupees(creditAdded),
      credit_recovered: toRupees(creditRecovered),
      recoveries_count: recoveries.length,
    },
    recoveries,
    customers: customers.map((c) => ({
      ...rowToRupees(c, 'customers'),
      today_recovery: toRupees(c.today_recovery || 0),
      last_transaction_date: c.last_transaction_date
    }))
  };
}

/** Get commission collection date-wise and bill-wise */
function getCommissionSummary(startDate, endDate) {
  // Aggregate sum
  const sumRes = execSelect(
    `SELECT COALESCE(SUM(commission_amount), 0) as total_commission
     FROM bills
     WHERE date BETWEEN ? AND ?`,
    [startDate, endDate]
  );
  const totalCommission = sumRes[0]?.total_commission || 0.0;

  // Date-wise commission
  const dateWise = execSelect(
    `SELECT 
      date,
      COUNT(*) as total_bills,
      SUM(commission_amount) as total_commission
     FROM bills
     WHERE date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date DESC`,
    [startDate, endDate]
  );

  // Bill-wise commission
  const billWise = execSelect(
    `SELECT 
      b.id as bill_id,
      b.bill_number,
      b.date,
      c.name as customer_name,
      b.final_amount,
      b.commission_amount
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     WHERE b.date BETWEEN ? AND ?
     ORDER BY b.date DESC, b.id DESC`,
    [startDate, endDate]
  );

  return {
    total_commission: toRupees(totalCommission),
    dateWise: dateWise.map((d) => ({ ...d, total_commission: toRupees(d.total_commission) })),
    billWise: billWise.map((b) => rowToRupees(b, 'bills'))
  };
}

/** Comprehensive All-In-One Business Master Report */
function getAllInOneReport(startDate, endDate) {
  const hasRange = !!(startDate && endDate);
  const dateFilter = hasRange ? `WHERE date BETWEEN ? AND ?` : ``;
  const dateParams = hasRange ? [startDate, endDate] : [];

  // 1. Aggregated sales summary
  const summaryRes = execSelect(
    `SELECT 
      COUNT(*) as total_bills,
      COALESCE(SUM(subtotal), 0) as total_subtotal,
      COALESCE(SUM(discount_amount), 0) as total_discount,
      COALESCE(SUM(commission_amount), 0) as total_commission,
      COALESCE(SUM(hamali_amount), 0) as total_hamali,
      COALESCE(SUM(transport_amount), 0) as total_transport,
      COALESCE(SUM(final_amount), 0) as total_sales,
      COALESCE(SUM(paid_amount), 0) as total_paid,
      COALESCE(SUM(remaining_amount), 0) as total_remaining,
      COALESCE(SUM(CASE WHEN payment_type = 'Cash' THEN paid_amount ELSE 0 END), 0) as cash_collection,
      COALESCE(SUM(CASE WHEN payment_type = 'UPI' THEN paid_amount ELSE 0 END), 0) as upi_collection,
      COALESCE(SUM(CASE WHEN payment_status = 'Credit' THEN final_amount WHEN payment_status = 'Partial' THEN remaining_amount ELSE 0 END), 0) as credit_sales
     FROM bills
     ${dateFilter}`,
    dateParams
  );
  const summary = summaryRes[0] || {};

  // Total Outstanding across all customers
  const outstandingRes = execSelect(`SELECT COALESCE(SUM(credit_balance), 0) AS total_outstanding FROM customers WHERE is_deleted = 0`);
  const totalOutstanding = outstandingRes[0]?.total_outstanding || 0.0;

  // Active customer count
  const customerCountRes = execSelect(`SELECT COUNT(*) as total_customers FROM customers WHERE is_deleted = 0`);
  const totalCustomersCount = customerCountRes[0]?.total_customers || 0;

  // Vegetable catalog items count
  const vegCountRes = execSelect(`SELECT COUNT(*) as total_vegetables FROM vegetables WHERE is_deleted = 0`);
  const totalVegetablesCount = vegCountRes[0]?.total_vegetables || 0;

  // 2. Bills with item details
  const bills = execSelect(
    `SELECT b.*, c.name as customer_name, c.mobile as customer_mobile, c.address as customer_address
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     ${hasRange ? `WHERE b.date BETWEEN ? AND ?` : ``}
     ORDER BY b.date DESC, b.id DESC`,
    dateParams
  ).map((b) => rowToRupees(b, 'bills'));

  for (const bill of bills) {
    const items = execSelect(
      `SELECT bi.*, v.unit as vegetable_unit 
       FROM bill_items bi 
       LEFT JOIN vegetables v ON bi.vegetable_id = v.id 
       WHERE bi.bill_id = ? 
       ORDER BY bi.id ASC`,
      [bill.id]
    ).map((bi) => rowToRupees(bi, 'bill_items'));
    bill.items = items;
    bill.items_summary = items.map((i) => `${i.vegetable_name} (${i.quantity} ${i.vegetable_unit || 'kg'} @ ₹${i.rate})`).join(', ');
  }

  // 3. Customer Directory & Udhar Passbook
  const customers = execSelect(
    `SELECT 
      c.id, c.name, c.mobile, c.address, c.notes, c.created_at,
      c.credit_balance as current_credit_balance,
      COUNT(b.id) as total_bills,
      COALESCE(SUM(b.final_amount), 0) as total_purchases,
      COALESCE(SUM(b.paid_amount), 0) as total_paid
     FROM customers c
     LEFT JOIN bills b ON c.id = b.customer_id ${hasRange ? `AND b.date BETWEEN ? AND ?` : ``}
     WHERE c.is_deleted = 0
     GROUP BY c.id
     ORDER BY c.name ASC`,
    dateParams
  ).map((c) => ({
    ...c,
    current_credit_balance: toRupees(c.current_credit_balance),
    total_purchases: toRupees(c.total_purchases),
    total_paid: toRupees(c.total_paid),
  }));

  // 4. Credit Ledger / Passbook Transactions
  const ledgerRows = execSelect(
    `SELECT ct.*, c.name as customer_name, c.mobile as customer_mobile, b.bill_number
     FROM credit_transactions ct
     JOIN customers c ON ct.customer_id = c.id
     LEFT JOIN bills b ON ct.bill_id = b.id
     ${hasRange ? `WHERE ${localDateSql('ct.created_at')} BETWEEN ? AND ?` : ``}
     ORDER BY ct.created_at DESC, ct.id DESC`,
    dateParams
  ).map((r) => rowToRupees(r, 'credit_transactions'));

  // 5. Vegetable Sales Performance
  const vegSales = execSelect(
    `SELECT 
      bi.vegetable_id,
      bi.vegetable_name,
      v.unit as vegetable_unit,
      COALESCE(SUM(bi.quantity), 0) as total_quantity,
      COALESCE(SUM(bi.total), 0) as total_sales,
      COUNT(DISTINCT bi.bill_id) as total_bills
     FROM bill_items bi
     JOIN bills b ON bi.bill_id = b.id
     LEFT JOIN vegetables v ON bi.vegetable_id = v.id
     ${hasRange ? `WHERE b.date BETWEEN ? AND ?` : ``}
     GROUP BY bi.vegetable_id, bi.vegetable_name
     ORDER BY total_sales DESC`,
    dateParams
  ).map((r) => ({
    ...r,
    total_sales: toRupees(r.total_sales),
    average_rate: r.total_quantity > 0 ? (toRupees(r.total_sales) / r.total_quantity).toFixed(2) : 0,
  }));

  // 6. Vegetables Catalog
  const vegCatalog = execSelect(
    `SELECT id, name, rate, unit, search_keywords, notes 
     FROM vegetables 
     WHERE is_deleted = 0 
     ORDER BY name ASC`
  ).map((v) => rowToRupees(v, 'vegetables'));

  // 7. Shop Settings
  const settingsRows = execSelect(`SELECT key, value FROM settings`);
  const settingsObj = {};
  for (const s of settingsRows) {
    settingsObj[s.key] = s.value;
  }

  const totalVegVolume = vegSales.reduce((acc, item) => acc + Number(item.total_quantity || 0), 0);

  return {
    meta: {
      generated_at: new Date().toISOString(),
      start_date: startDate || null,
      end_date: endDate || null,
      period_label: hasRange ? `${startDate} to ${endDate}` : 'All-Time',
    },
    shop: settingsObj,
    summary: {
      ...summary,
      total_subtotal: toRupees(summary.total_subtotal),
      total_discount: toRupees(summary.total_discount),
      total_commission: toRupees(summary.total_commission),
      total_hamali: toRupees(summary.total_hamali),
      total_transport: toRupees(summary.total_transport),
      total_sales: toRupees(summary.total_sales),
      total_paid: toRupees(summary.total_paid),
      total_remaining: toRupees(summary.total_remaining),
      cash_collection: toRupees(summary.cash_collection),
      upi_collection: toRupees(summary.upi_collection),
      credit_sales: toRupees(summary.credit_sales),
      total_credit_outstanding: toRupees(totalOutstanding),
      total_customers_count: totalCustomersCount,
      total_vegetables_count: totalVegetablesCount,
      total_vegetables_volume: totalVegVolume,
    },
    bills,
    customers,
    credit_ledger: ledgerRows,
    vegetable_sales: vegSales,
    vegetable_catalog: vegCatalog,
  };
}

module.exports = {
  getSalesSummary,
  getCustomerPurchaseSummary,
  getVegetableSalesSummary,
  getCreditSummary,
  getCommissionSummary,
  getAllInOneReport,
};
