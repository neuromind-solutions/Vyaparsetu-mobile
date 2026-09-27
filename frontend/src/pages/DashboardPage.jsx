/**
 * DashboardPage — Vyapar/MyBillBook-Inspired Layout
 *
 * Layout:
 * 1. Greeting row (title + status badge + refresh)
 * 2. Quick Action Buttons (New Bill, Add Customer, Record Payment, Reports)
 * 3. Today's KPI Cards (Sales, Paid, Credit, Recovery, Commission, Bills)
 * 4. Overall Summary KPI row
 * 5. Two-column data grid (Recent Bills | Pending Udhar)
 * 6. Backup alert bar (slim, bottom)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';
import useDashboard from '../hooks/useDashboard';
import cloudSyncService from '../services/cloudSyncService';
import {
  AlertIcon,
  SaveIcon,
  ReceiptIcon,
  CheckIcon,
  ChartIcon,
  HistoryIcon,
  FileIcon,
  UsersIcon,
  LeafIcon,
} from '../components/Icons';

// ─── Quick Action Button ───────────────────────────────────────────────────────
function QuickActionBtn({ to, iconBg, icon, label }) {
  return (
    <Link to={to} className="quick-action-btn">
      <div className="quick-action-icon" style={{ background: iconBg }}>
        {icon}
      </div>
      <span className="quick-action-label">{label}</span>
    </Link>
  );
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ value, label, iconClass, icon }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon-box ${iconClass}`}>
        {icon}
      </div>
      <div className="kpi-content">
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data, loading, error, refetch } = useDashboard();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (cloudSyncService) {
        await cloudSyncService.syncNow();
      }
    } catch (err) {
      console.warn('Dashboard sync error:', err);
    } finally {
      await refetch();
      setRefreshing(false);
    }
  };

  const fmt = (val) => {
    const num = Number(val);
    return isNaN(num) ? '₹0' : `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  const fmtFull = (val) => {
    const num = Number(val);
    return isNaN(num) ? '₹ 0.00' : `₹ ${num.toFixed(2)}`;
  };

  const formatDateTime = (iso) => {
    if (!iso) return t('common.noData') || '—';
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (loading && !data) {
    return (
      <div className="flex flex-center" style={{ minHeight: '60vh', gap: 12 }}>
        <span className="spinner" />
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{t('common.loading')}</span>
      </div>
    );
  }

  const {
    todaySummary = {},
    overallSummary = {},
    recentBills = [],
    pendingCustomers = [],
    lastBackup = null,
    internetOnline = false,
    ledgerCheck = null,
  } = data || {};

  const statusBadgeColor = internetOnline ? 'var(--color-success)' : '#9ca3af';
  const statusBg = internetOnline ? 'var(--color-success-bg)' : 'var(--color-border-light)';

  return (
    <div style={{ animation: 'pageIn 0.2s ease' }}>

      {/* ── 1. Greeting Row ──────────────────────────────────────────────── */}
      <div className="dashboard-greeting">
        <div className="greeting-text">
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.subtitle')}</p>
        </div>

        <div className="greeting-actions">
          {/* Internet status */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '5px 12px', borderRadius: '20px',
              background: statusBg, color: statusBadgeColor,
              fontSize: '0.78rem', fontWeight: 600,
              border: `1px solid ${statusBadgeColor}20`,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: statusBadgeColor,
              animation: internetOnline ? 'pulse 2s infinite' : 'none',
              flexShrink: 0,
            }} />
            {internetOnline ? t('backup.online') : t('backup.offline')}
          </span>

          {/* Refresh button */}
          <button
            id="refresh-dashboard-btn"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 'var(--border-radius-sm)',
              border: '1.5px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.18s ease',
            }}
          >
            {loading || refreshing ? (
              <><span className="spinner" style={{ width: 13, height: 13 }} /> {t('common.loading')}</>
            ) : (
              <>↻ {t('dashboard.refreshStatus')}</>
            )}
          </button>
        </div>
      </div>

      {/* API Error */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--color-error-bg)', color: 'var(--color-error)',
          padding: '10px 16px', borderRadius: 'var(--border-radius-sm)',
          marginBottom: 18, fontSize: '0.85rem', fontWeight: 500,
          border: '1px solid #fecaca',
        }}>
          <AlertIcon style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* Udhar reconciliation warning.
          A customer's stored balance must equal the sum of their passbook. When it
          does not, the vendor must not read either figure out loud — so this sits
          above the KPIs rather than in the slim bar at the bottom. */}
      {ledgerCheck && ledgerCheck.ok === false && (
        <div style={{
          background: 'var(--color-error-bg)', color: 'var(--color-error)',
          padding: '12px 16px', borderRadius: 'var(--border-radius-sm)',
          marginBottom: 18, fontSize: '0.85rem',
          border: '1px solid #fecaca',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <AlertIcon style={{ flexShrink: 0 }} />
            {ledgerCheck.error
              ? t('dashboard.ledgerCheckFailed')
              : t('dashboard.ledgerMismatchTitle')}
          </div>

          {!ledgerCheck.error && (
            <>
              <div style={{ marginTop: 6, fontWeight: 500 }}>
                {t('dashboard.ledgerMismatchBody')}
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontWeight: 500 }}>
                {(ledgerCheck.mismatches || []).map((m) => (
                  <li key={m.id} style={{ marginBottom: 2 }}>
                    <strong>{m.name}</strong>
                    {' — '}
                    {t('dashboard.ledgerMismatchRow', {
                      stored: fmtFull(m.stored_balance).replace('₹ ', ''),
                      ledger: fmtFull(m.ledger_balance).replace('₹ ', ''),
                    })}
                  </li>
                ))}
                {ledgerCheck.mismatchCount > (ledgerCheck.mismatches || []).length && (
                  <li>
                    {t('dashboard.ledgerMismatchMore', {
                      count: ledgerCheck.mismatchCount - (ledgerCheck.mismatches || []).length,
                    })}
                  </li>
                )}
              </ul>
              <Link
                to="/udhar"
                style={{ display: 'inline-block', marginTop: 8, color: 'inherit', fontWeight: 700 }}
              >
                {t('nav.udhar')} →
              </Link>
            </>
          )}
        </div>
      )}

      {/* ── 2. Quick Actions (MyBillBook-style) ─────────────────────────── */}
      <div className="quick-actions-row">
        <QuickActionBtn
          to="/billing"
          iconBg="#dcfce7"
          icon={<ReceiptIcon style={{ color: '#16a34a', width: '20px', height: '20px' }} />}
          label={t('nav.billing')}
        />
        <QuickActionBtn
          to="/customers"
          iconBg="#dbeafe"
          icon={<UsersIcon style={{ color: '#2563eb', width: '20px', height: '20px' }} />}
          label={t('nav.customers')}
        />
        <QuickActionBtn
          to="/udhar"
          iconBg="#fef3c7"
          icon={<HistoryIcon style={{ color: '#d97706', width: '20px', height: '20px' }} />}
          label={t('nav.udhar')}
        />
        <QuickActionBtn
          to="/vegetables"
          iconBg="#f0fdf4"
          icon={<LeafIcon style={{ color: '#16a34a', width: '20px', height: '20px' }} />}
          label={t('nav.vegetables')}
        />
        <QuickActionBtn
          to="/reports"
          iconBg="#ede9fe"
          icon={<ChartIcon style={{ color: '#7c3aed', width: '20px', height: '20px' }} />}
          label={t('nav.reports')}
        />
      </div>

      {/* ── 3. Today's KPI Cards ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div className="section-title">
          <span>{t('dashboard.todaySummary')}</span>
          <div className="section-title-line" />
        </div>
        <div className="kpi-grid">
          <KpiCard
            value={fmt(todaySummary.totalSales)}
            label={t('dashboard.todaySales')}
            iconClass="kpi-icon-green"
            icon={<ReceiptIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={fmt(todaySummary.paidAmount)}
            label={t('dashboard.todayPaid')}
            iconClass="kpi-icon-teal"
            icon={<CheckIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={fmt(todaySummary.creditSales)}
            label={t('dashboard.todayCredit')}
            iconClass="kpi-icon-red"
            icon={<ChartIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={fmt(todaySummary.recoveryAmount)}
            label={t('dashboard.todayRecovery')}
            iconClass="kpi-icon-orange"
            icon={<HistoryIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={fmt(todaySummary.commission)}
            label={t('dashboard.todayCommission')}
            iconClass="kpi-icon-purple"
            icon={<SaveIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={todaySummary.totalBills || 0}
            label={t('dashboard.todayBills')}
            iconClass="kpi-icon-blue"
            icon={<FileIcon style={{ width: '20px', height: '20px' }} />}
          />
        </div>
      </div>

      {/* ── 4. Overall Summary KPIs ──────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div className="section-title">
          <span>{t('dashboard.overallSummary')}</span>
          <div className="section-title-line" />
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <KpiCard
            value={overallSummary.totalCustomers || 0}
            label={t('dashboard.totalCustomers')}
            iconClass="kpi-icon-blue"
            icon={<UsersIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={overallSummary.totalVegetables || 0}
            label={t('dashboard.totalVegetables')}
            iconClass="kpi-icon-green"
            icon={<LeafIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={fmt(overallSummary.totalUdhar)}
            label={t('dashboard.totalPendingUdhar')}
            iconClass="kpi-icon-red"
            icon={<ReceiptIcon style={{ width: '20px', height: '20px' }} />}
          />
          <KpiCard
            value={overallSummary.totalBills || 0}
            label={t('dashboard.totalBills')}
            iconClass="kpi-icon-purple"
            icon={<FileIcon style={{ width: '20px', height: '20px' }} />}
          />
        </div>
      </div>

      {/* ── 5. Data Grid: Recent Bills + Pending Udhar ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 24 }}>

        {/* Recent Bills */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <ReceiptIcon style={{ color: 'var(--color-primary)', width: '16px', height: '16px' }} />
              {t('dashboard.recentBills')}
            </h3>
            <Link to="/billing" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
              {t('common.viewAll') || 'View all'} →
            </Link>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="table-th">{t('dashboard.billNumber')}</th>
                  <th className="table-th">{t('dashboard.customer')}</th>
                  <th className="table-th" style={{ textAlign: 'right' }}>{t('dashboard.amount')}</th>
                  <th className="table-th">{t('dashboard.status')}</th>
                </tr>
              </thead>
              <tbody>
                {recentBills.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      {t('dashboard.noRecentBills')}
                    </td>
                  </tr>
                ) : (
                  recentBills.map((bill) => (
                    <tr key={bill.id} className="table-row">
                      <td className="table-cell" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                        {bill.bill_number}
                      </td>
                      <td className="table-cell" style={{ fontWeight: 500 }}>{bill.customer_name}</td>
                      <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right' }}>{fmtFull(bill.final_amount)}</td>
                      <td className="table-cell">
                        <span className={`badge badge-${
                          bill.payment_status === 'Paid' ? 'success'
                          : bill.payment_status === 'Partial' ? 'warning'
                          : 'error'
                        }`}>
                          {bill.payment_status === 'Paid'
                            ? t('billing.paymentTypePaid') || 'Paid'
                            : bill.payment_status === 'Partial'
                            ? t('billing.paymentTypePartial') || 'Partial'
                            : t('billing.paymentTypeCredit') || 'Credit'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending Udhar */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertIcon style={{ color: 'var(--color-error)', width: '16px', height: '16px' }} />
              {t('dashboard.pendingUdhar')}
            </h3>
            <Link to="/udhar" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
              {t('common.viewAll') || 'View all'} →
            </Link>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="table-th">{t('customers.name')}</th>
                  <th className="table-th">{t('customers.mobile')}</th>
                  <th className="table-th" style={{ textAlign: 'right' }}>{t('dashboard.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {pendingCustomers.length === 0 ? (
                  <tr>
                    <td colSpan="3" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      {t('dashboard.noPendingUdhar')}
                    </td>
                  </tr>
                ) : (
                  pendingCustomers.map((c) => (
                    <tr key={c.id} className="table-row">
                      <td className="table-cell" style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{c.mobile}</td>
                      <td className="table-cell" style={{ fontWeight: 700, color: 'var(--color-error)', textAlign: 'right' }}>
                        {fmtFull(c.credit_balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 6. Backup Status Bar (slim, bottom) ──────────────────────────── */}
      <div className={`backup-alert-bar${!lastBackup ? ' warning' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SaveIcon style={{ flexShrink: 0, width: '15px', height: '15px' }} />
          <span style={{ fontWeight: 600 }}>{t('backup.lastBackup')}:</span>
          <span style={{ fontWeight: 400, opacity: 0.85 }}>
            {lastBackup ? formatDateTime(lastBackup.createdAt) : t('common.noData')}
          </span>
        </div>
        {!lastBackup && (
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
            {t('settings.backupReminder') || 'Backup recommended!'}
          </span>
        )}
      </div>

    </div>
  );
}
