/**
 * CustomerLedgerModal
 * Shows the complete history of a customer:
 *   - Summary KPI cards (Total Billed, Total Paid, Outstanding)
 *   - Tabbed timeline: All | Invoices | Payments Received
 *   - Opening balance entry for a customer migrated from a paper notebook
 *   - WhatsApp share button (generates a text summary)
 */

import { useState, useEffect, useCallback } from 'react';
import { customersApi, creditApi, billsApi } from '../services/apiService';
import { useTranslation } from '../hooks/useTranslation';
import { displayAmount } from '../utils/creditLedger';
import {
  ReceiptIcon, PhoneIcon, MapPinIcon, AlertIcon,
  HistoryIcon, CheckIcon, ChartIcon, EyeIcon,
} from './Icons';
import ReceiptPrint from './ReceiptPrint';
import { sanitizeWhatsAppPhone, createWhatsAppShareUrl } from '../utils/whatsappShare';

// ─── Small Helpers ────────────────────────────────────────────────────────────
function fmt(val) {
  const n = Number(val || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    Paid:    { bg: 'var(--color-success-bg)', color: 'var(--color-success)',  label: 'Paid'    },
    Credit:  { bg: 'var(--color-error-bg)',   color: 'var(--color-error)',    label: 'Credit'  },
    Partial: { bg: '#fef3c7',                 color: '#d97706',               label: 'Partial' },
  };
  const s = map[status] || map.Credit;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────
function Tab({ label, active, count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '20px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '0.8rem',
        background: active ? 'var(--color-primary)' : 'var(--color-bg-light)',
        color: active ? '#fff' : 'var(--color-text-secondary)',
        transition: 'all 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{
          background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-border)',
          padding: '1px 6px',
          borderRadius: '10px',
          fontSize: '0.7rem',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function CustomerLedgerModal({ customerId, customerName, onClose, onLedgerChange }) {
  const { t } = useTranslation();
  const [ledger, setLedger]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]                 = useState('all'); // all | invoices | payments
  const [viewingBill, setViewingBill] = useState(null);

  // Opening-balance entry. Collapsed until the vendor asks for it, because it is a
  // once-per-customer migration step, not part of day-to-day work.
  const [obOpen, setObOpen]     = useState(false);
  const [obAmount, setObAmount] = useState('');
  const [obNote, setObNote]     = useState('');
  const [obSaving, setObSaving] = useState(false);
  const [obError, setObError]   = useState('');
  const [obDone, setObDone]     = useState('');

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await customersApi.getLedger(customerId);
      if (res.success) setLedger(res.data);
      else setError(res.error || 'Failed to load ledger');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  // A customer can only be opened once. The backend enforces it; this hides the
  // action so the vendor is never offered a button that can only fail.
  const hasOpeningBalance = Boolean(
    ledger?.transactions?.some((tx) => tx.transaction_type === 'OPENING_BALANCE')
  );

  async function handleOpeningBalanceSubmit(e) {
    e.preventDefault();
    const amount = Number(obAmount);
    if (!obAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setObError(t('credit.amountInvalid'));
      return;
    }

    setObSaving(true);
    setObError('');
    const res = await creditApi
      .recordOpeningBalance({ customer_id: customerId, amount, note: obNote.trim() })
      .catch((err) => ({ success: false, error: err.message }));
    setObSaving(false);

    if (!res.success) {
      setObError(res.error || t('common.error'));
      return;
    }

    setObOpen(false);
    setObAmount('');
    setObNote('');
    setObDone(t('credit.openingBalanceSuccess'));
    await fetchLedger();
    // The customers list shows credit_balance in its own column, so it has to be
    // refetched too or the vendor sees a stale zero behind this modal.
    if (onLedgerChange) onLedgerChange();
  }

  // ─── WhatsApp Share ────────────────────────────────────────────────────────
  function handleWhatsApp() {
    if (!ledger) return;
    const customer = ledger.customer || {};
    const bills = Array.isArray(ledger.bills) ? ledger.bills : [];
    const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
    const summary = ledger.summary || {
      totalBilled: 0,
      totalPaid: 0,
      totalRecovered: 0,
      outstanding: customer.credit_balance || 0,
    };
    const mobile = customer.mobile;

    const lines = [
      `📋 *Customer Ledger — ${customer.name || customerName || 'Customer'}*`,
      `📞 ${mobile}${customer.address ? ` | ${customer.address}` : ''}`,
      ``,
      `💰 *Summary*`,
      `  Total Billed: ${fmt(summary.totalBilled)}`,
      `  Total Paid:   ${fmt(summary.totalPaid)}`,
      `  Recovered:    ${fmt(summary.totalRecovered)}`,
      `  *Outstanding: ${fmt(summary.outstanding)}*`,
      ``,
    ];

    if (bills.length > 0) {
      lines.push(`🧾 *Invoices (${bills.length})*`);
      bills.slice(0, 10).forEach(b => {
        lines.push(`  ${fmtDate(b.date)} — ${b.bill_number} — ${fmt(b.final_amount)} [${b.payment_status}]`);
      });
      if (bills.length > 10) lines.push(`  ...and ${bills.length - 10} more invoices`);
      lines.push('');
    }

    const payments = transactions.filter(t => t.transaction_type === 'PAYMENT_RECEIVED');
    if (payments.length > 0) {
      lines.push(`✅ *Payments Received (${payments.length})*`);
      payments.slice(0, 8).forEach(p => {
        lines.push(`  ${fmtDate(p.created_at)} — ${fmt(p.amount)} via ${p.payment_mode}${p.note ? ` (${p.note})` : ''}`);
      });
      if (payments.length > 8) lines.push(`  ...and ${payments.length - 8} more payments`);
      lines.push('');
    }

    lines.push(`_Sent from VyapaarSetu_`);

    const text = lines.join('\n');
    const cleanPhone = sanitizeWhatsAppPhone(mobile);
    const url = createWhatsAppShareUrl(cleanPhone, text) || `https://api.whatsapp.com/send/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  // ─── Render Items Based on Tab ─────────────────────────────────────────────
  function renderContent() {
    if (loading) return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <span className="spinner" />
      </div>
    );

    if (error) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 20px', color: 'var(--color-error)' }}>
        <AlertIcon /> {error}
      </div>
    );

    if (!ledger) return null;

    const customer = ledger.customer || {};
    const bills = Array.isArray(ledger.bills) ? ledger.bills : [];
    const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
    const summary = ledger.summary || {
      totalBilled: 0,
      totalPaid: 0,
      totalRecovered: 0,
      outstanding: customer.credit_balance || 0,
    };
    const payments   = transactions.filter(t => t.transaction_type === 'PAYMENT_RECEIVED');
    const creditAdded = transactions.filter(t => t.transaction_type === 'CREDIT_ADDED');

    return (
      <>
        {/* ── Summary KPI Cards ───────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
          {[
            { label: 'Total Billed',  value: summary.totalBilled,    color: 'var(--color-primary)',  bg: 'var(--color-primary-light)' },
            { label: 'Total Paid',    value: summary.totalPaid,      color: 'var(--color-success)',  bg: 'var(--color-success-bg)'    },
            { label: 'Recovered',     value: summary.totalRecovered, color: '#16a34a',               bg: '#f0fdf4'                    },
            { label: 'Outstanding',   value: summary.outstanding,    color: 'var(--color-error)',    bg: 'var(--color-error-bg)'      },
          ].map(({ label, value, color, bg }) => (
            <div key={label} style={{ background: bg, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.5, color, fontWeight: 700, marginBottom: 4 }}>{label}</div>
              <div style={{ fontWeight: 800, color, fontSize: '0.95rem' }}>{fmt(value)}</div>
            </div>
          ))}
        </div>

        {/* ── Opening Balance (notebook migration) ────────────────────────── */}
        {/* Offered here rather than on the Udhar page because that page only lists
            customers who already owe something — a customer whose only debt is the
            one about to be entered would not appear on it at all. */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--color-border)' }}>
          {obDone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--color-success)', fontWeight: 600, marginBottom: obOpen ? 8 : 0 }}>
              <CheckIcon style={{ width: 13, height: 13 }} /> {obDone}
            </div>
          )}

          {hasOpeningBalance ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {t('credit.openingBalanceAlreadySet')}
            </div>
          ) : obOpen ? (
            <form onSubmit={handleOpeningBalanceSubmit} noValidate>
              <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {t('credit.openingBalanceHelp')}
              </p>

              {obError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--color-error)', marginBottom: 8 }}>
                  <AlertIcon style={{ width: 13, height: 13, flexShrink: 0 }} /> {obError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', width: 150 }}>
                  <span style={{ position: 'absolute', left: 10, top: 8, fontWeight: 600, color: 'var(--color-text-secondary)' }}>₹</span>
                  <input
                    type="number"
                    className={`form-input${obError ? ' input-error' : ''}`}
                    value={obAmount}
                    min="0.01"
                    step="0.01"
                    autoFocus
                    placeholder="0.00"
                    style={{ paddingLeft: 24 }}
                    onChange={(e) => { setObAmount(e.target.value); if (obError) setObError(''); }}
                  />
                </div>
                <input
                  type="text"
                  className="form-input"
                  value={obNote}
                  placeholder={t('credit.openingBalanceNotePlaceholder')}
                  style={{ flex: 1, minWidth: 180 }}
                  onChange={(e) => setObNote(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={obSaving} style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
                  {obSaving ? t('common.loading') : t('common.save')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={obSaving}
                  style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                  onClick={() => { setObOpen(false); setObError(''); setObAmount(''); setObNote(''); }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => { setObOpen(true); setObDone(''); }}
              style={{ padding: '4px 12px', fontSize: '0.78rem' }}
            >
              + {t('credit.setOpeningBalance')}
            </button>
          )}
        </div>

        {/* ── Filter Tabs ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
          <Tab label="All History"       active={tab === 'all'}      count={bills.length + transactions.length} onClick={() => setTab('all')} />
          <Tab label="Invoices"          active={tab === 'invoices'} count={bills.length}   onClick={() => setTab('invoices')} />
          <Tab label="Payments Received" active={tab === 'payments'} count={payments.length} onClick={() => setTab('payments')} />
          <Tab label="Credit Added"      active={tab === 'credits'}  count={creditAdded.length} onClick={() => setTab('credits')} />
        </div>

        {/* ── Timeline ────────────────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', maxHeight: 380, padding: '8px 0' }}>
          {tab === 'all' && renderAllTimeline(bills, transactions)}
          {tab === 'invoices' && renderInvoices(bills)}
          {tab === 'payments' && renderTransactions(payments, 'PAYMENT_RECEIVED')}
          {tab === 'credits' && renderTransactions(creditAdded, 'CREDIT_ADDED')}
        </div>
      </>
    );
  }

  function renderAllTimeline(bills, transactions) {
    // Merge bills and transactions into a single timeline sorted by date desc
    const items = [
      ...bills.map(b => ({ _type: 'bill', _date: b.date + 'T00:00:00', ...b })),
      ...transactions.map(t => ({ _type: 'tx', _date: t.created_at, ...t })),
    ].sort((a, b) => new Date(b._date) - new Date(a._date));

    const handleViewBill = async (billSummary) => {
      try {
        const res = await billsApi.getById(billSummary.id);
        if (res?.success && res.data) {
          setViewingBill(res.data);
          return;
        }
      } catch (err) {
        console.error('Failed to fetch full bill details:', err);
      }
      setViewingBill(billSummary);
    };

    if (items.length === 0) return <EmptyState label="No history found for this customer." />;
    return items.map((item) => (
      item._type === 'bill'
        ? <BillRow key={`b-${item.id}`} bill={item} onView={handleViewBill} />
        : <TxRow key={`t-${item.id}`} tx={item} />
    ));
  }

  function renderInvoices(bills) {
    const handleViewBill = async (billSummary) => {
      try {
        const res = await billsApi.getById(billSummary.id);
        if (res?.success && res.data) {
          setViewingBill(res.data);
          return;
        }
      } catch (err) {
        console.error('Failed to fetch full bill details:', err);
      }
      setViewingBill(billSummary);
    };

    if (bills.length === 0) return <EmptyState label="No invoices found." />;
    return bills.map(b => <BillRow key={b.id} bill={b} onView={handleViewBill} />);
  }

  function renderTransactions(txs, type) {
    if (txs.length === 0) return <EmptyState label={type === 'PAYMENT_RECEIVED' ? 'No payments received yet.' : 'No credit added yet.'} />;
    return txs.map(t => <TxRow key={t.id} tx={t} />);
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        id="customer-ledger-modal"
        style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', maxHeight: '90vh', padding: 0, overflow: 'hidden' }}
      >
        {/* ── Modal Header ──────────────────────────────────────────────── */}
        <div className="modal-header" style={{ padding: '14px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HistoryIcon style={{ color: 'var(--color-primary)', width: 20, height: 20, flexShrink: 0 }} />
            <div>
              <h2 className="modal-title" style={{ margin: 0, fontSize: '1rem' }}>
                {customerName} — Full Ledger
              </h2>
              {ledger && (
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PhoneIcon style={{ width: 12, height: 12 }} /> {ledger.customer.mobile}
                  {ledger.customer.address && (
                    <><MapPinIcon style={{ width: 12, height: 12, marginLeft: 6 }} /> {ledger.customer.address}</>
                  )}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* WhatsApp Share Button */}
            <button
              onClick={handleWhatsApp}
              disabled={!ledger}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 'var(--border-radius-sm)',
                background: '#25d366', color: '#fff',
                border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.8rem',
                opacity: ledger ? 1 : 0.5,
                transition: 'all 0.15s ease',
              }}
              title="Share customer ledger on WhatsApp"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M20.52 3.449A11.885 11.885 0 0 0 11.993 0C5.45 0 .105 5.335.102 11.893a11.86 11.86 0 0 0 1.587 5.946L0 24l6.305-1.654a11.882 11.882 0 0 0 5.688 1.448h.005c6.54 0 11.886-5.335 11.889-11.893A11.866 11.866 0 0 0 20.52 3.449zM11.993 21.785a9.855 9.855 0 0 1-5.03-1.378l-.36-.214-3.742.98.999-3.648-.235-.374A9.86 9.86 0 0 1 2.1 11.893c.002-5.445 4.436-9.876 9.897-9.876a9.836 9.836 0 0 1 6.999 2.903 9.851 9.851 0 0 1 2.892 6.99c-.002 5.446-4.437 9.875-9.895 9.875zm5.428-7.386c-.297-.148-1.758-.867-2.03-.967-.273-.099-.472-.148-.671.15-.198.297-.768.967-.942 1.165-.173.198-.347.223-.644.075-.297-.148-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.654-2.059-.173-.297-.018-.457.13-.605.134-.133.297-.347.446-.521.149-.173.198-.297.297-.495.099-.198.05-.373-.025-.521-.075-.148-.671-1.612-.92-2.208-.242-.579-.487-.5-.671-.51-.173-.008-.373-.01-.572-.01-.198 0-.521.074-.794.372-.273.297-1.04 1.016-1.04 2.479s1.065 2.876 1.213 3.074c.148.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.123-.273-.198-.571-.347z"/>
              </svg>
              WhatsApp
            </button>
            <button className="modal-close-btn" onClick={onClose} id="ledger-modal-close">✕</button>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {renderContent()}
        </div>
      </div>

      {/* ── Direct Invoice Viewer ────────────────────────────────────────── */}
      {viewingBill && (
        <ReceiptPrint
          isOpen={Boolean(viewingBill)}
          onClose={() => setViewingBill(null)}
          bill={viewingBill}
        />
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function EmptyState({ label }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
      <HistoryIcon style={{ width: 28, height: 28, marginBottom: 10, opacity: 0.35 }} />
      <p style={{ margin: 0 }}>{label}</p>
    </div>
  );
}

function BillRow({ bill, onView }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto auto auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 20px',
        borderBottom: '1px solid var(--color-border-light)',
        transition: 'background 0.1s',
        cursor: 'pointer',
      }}
      onClick={() => onView && onView(bill)}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-light)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Date */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        <div style={{ fontWeight: 600 }}>{new Date(bill.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
        <div>{new Date(bill.date).getFullYear()}</div>
      </div>

      {/* Description */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ReceiptIcon style={{ width: 14, height: 14, color: 'var(--color-primary)', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>{bill.bill_number}</span>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
          Invoice • {bill.payment_type}
          {Number(bill.remaining_amount) > 0 && (
            <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>Pending: ₹{Number(bill.remaining_amount).toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>
          {fmt(bill.final_amount)}
        </div>
        {Number(bill.paid_amount) > 0 && Number(bill.paid_amount) < Number(bill.final_amount) && (
          <div style={{ fontSize: '0.7rem', color: 'var(--color-success)' }}>Paid: {fmt(bill.paid_amount)}</div>
        )}
      </div>

      {/* Status */}
      <StatusBadge status={bill.payment_status} />

      {/* View Action Icon */}
      <button
        type="button"
        className="btn-icon"
        onClick={(e) => {
          e.stopPropagation();
          if (onView) onView(bill);
        }}
        title="View Invoice"
        style={{
          background: 'var(--color-primary-light)',
          color: 'var(--color-primary)',
          border: 'none',
          padding: '4px 6px',
          cursor: 'pointer',
        }}
      >
        <EyeIcon style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}

function TxRow({ tx }) {
  const isPayment  = tx.transaction_type === 'PAYMENT_RECEIVED';
  const isDiscount = tx.transaction_type === 'DISCOUNT';
  const isCredit   = tx.transaction_type === 'CREDIT_ADDED';
  const isOpening  = tx.transaction_type === 'OPENING_BALANCE';
  const color      = isPayment ? 'var(--color-success)' : isDiscount ? '#059669' : (isCredit || isOpening) ? 'var(--color-error)' : 'var(--color-text-secondary)';
  const bg         = isPayment ? 'var(--color-success-bg)' : isDiscount ? '#ecfdf5' : (isCredit || isOpening) ? 'var(--color-error-bg)' : 'var(--color-bg-light)';
  // Named explicitly rather than falling through to "Adjustment": the vendor needs to
  // be able to tell debt carried over from the notebook apart from a correction they
  // made, and those two read very differently when a customer disputes a balance.
  const label      = isPayment ? 'Payment Received' : isDiscount ? 'Discount' : isCredit ? 'Credit Added' : isOpening ? 'Opening Balance' : 'Adjustment';
  // Sign and magnitude derived from the same signed amount, so a written-off adjustment
  // reads −₹500.00 rather than the +₹-500.00 a type-based sign produced.
  const { sign, magnitude } = displayAmount(tx.transaction_type, tx.amount);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 20px',
        borderBottom: '1px solid var(--color-border-light)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-light)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Date */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        <div style={{ fontWeight: 600 }}>
          {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </div>
        <div>{new Date(tx.created_at).getFullYear()}</div>
      </div>

      {/* Description */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 18, height: 18, borderRadius: '50%',
            background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {isPayment
              ? <CheckIcon style={{ width: 10, height: 10, color }} />
              : <ChartIcon style={{ width: 10, height: 10, color }} />
            }
          </span>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color }}>{label}</span>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
          {tx.payment_mode && <span>{tx.payment_mode}</span>}
          {tx.bill_number && <span style={{ marginLeft: 4 }}>• {tx.bill_number}</span>}
          {tx.note && <span style={{ marginLeft: 4 }}>• {tx.note.replace(/\[(Desktop|Mobile|Supabase):[^\]]*\]/g, '').trim()}</span>}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color }}>
        {sign}{fmt(magnitude)}
      </div>

      {/* Balance after */}
      <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Balance</div>
        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{fmt(tx.balance_after_transaction)}</div>
      </div>
    </div>
  );
}
