/**
 * BillingPage — the bill archive.
 *
 * Read-only by design. Bills are *generated* on the Transactions page from the
 * entries actually logged during the day; nothing is authored here. This page
 * exists to find a past bill, open it, re-print / download / WhatsApp it, and
 * void one that was made in error.
 *
 * Why there is no "New Invoice" and no "Edit":
 *   - A manual cart bill duplicates goods that are already logged as transactions,
 *     and it books the credit a second time (billModel.create defaults to
 *     bookCredit: true), so the customer's outstanding silently doubles.
 *   - billModel.update replaces bill_items wholesale and the edit payload carries
 *     no item_date, so editing a range bill destroys its datewise breakdown. Worse,
 *     `originatedOwnCredit` is false for a transaction-derived bill, so editing
 *     paid_amount moves the bill to "Paid" while the customer's credit_balance
 *     stays exactly where it was — the bill and the Udhar ledger disagree.
 *
 * Mistakes are corrected at the source instead, which is already safe end to end:
 * delete the bill (billModel.remove returns its transactions to unbilled and
 * reverses only the credit the bill itself booked) → delete or re-enter the wrong
 * transaction → generate the bill again. Payments are recorded on the Udhar page,
 * which writes a real PAYMENT_RECEIVED ledger row.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBills } from '../hooks/useBills';
import { useTranslation } from '../hooks/useTranslation';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import ReceiptPrint from '../components/ReceiptPrint';
import BillModal from '../components/BillModal';
import MarathiInput from '../components/MarathiInput';
import { formatBillPeriod, isPeriodBill } from '../utils/billDisplay';
import {
  ReceiptIcon, SearchIcon, AlertIcon, HistoryIcon,
  EyeIcon, TrashIcon, CheckIcon, ChartIcon, CalendarIcon, EditIcon
} from '../components/Icons';

function hasDevanagari(str) { return /[\u0900-\u097F]/.test(str); }
function isAscii(str) {
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 127) return false;
  return true;
}

function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${type}`} id="toast-notification">
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">✕</button>
    </div>
  );
}

const STATUS_FILTERS = ['All', 'Paid', 'Credit', 'Partial'];

export default function BillingPage() {
  const { t, language } = useTranslation();
  const {
    bills,
    allBills,
    loading,
    loaded,
    error,
    searchQuery,
    setSearchQuery,
    dateFilterType,
    setDateFilterType,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    deleteBill,
    updateBill,
  } = useBills();
  const isMarathi = language === 'mr';

  const [activeFilter, setActiveFilter]     = useState('All');
  const [deleteTarget, setDeleteTarget]     = useState(null);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [printTarget, setPrintTarget]       = useState(null);
  const [editingBill, setEditingBill]       = useState(null);
  const [toast, setToast]                   = useState({ message: '', type: 'success' });

  const [searchParams, setSearchParams] = useSearchParams();

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 3500);
  }

  const openDelete = useCallback((b) => setDeleteTarget(b), []);
  const openView   = useCallback((b) => setPrintTarget(b), []);

  async function handleUpdateBill(payload) {
    if (!editingBill) return { success: false, error: 'No bill selected' };
    const res = await updateBill(editingBill.id, payload);
    if (res?.success) {
      showToast(t('billing.billUpdated') || 'बिल यशस्वीरित्या बदलले');
      setEditingBill(null);
    }
    return res;
  }

  /**
   * `?bill=<id>` opens that bill's viewer straight away.
   *
   * This is where the history table's bill badge lands. The vendor clicked a bill number
   * because they want to look at the bill, so showing them a filtered list would just be
   * a second click — ReceiptPrint is the viewer *and* holds Print / PDF / WhatsApp.
   *
   * Matched against `allBills` rather than the rendered `bills`, so a search box left
   * filtering from a previous visit cannot hide the target. The param is cleared once
   * handled, which is also what stops the modal reopening every time it is closed.
   */
  useEffect(() => {
    const wanted = searchParams.get('bill');
    if (!wanted) return;
    // Wait for the archive to actually be read before concluding anything about it.
    if (!loaded) return;

    const match = allBills.find((b) => String(b.id) === String(wanted));
    if (match) {
      setPrintTarget(match);
    } else {
      // Deleted in another window, or a stale link. Say so — the alternative is a click
      // that appears to do nothing at all.
      showToast(t('billing.billNotFound'), 'error');
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, allBills, loaded, t]);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const res = await deleteBill(deleteTarget.id);
    setDeleteLoading(false);
    if (res.success) { showToast(t('billing.deleteSuccess')); setDeleteTarget(null); }
    else showToast(res.error || t('common.error'), 'error');
  }

  // ─── Computed stats ────────────────────────────────────────────────────────
  const totalAmount   = bills.reduce((s, b) => s + Number(b.final_amount || 0), 0);
  const paidAmount    = bills.reduce((s, b) => s + (b.payment_status === 'Paid' ? Number(b.final_amount || 0) : Number(b.paid_amount || 0)), 0);
  const pendingAmount = bills.reduce((s, b) => s + Number(b.remaining_amount || 0), 0);

  // ─── Filter counts ─────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    All:     bills.length,
    Paid:    bills.filter(b => b.payment_status === 'Paid').length,
    Credit:  bills.filter(b => b.payment_status === 'Credit').length,
    Partial: bills.filter(b => b.payment_status === 'Partial').length,
  }), [bills]);

  // ─── Filtered bills ────────────────────────────────────────────────────────
  const filteredBills = useMemo(() =>
    activeFilter === 'All' ? bills : bills.filter(b => b.payment_status === activeFilter),
  [bills, activeFilter]);

  return (
    <div className="billing-page" style={{ animation: 'pageIn 0.2s ease' }}>
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      {/* ── Page Header ───────────────────────────────────────────────────────
          No "New Invoice" action: bills come from logged transactions, never from
          this page. See the header comment. */}
      <div className="page-header-bar">
        <div>
          <h1 className="page-title">{t('billing.title')}</h1>
          <p className="page-desc">{t('billing.subtitle')}</p>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-blue">
            <ReceiptIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{bills.length}</div>
            <div className="kpi-label">{t('billing.totalBills')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-green">
            <CheckIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-label">{t('billing.totalRevenue')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-teal">
            <ChartIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{paidAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-label">{t('billing.paid') || 'Amount Paid'}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-red">
            <HistoryIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{pendingAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-label">{t('billing.unpaidAmount')}</div>
          </div>
        </div>
      </div>

      {/* ── Filter Tabs (Vyapar-style) ─────────────────────────────────────── */}
      <div className="filter-tabs">
        {STATUS_FILTERS.map(status => (
          <button
            key={status}
            className={`filter-tab${activeFilter === status ? ' active' : ''}`}
            onClick={() => setActiveFilter(status)}
          >
            {status === 'All' ? t('common.all') || 'All'
              : status === 'Paid' ? t('billing.paymentTypePaid') || 'Paid'
              : status === 'Credit' ? t('billing.paymentTypeCredit') || 'Unpaid'
              : t('billing.paymentTypePartial') || 'Partial'}
            <span className="filter-tab-count">{counts[status]}</span>
          </button>
        ))}
      </div>

      {/* ── Date & Period Filter Bar ────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '0.85rem 1.1rem',
          marginBottom: '1rem',
          background: 'var(--color-bg-light)',
          border: '1px solid var(--color-border-copper)',
          borderRadius: 'var(--border-radius)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.85rem' }}>
            <CalendarIcon style={{ width: '18px', height: '18px', color: 'var(--color-primary)' }} />
            <span>{t('billing.dateFilter.customRange') || 'Filter by Date'}:</span>
          </div>

          <div className="date-presets-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            {[
              { key: 'all',       label: t('billing.dateFilter.all')       || 'All Time'   },
              { key: 'today',     label: t('billing.dateFilter.today')     || 'Today'      },
              { key: 'yesterday', label: t('billing.dateFilter.yesterday') || 'Yesterday'  },
              { key: 'week',      label: t('billing.dateFilter.thisWeek')  || 'This Week'  },
              { key: 'month',     label: t('billing.dateFilter.thisMonth') || 'This Month' },
              { key: 'range',     label: t('billing.dateFilter.customRange') || 'Custom Range' },
            ].map(({ key, label }) => {
              const active = dateFilterType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDateFilterType(key)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 'var(--border-radius-pill)',
                    border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border-copper)',
                    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: active ? '#ffffff' : 'var(--color-text-secondary)',
                    fontSize: '0.8rem',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {dateFilterType === 'range' && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '0.75rem',
              paddingTop: '0.75rem',
              borderTop: '1px dashed #cbd5e1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>
                {t('billing.dateFilter.startDate') || 'Start Date'}:
              </label>
              <input
                type="date"
                className="input-field"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>
                {t('billing.dateFilter.endDate') || 'End Date'}:
              </label>
              <input
                type="date"
                className="input-field"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Search Bar ────────────────────────────────────────────────────── */}
      <div className="search-bar-container">
        <div className={`search-bar${searchQuery && hasDevanagari(searchQuery) ? ' marathi-mode' : ''}`}>
          <span className="search-icon"><SearchIcon /></span>
          <MarathiInput
            id="bill-search-input"
            variant="search"
            placeholder={`${t('billing.billNumber')}, ${t('billing.customer')}...`}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {searchQuery && isAscii(searchQuery) && <span className="search-marathi-badge">अ</span>}
          {searchQuery && <button className="search-clear-btn" onClick={() => setSearchQuery('')}>✕</button>}
        </div>
        {searchQuery && (
          <div className="search-hint">
            {t('transliteration.searchingFor')} <strong>"{searchQuery}"</strong>
            &nbsp;—&nbsp;{filteredBills.length} {t('common.noData').includes('No') ? 'result(s)' : 'निकाल'}
          </div>
        )}
      </div>

      {/* ── Bills Table ───────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {error && !loading && (
          <div className="table-error" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px' }}>
            <AlertIcon /> {error}
          </div>
        )}
        {loading && <div className="table-message"><span className="spinner" style={{ margin: 'auto' }} /></div>}

        {!loading && !error && filteredBills.length === 0 && (
          <div className="table-message">
            <div style={{ marginBottom: 10 }}>
              <ReceiptIcon style={{ width: '2rem', height: '2rem', color: 'var(--color-text-muted)' }} />
            </div>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              {searchQuery ? t('billing.noSearchResults')
                : activeFilter !== 'All' ? t('billing.noBillsFiltered')
                : t('billing.noBills')}
            </p>
            {!searchQuery && activeFilter === 'All' && (
              /* Tell the vendor where bills actually come from. Landing on an empty
                 archive with no next step is what made this page feel purposeless. */
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
                {t('billing.noBillsHint')}
              </p>
            )}
          </div>
        )}

        {!loading && !error && filteredBills.length > 0 && (
          <div className="table-wrapper">
            <table className="data-table" id="bills-table">
              <thead>
                <tr>
                  <th className="table-th">{t('billing.billNumber')}</th>
                  <th className="table-th">{t('billing.customer')}</th>
                  <th className="table-th">{t('billing.date')}</th>
                  <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.total')}</th>
                  <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.paid')}</th>
                  <th className="table-th">{t('billing.status')}</th>
                  <th className="table-th">{t('billing.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBills.map((bill) => (
                  <tr className="table-row" key={bill.id} id={`bill-row-${bill.id}`}>
                    <td className="table-cell" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                      {bill.bill_number}
                    </td>
                    <td className="table-cell">
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{bill.customer_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{bill.customer_mobile}</div>
                    </td>
                    {/* A range bill stores its span in period_start/period_end and is
                        dated the day the period closes. Printing bill.date alone made a
                        week-long bill look identical to a single-day one, so there was no
                        way to find "the bill covering the 1st to the 14th" by looking. */}
                    <td className="table-cell" style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatBillPeriod(bill, isMarathi)}
                      {isPeriodBill(bill) && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {t('billing.period')}
                        </div>
                      )}
                    </td>
                    <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right' }}>
                      ₹{Number(bill.final_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)', fontWeight: 600 }}>
                      ₹{Number(bill.paid_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="table-cell">
                      <span className={`badge badge-${bill.payment_status === 'Paid' ? 'success' : bill.payment_status === 'Partial' ? 'warning' : 'error'}`}>
                        {t(`billing.status${bill.payment_status}`)}
                      </span>
                    </td>
                    <td className="table-cell">
                      {/* View opens ReceiptPrint, which is the bill viewer *and* holds
                          Print / Download PDF / WhatsApp. A separate row-level Print
                          button led to the same modal and the same second click, so it
                          was pure duplication. */}
                      <div className="action-btns">
                        <button className="btn-icon" onClick={() => openView(bill)} title={t('billing.viewBill')} id={`view-btn-${bill.id}`} style={{ background: 'var(--color-success-bg)' }}>
                          <EyeIcon style={{ color: 'var(--color-success)' }} />
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => setEditingBill(bill)}
                          title={t('billing.editBill') || t('common.edit') || 'बदला'}
                          id={`edit-btn-${bill.id}`}
                          style={{ background: 'var(--color-primary-light, #e0f2fe)' }}
                        >
                          <EditIcon style={{ color: 'var(--color-primary, #0284c7)' }} />
                        </button>
                        <button className="btn-icon btn-icon-delete" onClick={() => openDelete(bill)} title={t('common.delete')} id={`delete-btn-${bill.id}`}>
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <ReceiptPrint
        isOpen={Boolean(printTarget)}
        onClose={() => setPrintTarget(null)}
        bill={printTarget}
        onEdit={(b) => {
          setPrintTarget(null);
          setEditingBill(b);
        }}
      />
      <BillModal
        isOpen={Boolean(editingBill)}
        onClose={() => setEditingBill(null)}
        bill={editingBill}
        onSubmit={handleUpdateBill}
      />
      <DeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title={t('billing.deleteConfirmTitle')}
        message={`${t('billing.deleteConfirmMsg')} "${deleteTarget?.bill_number}"?`}
        subMessage={t('billing.deleteConfirmNote')}
      />
    </div>
  );
}
