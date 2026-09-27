const { execSelect } = require('../database/db');
const { toRupees, rowToRupees } = require('../utils/money');
const backupService = require('./backupService');
const creditModel = require('../models/creditModel');
const logger = require('../utils/logger');
const { localDateSql, todayLocal } = require('../utils/businessDay');

async function getDashboardSummary() {
  const todayStr = todayLocal();

  // ─── Today's Summary (SQL aggregations) ──────────────────────────────────────
  // Today's total sales, bills, paid, credit, and commission
  const todayBillsRes = execSelect(
    `SELECT 
      COALESCE(SUM(final_amount), 0.0) AS total_sales,
      COUNT(id) AS total_bills,
      COALESCE(SUM(paid_amount), 0.0) AS total_paid,
      COALESCE(SUM(remaining_amount), 0.0) AS total_credit,
      COALESCE(SUM(commission_amount), 0.0) AS total_commission
     FROM bills 
     WHERE date = ?`,
    [todayStr]
  );
  
  const todayBills = todayBillsRes[0] || {
    total_sales: 0.0,
    total_bills: 0,
    total_paid: 0.0,
    total_credit: 0.0,
    total_commission: 0.0,
  };

  let totalSalesPaise = Number(todayBills.total_sales || 0);
  let totalBillsCount = Number(todayBills.total_bills || 0);
  let totalPaidPaise = Number(todayBills.total_paid || 0);
  let totalCreditPaise = Number(todayBills.total_credit || 0);
  let totalCommissionPaise = Number(todayBills.total_commission || 0);

  // If no bills generated yet today, aggregate from today's transactions
  if (totalBillsCount === 0) {
    const todayTxRes = execSelect(
      `SELECT 
        COALESCE(SUM(final_amount), 0.0) AS total_sales,
        COUNT(id) AS total_tx,
        COALESCE(SUM(paid_amount), 0.0) AS total_paid,
        COALESCE(SUM(remaining_amount), 0.0) AS total_credit,
        COALESCE(SUM(commission_amount), 0.0) AS total_commission
       FROM transactions
       WHERE transaction_date = ?`,
      [todayStr]
    );
    const txRow = todayTxRes[0];
    if (txRow && Number(txRow.total_tx || 0) > 0) {
      totalSalesPaise = Number(txRow.total_sales || 0);
      totalBillsCount = Number(txRow.total_tx || 0);
      totalPaidPaise = Number(txRow.total_paid || 0);
      totalCreditPaise = Number(txRow.total_credit || 0);
      totalCommissionPaise = Number(txRow.total_commission || 0);
    }
  }

  // Today's credit recovery (payments collected). PAYMENT_RECEIVED only, matching
  // creditModel.getSummary's todayRecovered — this sits beside the day's cash and UPI
  // figures, so it means money that came in, not any row that reduced a balance.
  const todayRecoveryRes = execSelect(
    `SELECT COALESCE(SUM(amount), 0.0) AS total_recovery
     FROM credit_transactions
     WHERE transaction_type = 'PAYMENT_RECEIVED'
       AND ${localDateSql('created_at')} = ?`,
    [todayStr]
  );
  const totalRecovery = todayRecoveryRes[0]?.total_recovery || 0.0;

  const todaySummary = {
    totalSales: Number(toRupees(totalSalesPaise).toFixed(2)),
    totalBills: totalBillsCount,
    paidAmount: Number(toRupees(totalPaidPaise).toFixed(2)),
    creditSales: Number(toRupees(totalCreditPaise).toFixed(2)),
    recoveryAmount: Number(toRupees(totalRecovery).toFixed(2)),
    commission: Number(toRupees(totalCommissionPaise).toFixed(2)),
    date: todayStr,
  };

  // ─── Overall Summary (SQL aggregations) ─────────────────────────────────────
  const totalCustomersRes = execSelect('SELECT COUNT(*) AS count FROM customers');
  const totalVegetablesRes = execSelect('SELECT COUNT(*) AS count FROM vegetables');
  const totalUdharRes = execSelect('SELECT COALESCE(SUM(credit_balance), 0.0) AS total_udhar FROM customers');
  const totalBillsRes = execSelect('SELECT COUNT(*) AS count FROM bills');

  const overallSummary = {
    totalCustomers: Number(totalCustomersRes[0]?.count || 0),
    totalVegetables: Number(totalVegetablesRes[0]?.count || 0),
    totalUdhar: Number(toRupees(totalUdharRes[0]?.total_udhar || 0).toFixed(2)),
    totalBills: Number(totalBillsRes[0]?.count || 0),
  };

  // ─── Recent Bills (limit 5) ──────────────────────────────────────────────────
  let recentBills = execSelect(
    `SELECT b.*, c.name AS customer_name, c.mobile AS customer_mobile
     FROM bills b
     JOIN customers c ON b.customer_id = c.id
     ORDER BY b.date DESC, b.id DESC
     LIMIT 5`
  ).map((b) => rowToRupees(b, 'bills'));

  if (recentBills.length === 0) {
    recentBills = execSelect(
      `SELECT t.id, t.final_amount, t.paid_amount, t.remaining_amount, t.payment_type, t.transaction_date AS date,
              c.name AS customer_name, c.mobile AS customer_mobile,
              'TX-' || t.id AS bill_number,
              CASE WHEN t.remaining_amount = 0 THEN 'Paid' WHEN t.paid_amount > 0 THEN 'Partial' ELSE 'Credit' END AS payment_status
       FROM transactions t
       JOIN customers c ON t.customer_id = c.id
       ORDER BY t.transaction_date DESC, t.id DESC
       LIMIT 5`
    ).map((t) => rowToRupees(t, 'bills'));
  }

  // ─── Pending Credit Customers (limit 5, sorted descending by balance) ─────────
  const pendingCustomers = execSelect(
    `SELECT id, name, mobile, credit_balance
     FROM customers
     WHERE credit_balance > 0
     ORDER BY credit_balance DESC, name ASC
     LIMIT 5`
  ).map((c) => rowToRupees(c, 'customers'));

  // ─── Backup and Connection Status ───────────────────────────────────────────
  // Run both checks in parallel and cap internet probe at 2 s so a slow/absent
  // network never stalls the dashboard past the axios timeout.
  const internetWithTimeout = () =>
    Promise.race([
      backupService.checkInternetStatus(),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

  let lastBackup = null;
  let internetOnline = false;
  try {
    [lastBackup, internetOnline] = await Promise.all([
      backupService.getLatestBackupStatus().catch(() => null),
      internetWithTimeout().catch(() => false),
    ]);
  } catch (err) {
    /* ignore status errors — dashboard should still render */
  }

  // ─── Ledger Reconciliation ──────────────────────────────────────────────────
  // Every customer's stored balance must equal the sum of their passbook. If it
  // does not, the vendor is holding two different answers to "how much is owed"
  // and needs to know before quoting either one — silence here is how a rounding
  // bug turns into a disputed settlement weeks later.
  const ledgerCheck = { ok: true, mismatchCount: 0, mismatches: [] };
  try {
    const mismatches = creditModel.findBalanceMismatches();
    ledgerCheck.ok = mismatches.length === 0;
    ledgerCheck.mismatchCount = mismatches.length;
    ledgerCheck.mismatches = mismatches.slice(0, 5); // report the full count, show a few
    if (mismatches.length > 0) {
      logger.error(
        `Ledger reconciliation failed for ${mismatches.length} customer(s): ` +
          mismatches
            .slice(0, 5)
            .map((m) => `#${m.id} ${m.name} stored ${m.stored_balance} vs ledger ${m.ledger_balance}`)
            .join('; ')
      );
    }
  } catch (err) {
    // A check that cannot run must not read as a clean bill of health.
    ledgerCheck.ok = false;
    ledgerCheck.error = 'Reconciliation check could not run';
    logger.error(`Ledger reconciliation check failed to run: ${err.message}`);
  }

  return {
    todaySummary,
    overallSummary,
    recentBills,
    pendingCustomers,
    lastBackup,
    internetOnline,
    ledgerCheck,
  };
}

module.exports = {
  getDashboardSummary,
};
