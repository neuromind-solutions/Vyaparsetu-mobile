/**
 * UdharPage — Vyapar Receivables-style
 * KPI icon cards + enhanced two-panel customer ledger
 */

import { useState, useEffect, useRef } from 'react';
import { useCredit } from '../hooks/useCredit';
import { useTranslation } from '../hooks/useTranslation';
import { splitSigned, displayAmount } from '../utils/creditLedger';
import { formatDDMMYYYY } from '../utils/dates';
import MarathiInput from '../components/MarathiInput';
import {
  ReceiptIcon, AlertIcon, ChartIcon, HistoryIcon, CheckIcon,
  SearchIcon, UsersIcon, PhoneIcon, MapPinIcon
} from '../components/Icons';

function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${type}`} id="toast-notification">
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">✕</button>
    </div>
  );
}

// ─── Avatar Initials ───────────────────────────────────────────────────────────
function CustomerAvatar({ name, size = 36 }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #16a34a, #22c55e)',
      color: 'white', fontSize: '0.72rem', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── Payment / Discount Modal ───────────────────────────────────────────────
function PaymentModal({ isOpen, onClose, customers, preselectedCustomerId, onSubmit, t, initialMode = 'payment' }) {
  const [modalMode, setModalMode]       = useState(initialMode); // 'payment' | 'discount'
  const [customerId, setCustomerId]     = useState('');
  const [amount, setAmount]             = useState('');
  const [paymentMode, setPaymentMode]   = useState('Cash');
  const [note, setNote]                 = useState('');
  const [errors, setErrors]             = useState({});
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModalMode(initialMode || 'payment');
      setCustomerId(preselectedCustomerId || '');
      setAmount(''); setPaymentMode('Cash'); setNote(''); setErrors({});
    }
  }, [isOpen, preselectedCustomerId, initialMode]);

  if (!isOpen) return null;

  const activeCustomer = customers.find(c => c.id === Number(customerId));
  const maxAmount = activeCustomer ? Number(activeCustomer.credit_balance) : 0;

  function validate() {
    const errs = {};
    if (!customerId) errs.customer_id = t('credit.selectCustomer');
    const amt = Number(amount);
    if (!amount) errs.amount = t('credit.amountRequired');
    else if (isNaN(amt) || amt <= 0) errs.amount = t('credit.amountInvalid');
    else if (amt > Number(maxAmount.toFixed(2))) errs.amount = `${t('credit.amountExceeds')} (Max: ₹${maxAmount.toFixed(2)})`;
    if (modalMode === 'payment' && !paymentMode) errs.payment_mode = t('credit.paymentModeRequired');
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const payload = {
      customer_id: Number(customerId),
      amount: Number(amount),
      payment_mode: modalMode === 'discount' ? 'Other' : paymentMode,
      note: note.trim()
    };
    const res = await onSubmit(payload, modalMode);
    setSaving(false);
    if (res?.success) onClose();
    else setErrors({ api: res?.error || 'Operation failed' });
  }

  const isDiscount = modalMode === 'discount';

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal modal-sm" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDiscount ? (
              <span style={{ color: '#059669', fontWeight: 800, fontSize: '1.2rem' }}>%</span>
            ) : (
              <ReceiptIcon style={{ color: 'var(--color-primary)' }} />
            )}
            {isDiscount ? (t('credit.giveDiscount') || 'सूट / डिस्काउंट द्या') : t('credit.receivePayment')}
          </h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Mode Switcher Tabs */}
        <div style={{ display: 'flex', gap: 6, margin: '6px 0 14px', background: 'var(--color-bg-light)', padding: 4, borderRadius: 8 }}>
          <button
            type="button"
            onClick={() => { setModalMode('payment'); setErrors({}); }}
            style={{
              flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6,
              fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
              background: !isDiscount ? 'var(--color-surface)' : 'transparent',
              color: !isDiscount ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              boxShadow: !isDiscount ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
            }}
          >
            <ReceiptIcon style={{ width: 14, height: 14 }} />
            {t('credit.tabPayments') || 'पेमेंट जमा'}
          </button>
          <button
            type="button"
            onClick={() => { setModalMode('discount'); setErrors({}); }}
            style={{
              flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6,
              fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
              background: isDiscount ? 'var(--color-surface)' : 'transparent',
              color: isDiscount ? '#059669' : 'var(--color-text-secondary)',
              boxShadow: isDiscount ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
            }}
          >
            <span style={{ fontWeight: 800 }}>%</span>
            {t('credit.tabDiscount') || 'सूट / डिस्काउंट'}
          </button>
        </div>

        {isDiscount && (
          <div style={{
            background: '#ecfdf5', color: '#065f46', padding: '8px 12px', borderRadius: 6,
            fontSize: '0.76rem', marginBottom: 12, border: '1px solid #a7f3d0', lineHeight: 1.4
          }}>
            💡 {t('credit.discountNote') || 'ही सूट ग्राहकाच्या उधारीतून वजा होईल व आजच्या रोख वसुलीत (Today\'s Recovery) जमा होणार नाही.'}
          </div>
        )}

        {errors.api && (
          <div className="form-api-error"><AlertIcon /> {errors.api}</div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label">{t('credit.customer')} *</label>
            {preselectedCustomerId ? (
              <input type="text" className="form-input" value={activeCustomer ? `${activeCustomer.name} (${activeCustomer.mobile})` : ''} disabled />
            ) : (
              <select
                className={`form-input form-select${errors.customer_id ? ' input-error' : ''}`}
                value={customerId}
                onChange={e => { setCustomerId(e.target.value); setAmount(''); if (errors.customer_id) setErrors(p => ({ ...p, customer_id: '' })); }}
              >
                <option value="">-- {t('credit.selectCustomer')} --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} (₹{Number(c.credit_balance).toFixed(2)})</option>
                ))}
              </select>
            )}
            {errors.customer_id && <span className="field-error">{errors.customer_id}</span>}
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{isDiscount ? (t('credit.discountAmount') || 'सूट रक्कम') : t('credit.amount')} *</span>
              {activeCustomer && (
                <button type="button" onClick={() => setAmount(maxAmount.toFixed(2))}
                  style={{ background: 'none', border: 'none', color: isDiscount ? '#059669' : 'var(--color-primary)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                  {isDiscount ? `Full Dues (₹${maxAmount.toFixed(2)})` : `Pay Full (₹${maxAmount.toFixed(2)})`}
                </button>
              )}
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: 8, fontWeight: 600, color: 'var(--color-text-secondary)' }}>₹</span>
              <input type="number" className={`form-input${errors.amount ? ' input-error' : ''}`}
                value={amount} min="0.01" step="any"
                onChange={e => { setAmount(e.target.value); if (errors.amount) setErrors(p => ({ ...p, amount: '' })); }}
                placeholder="0.00" style={{ paddingLeft: 24 }} disabled={!customerId} />
            </div>
            {errors.amount && <span className="field-error">{errors.amount}</span>}
          </div>

          {!isDiscount && (
            <div className="form-group">
              <label className="form-label">{t('credit.paymentMode')} *</label>
              <select className="form-input form-select" value={paymentMode} onChange={e => setPaymentMode(e.target.value)} disabled={!customerId}>
                <option value="Cash">{t('credit.modeCash')}</option>
                <option value="UPI">{t('credit.modeUPI')}</option>
                <option value="Other">{t('credit.modeOther')}</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t('credit.note')}</label>
            <MarathiInput
              id="payment-note-input"
              value={note}
              onChange={setNote}
              placeholder={isDiscount ? 'उदा. ५०० रुपये सूट दिली' : t('credit.notePlaceholder')}
              disabled={!customerId}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
            <button type="submit" className={isDiscount ? "btn btn-success" : "btn btn-primary"} disabled={saving || !customerId}
              style={isDiscount ? { background: '#059669', borderColor: '#059669', color: '#fff' } : {}}>
              {saving ? t('common.loading') : (isDiscount ? (t('credit.saveDiscount') || 'सूट नोंदवा') : t('credit.savePayment'))}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── Main Udhar Page ──────────────────────────────────────────────────────────
export default function UdharPage() {
  const { t, language } = useTranslation();
  const {
    summary, customers, loading, error,
    searchQuery, setSearchQuery,
    activeCustomerId, setActiveCustomerId,
    activeCustomer, transactions, transactionsLoading,
    collectPayment,
    recordDiscount,
    undoPayment
  } = useCredit();

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [modalInitialMode, setModalInitialMode] = useState('payment'); // 'payment' | 'discount'
  const [txFilter, setTxFilter]                 = useState('all'); // all | payments | discounts | credits
  const [balanceThresholdFilter, setBalanceThresholdFilter] = useState('all'); // all | above_10k | below_10k
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const detailPanelRef = useRef(null); // for mobile scroll-into-view

  // Filter customers by credit limit (> ₹10,000)
  const highCreditCount = customers.filter(c => Number(c.credit_balance || 0) >= 10000).length;
  const displayedCustomers = customers.filter(c => {
    const bal = Number(c.credit_balance || 0);
    if (balanceThresholdFilter === 'above_10k') return bal >= 10000;
    if (balanceThresholdFilter === 'below_10k') return bal < 10000;
    return true;
  });

  function handleSelectCustomer(id) {
    setActiveCustomerId(id);
    setTxFilter('all');
    if (detailPanelRef.current) {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setTimeout(() => {
          detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    }
  }

  const fmtCurrency = (val) => Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 3500);
  }

  async function handlePaymentSubmit(data, mode = 'payment') {
    if (mode === 'discount') {
      const res = await recordDiscount(data);
      if (res?.success) { showToast(t('credit.discountSuccess') || 'सूट यशस्वीरित्या नोंदवली.'); return { success: true }; }
      return res;
    }
    const res = await collectPayment(data);
    if (res?.success) { showToast(t('credit.paymentSuccess')); return { success: true }; }
    return res;
  }

  async function handleConfirmUndo() {
    if (!undoTarget) return;
    setUndoing(true);
    const res = await undoPayment(undoTarget.id, activeCustomerId);
    setUndoing(false);
    if (res?.success) {
      showToast(t('credit.undoSuccess') || 'व्यवहार पूर्ववत (Undo) करण्यात आला.');
      setUndoTarget(null);
    } else {
      showToast(res?.error || t('credit.undoError') || 'पूर्ववत करता आला नाही.', 'error');
    }
  }

  function hasDevanagari(str) { return /[\u0900-\u097F]/.test(str); }
  function isAscii(str) {
    for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 127) return false;
    return true;
  }

  return (
    <div className="udhar-page" style={{ animation: 'pageIn 0.2s ease' }}>
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header-bar">
        <div>
          <h1 className="page-title">{t('credit.title')}</h1>
          <p className="page-desc">{t('credit.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-outline"
            onClick={() => { setModalInitialMode('discount'); setPaymentModalOpen(true); }}
            id="give-discount-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#059669', borderColor: '#059669', fontWeight: 600 }}
          >
            <span style={{ fontWeight: 800 }}>%</span>
            {t('credit.giveDiscount') || 'सूट / डिस्काउंट द्या'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setModalInitialMode('payment'); setPaymentModalOpen(true); }}
            id="receive-payment-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ReceiptIcon style={{ width: '16px', height: '16px' }} />
            {t('credit.receivePayment')}
          </button>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-orange">
            <ReceiptIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{fmtCurrency(summary?.total_outstanding)}</div>
            <div className="kpi-label">{t('credit.totalOutstanding')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-red">
            <ChartIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{fmtCurrency(summary?.today_added ?? summary?.today_credit_added)}</div>
            <div className="kpi-label">{t('credit.todayAdded')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-green">
            <HistoryIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{fmtCurrency(summary?.today_recovered ?? summary?.today_recovery)}</div>
            <div className="kpi-label">{t('credit.todayRecovered')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-blue">
            <UsersIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{customers?.length || 0}</div>
            <div className="kpi-label">{t('credit.customersWithBalance') || 'Customers with Udhar'}</div>
          </div>
        </div>
        <div
          className="kpi-card"
          onClick={() => setBalanceThresholdFilter(balanceThresholdFilter === 'above_10k' ? 'all' : 'above_10k')}
          style={{
            cursor: 'pointer',
            border: balanceThresholdFilter === 'above_10k' ? '2px solid #ef4444' : undefined,
            transition: 'all 0.15s ease'
          }}
          title={language === 'mr' ? '१०,०००+ उधारी असलेले ग्राहक पाहण्यासाठी क्लिक करा' : 'Filter customers with balance > ₹10,000'}
        >
          <div className="kpi-icon-box kpi-icon-red">
            <AlertIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value" style={{ color: highCreditCount > 0 ? '#dc2626' : undefined }}>{highCreditCount}</div>
            <div className="kpi-label">{t('credit.highCreditCustomers') || 'Udhar > ₹10,000'}</div>
          </div>
        </div>
      </div>

      {/* ── Two-panel Grid ────────────────────────────────────────────────── */}
      <div className="udhar-panels-grid">

        {/* Left: Customer List */}
        <div>
          {/* Search */}
          <div className="search-bar-container" style={{ marginBottom: 12 }}>
            <div className={`search-bar${searchQuery && hasDevanagari(searchQuery) ? ' marathi-mode' : ''}`}>
              <span className="search-icon"><SearchIcon /></span>
              <MarathiInput id="udhar-search-input" variant="search" placeholder={t('customers.searchPlaceholder')}
                value={searchQuery} onChange={setSearchQuery} />
              {searchQuery && isAscii(searchQuery) && <span className="search-marathi-badge">अ</span>}
              {searchQuery && <button className="search-clear-btn" onClick={() => setSearchQuery('')}>✕</button>}
            </div>
          </div>

          {/* Customer List Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Card Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <UsersIcon style={{ color: 'var(--color-primary)', width: '16px', height: '16px' }} />
              <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{t('credit.customersWithBalance') || 'Customers'}</span>
              {customers.length > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-border-light)', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
                  {displayedCustomers.length} / {customers.length}
                </span>
              )}
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: 'var(--color-bg-light)', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setBalanceThresholdFilter('all')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 16,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  background: balanceThresholdFilter === 'all' ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: balanceThresholdFilter === 'all' ? '#fff' : 'var(--color-text-secondary)',
                  boxShadow: balanceThresholdFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                {t('common.all') || 'All'} ({customers.length})
              </button>
              <button
                type="button"
                onClick={() => setBalanceThresholdFilter('above_10k')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 16,
                  border: balanceThresholdFilter === 'above_10k' ? 'none' : '1px solid #fca5a5',
                  cursor: 'pointer',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  background: balanceThresholdFilter === 'above_10k' ? '#dc2626' : '#fef2f2',
                  color: balanceThresholdFilter === 'above_10k' ? '#fff' : '#b91c1c',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <span>⚠️ {t('credit.filterAbove10k') || '> ₹10,000'}</span>
                <span style={{
                  background: balanceThresholdFilter === 'above_10k' ? 'rgba(255,255,255,0.3)' : '#fee2e2',
                  padding: '1px 5px',
                  borderRadius: 10,
                  fontSize: '0.68rem'
                }}>
                  {highCreditCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setBalanceThresholdFilter('below_10k')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 16,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  background: balanceThresholdFilter === 'below_10k' ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: balanceThresholdFilter === 'below_10k' ? '#fff' : 'var(--color-text-secondary)',
                  boxShadow: balanceThresholdFilter === 'below_10k' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                {t('credit.filterBelow10k') || '< ₹10,000'} ({customers.length - highCreditCount})
              </button>
            </div>

            {error && !loading && (
              <div className="table-error" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px' }}><AlertIcon /> {error}</div>
            )}
            {loading && <div className="table-message"><span className="spinner" style={{ margin: 'auto' }} /></div>}

            {!loading && !error && displayedCustomers.length === 0 && (
              <div className="table-message" style={{ padding: '40px 20px' }}>
                <UsersIcon style={{ width: '1.8rem', height: '1.8rem', color: 'var(--color-text-muted)', marginBottom: 8 }} />
                <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  {searchQuery ? t('credit.noSearchResults') : (balanceThresholdFilter === 'above_10k' ? (language === 'mr' ? '१०,००० पेक्षा जास्त उधारी असलेला कोणताही ग्राहक नाही' : 'No customers with balance > ₹10,000') : t('credit.noPendingCustomers'))}
                </p>
              </div>
            )}

            {!loading && !error && displayedCustomers.length > 0 && displayedCustomers.map(c => {
              const isHighCredit = Number(c.credit_balance || 0) >= 10000;
              return (
                <div
                  key={c.id}
                  className={`udhar-customer-row${activeCustomerId === c.id ? ' active' : ''}`}
                  onClick={() => handleSelectCustomer(c.id)}
                  style={{
                    borderLeft: isHighCredit ? '4px solid #ef4444' : undefined,
                    background: isHighCredit && activeCustomerId !== c.id ? 'rgba(239, 68, 68, 0.03)' : undefined
                  }}
                >
                  <CustomerAvatar name={c.name} size={36} />
                  <div className="udhar-customer-info">
                    <div className="udhar-customer-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span>{c.name}</span>
                      {isHighCredit && (
                        <span style={{ fontSize: '0.64rem', color: '#b91c1c', background: '#fee2e2', border: '1px solid #fca5a5', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          ⚠️ &gt; ₹10k
                        </span>
                      )}
                    </div>
                    <div className="udhar-customer-mobile">{c.mobile}</div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span className="udhar-balance-badge" style={{ color: isHighCredit ? '#b91c1c' : undefined, background: isHighCredit ? '#fee2e2' : undefined }}>
                      ₹{fmtCurrency(c.credit_balance)}
                    </span>
                    {Number(c.today_recovery || 0) > 0 ? (
                      <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 700, background: '#dcfce7', padding: '1px 6px', borderRadius: '10px' }}>
                        🟢 ₹{fmtCurrency(c.today_recovery)} {language === 'mr' ? 'आज जमा' : 'Paid Today'}
                      </span>
                    ) : c.last_transaction_date ? (
                      <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                        {formatDDMMYYYY(c.last_transaction_date)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Transaction Detail Panel */}
        <div
          ref={detailPanelRef}
          className="card"
          style={{ minHeight: 420, position: 'sticky', top: 20, padding: 0, overflow: 'hidden' }}
        >
          {activeCustomer ? (
            <>
              {/* High Credit Alert Banner for Selected Customer */}
              {Number(activeCustomer.credit_balance || 0) >= 10000 && (
                <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#b91c1c', fontSize: '0.82rem', fontWeight: 600 }}>
                  <AlertIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
                  <span>
                    ⚠️ {t('credit.limitExceededWarning') || 'Credit Limit Alert: Balance exceeds ₹10,000!'}
                  </span>
                </div>
              )}

              {/* Customer Header */}
              <div style={{ padding: '14px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', overflow: 'hidden' }}>
                {/* Mobile back button */}
                <button
                  className="udhar-back-btn"
                  onClick={() => setActiveCustomerId(null)}
                  aria-label="Back to customer list"
                  style={{
                    display: 'none', // shown via CSS on mobile only
                    alignItems: 'center', gap: 4, marginBottom: 10,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.82rem', padding: 0,
                  }}
                >
                  ← {t('common.back') || 'Back to list'}
                </button>
                {/* Customer info row — flex with overflow guards so it never overflows horizontally */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                  {/* Left: avatar + name/phone */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
                    <CustomerAvatar name={activeCustomer.name} size={36} />
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <h2 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeCustomer.name}</h2>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <PhoneIcon style={{ width: '11px', height: '11px', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeCustomer.mobile}</span>
                      </p>
                      {activeCustomer.address && (
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                          <MapPinIcon style={{ width: '11px', height: '11px', flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeCustomer.address}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Right: outstanding balance + action buttons */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-muted)', marginBottom: 2, whiteSpace: 'nowrap' }}>
                      {t('credit.totalOutstanding')}
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-error)', lineHeight: 1, whiteSpace: 'nowrap' }}>
                      ₹{fmtCurrency(activeCustomer.credit_balance)}
                    </div>
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-outline"
                        onClick={() => { setModalInitialMode('discount'); setPaymentModalOpen(true); }}
                        style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#059669', borderColor: '#059669', fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        % {t('credit.giveDiscount') || 'Discount'}
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => { setModalInitialMode('payment'); setPaymentModalOpen(true); }}
                        style={{ padding: '4px 10px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                      >
                        + {t('credit.receivePayment')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transaction History */}
              <div style={{ padding: '14px 20px 0' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <HistoryIcon style={{ width: '14px', height: '14px' }} />
                  {t('credit.historyTitle')}
                </div>

                {/* Filter Tabs */}
                {transactions.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                    {[
                      { key: 'all',       label: 'All',               count: transactions.length },
                      { key: 'payments',  label: 'Payments Received', count: transactions.filter(t => t.transaction_type === 'PAYMENT_RECEIVED').length },
                      { key: 'discounts', label: 'Discounts (सूट)',   count: transactions.filter(t => t.transaction_type === 'DISCOUNT').length },
                      { key: 'credits',   label: 'Credit Added',       count: transactions.filter(t => t.transaction_type === 'CREDIT_ADDED').length },
                    ].map(({ key, label, count }) => (
                      <button
                        key={key}
                        onClick={() => setTxFilter(key)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '16px',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          background: txFilter === key ? 'var(--color-primary)' : 'var(--color-bg-light)',
                          color: txFilter === key ? '#fff' : 'var(--color-text-secondary)',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {label}
                        <span style={{
                          background: txFilter === key ? 'rgba(255,255,255,0.25)' : 'var(--color-border)',
                          padding: '1px 5px', borderRadius: '8px', fontSize: '0.68rem',
                        }}>{count}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Mini summary bar */}
                {/* Both figures come from the ledger's own signs rather than from a
                    filter on two row types, so they still account for every row when a
                    new type is introduced — and Credit − Received lands on the
                    outstanding figure shown above, which is the subtraction a customer
                    at the counter will actually do. */}
                {transactions.length > 0 && (() => {
                  const { totalCredit, totalRecovered } = splitSigned(transactions);
                  return (
                    <div style={{
                      display: 'flex', gap: 12, marginBottom: 10, fontSize: '0.75rem',
                      background: 'var(--color-bg-light)', borderRadius: 8, padding: '6px 10px', flexWrap: 'wrap'
                    }}>
                      <span style={{ color: 'var(--color-error)', fontWeight: 700 }}>
                        Credit: ₹{totalCredit.toFixed(2)}
                      </span>
                      <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>
                        Received / Deducted: ₹{totalRecovered.toFixed(2)}
                      </span>
                    </div>
                  );
                })()}
              </div>

              {transactionsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><span className="spinner" /></div>
              ) : transactions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  No transaction history yet.
                </div>
              ) : (() => {
                const filtered = txFilter === 'all'
                  ? transactions
                  : txFilter === 'payments'
                    ? transactions.filter(t => t.transaction_type === 'PAYMENT_RECEIVED')
                    : txFilter === 'discounts'
                      ? transactions.filter(t => t.transaction_type === 'DISCOUNT')
                      : transactions.filter(t => t.transaction_type === 'CREDIT_ADDED');

                if (filtered.length === 0) return (
                  <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    No records for this filter.
                  </div>
                );

                return (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                          <th style={{ padding: '8px 20px', fontWeight: 700, color: 'var(--color-text-muted)', textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date & Time</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--color-text-muted)', textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</th>
                          <th style={{ padding: '8px 20px', fontWeight: 700, color: 'var(--color-text-muted)', textAlign: 'right', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Amount</th>
                          <th style={{ padding: '8px 20px', fontWeight: 700, color: 'var(--color-text-muted)', textAlign: 'right', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Balance</th>
                          <th style={{ padding: '8px 16px', fontWeight: 700, color: 'var(--color-text-muted)', textAlign: 'center', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(tx => {
                          const isPayment  = tx.transaction_type === 'PAYMENT_RECEIVED';
                          const isDiscount = tx.transaction_type === 'DISCOUNT';
                          const isCredit   = tx.transaction_type === 'CREDIT_ADDED';
                          const isOpening  = tx.transaction_type === 'OPENING_BALANCE';
                          const typeColor  = isPayment ? 'var(--color-success)' : isDiscount ? '#059669' : (isCredit || isOpening) ? 'var(--color-error)' : 'var(--color-text-secondary)';
                          const typeLabel  = isCredit
                            ? t('credit.typeCreditAdded')
                            : isPayment
                              ? t('credit.typePaymentReceived')
                              : isDiscount
                                ? (t('credit.typeDiscount') || 'सूट (Discount)')
                                : isOpening
                                  ? t('credit.typeOpeningBalance')
                                  : t('credit.typeCreditAdjustment');
                          return (
                            <tr key={tx.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                              <td style={{ padding: '9px 20px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 600 }}>
                                  {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </div>
                                <div style={{ fontSize: '0.7rem', marginTop: 1 }}>
                                  {new Date(tx.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </td>
                              <td style={{ padding: '9px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{
                                    width: 18, height: 18, borderRadius: '50%',
                                    background: isPayment ? 'var(--color-success-bg)' : isDiscount ? '#ecfdf5' : 'var(--color-error-bg)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                  }}>
                                    {isPayment
                                      ? <CheckIcon style={{ width: 10, height: 10, color: 'var(--color-success)' }} />
                                      : isDiscount
                                        ? <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#059669' }}>%</span>
                                        : <ChartIcon style={{ width: 10, height: 10, color: 'var(--color-error)' }} />
                                    }
                                  </span>
                                  <div>
                                    <div style={{ fontWeight: 600, color: typeColor, fontSize: '0.8rem' }}>{typeLabel}</div>
                                    {(tx.note || tx.notes) && <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{(tx.note || tx.notes).replace(/\[(Desktop|Mobile|Supabase):[^\]]*\]/g, '').trim()}</div>}
                                    {tx.bill_number && <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>#{tx.bill_number}</div>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '9px 20px', textAlign: 'right', fontWeight: 700, color: (isPayment || isDiscount) ? 'var(--color-success)' : 'var(--color-error)' }}>
                                {(() => {
                                  // Sign and magnitude from the same signed amount, so a
                                  // written-off adjustment reads −₹500.00 instead of the
                                  // +₹-500.00 a type-based sign produced.
                                  const { sign, magnitude } = displayAmount(tx.transaction_type, tx.amount);
                                  return `${sign}₹${magnitude.toFixed(2)}`;
                                })()}
                              </td>
                              <td style={{ padding: '9px 20px', textAlign: 'right', fontWeight: 600 }}>
                                ₹{Number(tx.balance_after_transaction).toFixed(2)}
                              </td>
                              <td style={{ padding: '9px 16px', textAlign: 'center' }}>
                                {(isPayment || isDiscount) && (
                                  <button
                                    type="button"
                                    onClick={() => setUndoTarget(tx)}
                                    className="btn btn-ghost"
                                    title={t('credit.undoPayment') || 'Undo'}
                                    style={{
                                      padding: '3px 8px',
                                      fontSize: '0.72rem',
                                      color: 'var(--color-error)',
                                      border: '1px solid var(--color-border)',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    ↺ {t('credit.undoPayment') || 'Undo'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '80px 20px', color: 'var(--color-text-muted)', textAlign: 'center', gap: 12 }}>
              <ReceiptIcon style={{ width: '2.5rem', height: '2.5rem', color: 'var(--color-border)' }} />
              <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem' }}>
                {t('credit.selectCustomerHint') || 'Select a customer from the left to view their transaction history'}
              </p>
            </div>
          )}
        </div>
      </div>

      {paymentModalOpen && (
        <PaymentModal
          isOpen={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          customers={customers}
          preselectedCustomerId={activeCustomerId}
          onSubmit={handlePaymentSubmit}
          initialMode={modalInitialMode}
          t={t}
        />
      )}

      {/* Undo Confirmation Modal */}
      {undoTarget && (
        <>
          <div className="modal-backdrop" onClick={() => !undoing && setUndoTarget(null)} />
          <div className="modal modal-sm" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertIcon style={{ width: 18, height: 18 }} />
                {t('credit.undoPayment') || 'पूर्ववत करा (Undo)'}
              </h2>
              <button className="modal-close-btn" onClick={() => !undoing && setUndoTarget(null)}>✕</button>
            </div>
            <div style={{ padding: '14px 0', fontSize: '0.88rem' }}>
              <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                {t('credit.undoConfirm') || 'तुम्हाला खात्री आहे का की हा व्यवहार पूर्ववत (Undo) करायचा आहे? यामुळे ग्राहकाची बाकी पूर्ववत वाढेल.'}
              </p>
              <div style={{
                background: 'var(--color-bg-light)', padding: 12, borderRadius: 8,
                fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 6,
                border: '1px solid var(--color-border)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>व्यवहार:</span>
                  <span style={{ fontWeight: 600 }}>{undoTarget.transaction_type === 'DISCOUNT' ? 'सूट (Discount)' : 'पेमेंट (Payment)'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>रक्कम:</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-error)' }}>₹{Number(undoTarget.amount).toFixed(2)}</span>
                </div>
                {undoTarget.note && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>टीप:</span>
                    <span>{undoTarget.note}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setUndoTarget(null)} disabled={undoing}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleConfirmUndo}
                disabled={undoing}
                style={{ background: 'var(--color-error)', color: '#fff' }}
              >
                {undoing ? t('common.loading') : (t('credit.undoPayment') || 'पूर्ववत करा')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
