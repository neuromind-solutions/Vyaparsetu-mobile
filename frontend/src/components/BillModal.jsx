/**
 * BillModal Component
 * Form for creating and editing customer bills.
 * Integrates customer/vegetable catalogs with phonetic search, dynamic line items, and real-time total updates.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useCustomers } from '../hooks/useCustomers';
import { useVegetables } from '../hooks/useVegetables';
import useSettings from '../hooks/useSettings';
import MarathiInput from './MarathiInput';
import { ReceiptIcon, AlertIcon, TrashIcon } from './Icons';
import { normalizeCommissionPercent, round2, formatCommissionPercent } from '../utils/money';

// ─── Customer Searchable Select Component ─────────────────────────────────────
function CustomerSearchSelect({ customers, selectedId, onChange, placeholder, t, error }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selectedCust = customers.find(c => c.id === Number(selectedId));

  const filtered = customers.filter(c => {
    const term = search.toLowerCase();
    return c.name.toLowerCase().includes(term) ||
      (c.mobile && c.mobile.includes(term)) ||
      (c.search_keywords && c.search_keywords.toLowerCase().includes(term));
  });

  return (
    <div className="searchable-select-container" ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`form-input searchable-select-trigger ${error ? 'input-error' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textAlign: 'left',
          width: '100%',
          background: 'var(--color-bg-card)',
          cursor: 'pointer'
        }}
      >
        <span>
          {selectedCust ? `${selectedCust.name} (${selectedCust.mobile})` : placeholder}
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>▼</span>
      </button>

      {isOpen && (
        <div
          className="searchable-select-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius-sm)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: 8,
            marginTop: 4
          }}
        >
          <MarathiInput
            variant="search"
            placeholder={t('customers.searchPlaceholder') || 'Search customer...'}
            value={search}
            onChange={setSearch}
            autoFocus
          />

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '8px 0 0 0',
              maxHeight: 180,
              overflowY: 'auto'
            }}
          >
            {filtered.length === 0 ? (
              <li style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                {t('common.noData') || 'No customers found'}
              </li>
            ) : (
              filtered.map(c => (
                <li
                  key={c.id}
                  onClick={() => {
                    onChange(c.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderRadius: 'var(--border-radius-sm)',
                    background: c.id === Number(selectedId) ? 'var(--color-primary-light)' : 'transparent',
                    color: c.id === Number(selectedId) ? 'var(--color-primary)' : 'var(--color-text-primary)',
                    borderBottom: '1px solid var(--color-border-light)',
                    fontSize: '0.9rem'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = c.id === Number(selectedId) ? 'var(--color-primary-light)' : 'transparent';
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {c.mobile}{c.search_keywords ? ` • ${c.search_keywords}` : ''}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// VegetableSearchSelect has been removed as it was replaced by the quick-tap grid

// ─── Main Modal Component ──────────────────────────────────────────────────
export default function BillModal({ isOpen, onClose, onSubmit, bill }) {
  const { t } = useTranslation();
  const { customers } = useCustomers();
  const { vegetables } = useVegetables();
  // The commission rate is a shop-wide setting, read here so the live totals match
  // what the server will store.
  const { settings } = useSettings();

  const isEdit = Boolean(bill);

  const [customerId, setCustomerId]       = useState('');
  const [date, setDate]                   = useState('');
  const [notes, setNotes]                 = useState('');
  const [discountType, setDiscountType]   = useState('fixed');
  const [discountValue, setDiscountValue] = useState(0);
  const [customCommissionRate, setCustomCommissionRate] = useState('');
  const [paymentType, setPaymentType]     = useState('Cash');
  const [paymentStatus, setPaymentStatus] = useState('Paid');
  const [paidAmount, setPaidAmount]       = useState(0);
  const [vegSearch, setVegSearch]         = useState('');
  const [items, setItems]                 = useState([]);
  const [errors, setErrors]               = useState({});
  const [saving, setSaving]               = useState(false);
  const [apiError, setApiError]           = useState('');

  // Load/Reset Form Data
  useEffect(() => {
    if (isOpen) {
      if (bill) {
        setCustomerId(bill.customer_id);
        setDate(bill.date.substring(0, 10)); // Ensure YYYY-MM-DD
        setNotes(bill.notes || '');
        setDiscountType(bill.discount_type || 'fixed');
        setDiscountValue(bill.discount_value || 0);

        const billCust = customers.find((c) => c.id === Number(bill.customer_id));
        let initComm = '';
        if (bill.commission_rate !== undefined && bill.commission_rate !== null && bill.commission_rate !== '') {
          initComm = String(bill.commission_rate);
        } else if (billCust?.commission_rate !== undefined && billCust?.commission_rate !== null && String(billCust.commission_rate).trim() !== '') {
          initComm = String(billCust.commission_rate);
        } else {
          initComm = String(settings?.commission_rate ?? 8);
        }
        setCustomCommissionRate(initComm);

        setPaymentType(bill.payment_type || 'Cash');
        setPaymentStatus(bill.payment_status || 'Paid');
        setPaidAmount(bill.paid_amount || 0);
        setItems(bill.items || []);
      } else {
        setCustomerId('');
        setDate(new Date().toISOString().substring(0, 10)); // Today
        setNotes('');
        setDiscountType('fixed');
        setDiscountValue(0);
        setCustomCommissionRate(String(settings?.commission_rate ?? 8));
        setPaymentType('Cash');
        setPaymentStatus('Paid');
        setPaidAmount(0);
        setItems([]);
      }
      setErrors({});
      setApiError('');
    }
  }, [isOpen, bill]);

  // Modal visibility will be checked right before returning JSX.
  // ─── Line Item Operations ─────────────────────────────────────────────────
  function handleItemChange(idx, field, value) {
    const updated = [...items];
    const row = { ...updated[idx], [field]: value };

    // Auto-fill rate when vegetable changes
    if (field === 'vegetable_id') {
      const selectedVeg = vegetables.find(v => v.id === Number(value));
      row.rate = selectedVeg ? Number(selectedVeg.rate) : 0;
      row.vegetable_name = selectedVeg ? selectedVeg.name : '';
    }

    // Recalculate item total
    const qty = Number(row.quantity) || 0;
    const rate = Number(row.rate) || 0;
    row.total = Number((qty * rate).toFixed(2));

    updated[idx] = row;
    setItems(updated);

    if (errors.items) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.items;
        return next;
      });
    }
  }

  function addItemRow() {
    setItems([...items, { vegetable_id: '', quantity: 1, rate: 0, total: 0 }]);
  }

  function removeItemRow(idx) {
    if (items.length === 1) return;
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
  }

  function handleAddVegetableTap(veg) {
    const existingIdx = items.findIndex(item => item.vegetable_id === veg.id);
    let updated = [...items];
    if (existingIdx >= 0) {
      const currentQty = Number(updated[existingIdx].quantity) || 0;
      const newQty = currentQty + 1;
      const rate = Number(updated[existingIdx].rate) || 0;
      updated[existingIdx] = {
        ...updated[existingIdx],
        quantity: newQty,
        total: Number((newQty * rate).toFixed(2))
      };
    } else {
      const isFirstEmpty = updated.length === 1 && !updated[0].vegetable_id;
      const newRate = Number(veg.rate) || 0;
      const newItem = {
        vegetable_id: veg.id,
        vegetable_name: veg.name,
        quantity: 1,
        rate: newRate,
        total: newRate
      };
      if (isFirstEmpty) updated = [newItem];
      else updated.push(newItem);
    }
    setItems(updated);
    if (errors.items) {
      setErrors(prev => { const next = { ...prev }; delete next.items; return next; });
    }
  }

  // ─── Billing Calculations ─────────────────────────────────────────────────
  const subtotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

  let discountAmount = 0;
  const dVal = Number(discountValue) || 0;
  if (discountType === 'percentage') {
    discountAmount = Number(((subtotal * dVal) / 100).toFixed(2));
  } else {
    discountAmount = Number(dVal.toFixed(2));
  }

  // Keep discount amount from exceeding subtotal
  if (discountAmount > subtotal) {
    discountAmount = subtotal;
  }

  const amountAfterDiscount = Number((subtotal - discountAmount).toFixed(2));
  // Use custom commission rate entered by user, or bill's rate, or customer setting, or shop setting
  const parsedComm = parseFloat(customCommissionRate);
  const currentCust = customers.find(c => c.id === Number(customerId));
  const commissionRate = (!isNaN(parsedComm) && parsedComm >= 0)
    ? parsedComm
    : (isEdit && bill?.commission_rate !== undefined && bill?.commission_rate !== null
        ? normalizeCommissionPercent(bill.commission_rate)
        : (currentCust?.commission_rate !== undefined && currentCust?.commission_rate !== null && String(currentCust.commission_rate).trim() !== ''
            ? normalizeCommissionPercent(currentCust.commission_rate)
            : normalizeCommissionPercent(settings?.commission_rate)));
  const commissionAmount = round2((amountAfterDiscount * commissionRate) / 100);

  const finalAmount = Number((amountAfterDiscount + commissionAmount).toFixed(2));

  const paid = Number(paidAmount) || 0;
  const remainingAmount = Number((finalAmount - paid).toFixed(2));

  // Auto-sync Paid/Unpaid amounts when status or finalAmount changes
  useEffect(() => {
    if (paymentStatus === 'Paid') {
      setPaidAmount(finalAmount);
    } else if (paymentStatus === 'Credit') {
      setPaidAmount(0);
    } else if (paymentStatus === 'Partial') {
      setPaidAmount(prev => prev > finalAmount ? finalAmount : prev);
    }
  }, [paymentStatus, finalAmount]);

  // ─── Form Submission Validation ───────────────────────────────────────────
  function validate() {
    const errs = {};
    if (!customerId) errs.customer_id = t('billing.customerRequired');
    if (!date) errs.date = t('billing.dateRequired') || 'Date is required';
    if (!paymentType) errs.payment_type = t('billing.paymentTypeRequired') || 'Payment type is required';

    const validItems = items.filter(it => it.vegetable_id && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      errs.items = t('billing.itemsRequired');
    }

    // Item-specific validations
    items.forEach((it, idx) => {
      if (it.vegetable_id) {
        if (Number(it.quantity) <= 0) {
          errs.items = `${t('billing.vegetable')} ${idx + 1}: Quantity must be greater than 0`;
        }
        if (Number(it.rate) < 0) {
          errs.items = `${t('billing.vegetable')} ${idx + 1}: Rate must be greater than or equal to 0`;
        }
      }
    });

    if (discountAmount > subtotal) {
      errs.discount = 'Discount cannot exceed subtotal';
    }

    if (paid > finalAmount) {
      errs.paid_amount = 'Paid amount cannot exceed final amount';
    }

    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    setApiError('');

    const formattedPayload = {
      bill_number: bill?.bill_number, // Keep original if editing
      customer_id: Number(customerId),
      date,
      subtotal,
      discount_type: discountType,
      discount_value: dVal,
      discount_amount: discountAmount,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      hamali_amount: Number(bill?.hamali_amount || 0),
      transport_amount: Number(bill?.transport_amount || 0),
      final_amount: finalAmount,
      paid_amount: paid,
      remaining_amount: remainingAmount,
      payment_type: paymentType,
      payment_status: paymentStatus,
      notes,
      items: items
        .filter(it => it.vegetable_id && Number(it.quantity) > 0)
        .map(it => ({
          vegetable_id: Number(it.vegetable_id),
          vegetable_name: it.vegetable_name || (vegetables.find(v => v.id === Number(it.vegetable_id))?.name || ''),
          quantity: Number(it.quantity),
          rate: Number(it.rate),
          total: Number(it.total),
          item_date: it.item_date || null
        })),
    };

    const result = await onSubmit(formattedPayload);
    setSaving(false);

    if (result.success) {
      onClose(result.data); // Pass back the saved bill data if any
    } else {
      setApiError(result.error || t('common.error'));
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={() => onClose()} />
      <div className="modal modal-lg" role="dialog" aria-modal="true" id="bill-modal" style={{ maxWidth: 850 }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ReceiptIcon style={{ color: 'var(--color-primary)' }} />
            {isEdit ? t('billing.editBill') : t('billing.createBill')}
          </h2>
          <button className="modal-close-btn" onClick={() => onClose()} id="bill-modal-close">✕</button>
        </div>

        {apiError && (
          <div className="form-api-error" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: 'var(--border-radius-sm)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertIcon style={{ flexShrink: 0 }} />
            <span>{apiError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Top Form Section: Customer & Date */}
          <div className="form-row-2" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">
                {t('billing.customer')} <span className="required-star">*</span>
              </label>
              <CustomerSearchSelect
                customers={customers}
                selectedId={customerId}
                onChange={(id) => {
                  setCustomerId(id);
                  if (errors.customer_id) setErrors(prev => ({ ...prev, customer_id: '' }));
                  if (!isEdit && id) {
                    const sel = customers.find(c => c.id === Number(id));
                    if (sel?.commission_rate !== undefined && sel?.commission_rate !== null && String(sel.commission_rate).trim() !== '') {
                      setCustomCommissionRate(String(sel.commission_rate));
                    } else {
                      setCustomCommissionRate(String(settings?.commission_rate ?? 8));
                    }
                  }
                }}
                placeholder={`-- ${t('billing.selectCustomer')} --`}
                t={t}
                error={errors.customer_id}
              />
              {errors.customer_id && <span className="field-error">{errors.customer_id}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">{t('billing.date')} <span className="required-star">*</span></label>
              <input
                type="date"
                className={`form-input${errors.date ? ' input-error' : ''}`}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (errors.date) setErrors(prev => ({ ...prev, date: '' }));
                }}
              />
              {errors.date && <span className="field-error">{errors.date}</span>}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>{t('billing.items')}</span>
              {errors.items && <span className="field-error" style={{ margin: 0 }}>{errors.items}</span>}
            </label>
            <div className="bill-items-container" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-sm)', padding: '16px', background: 'var(--color-bg-light)' }}>
              
              {/* Vegetable Search & Quick-Tap Grid */}
              <div style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t('vegetables.searchPlaceholder') || "Search vegetables..."}
                  value={vegSearch}
                  onChange={(e) => setVegSearch(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: '160px', overflowY: 'auto', padding: '4px' }}>
                {vegetables.filter(v => v.name.toLowerCase().includes(vegSearch.toLowerCase()) || (v.search_keywords && v.search_keywords.toLowerCase().includes(vegSearch.toLowerCase()))).map(veg => (
                  <button
                    key={veg.id}
                    type="button"
                    onClick={() => handleAddVegetableTap(veg)}
                    style={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-primary)',
                      color: 'var(--color-primary)',
                      padding: '6px 12px',
                      borderRadius: '16px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-card)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                  >
                    {veg.name} <span style={{fontSize: '0.75rem', opacity: 0.8}}>({veg.rate}/{t(`vegetables.units.${veg.unit}`) || veg.unit})</span>
                  </button>
                ))}
                {vegetables.length === 0 && <span className="text-muted" style={{ fontSize: '0.85rem' }}>{t('common.noData') || 'No vegetables available'}</span>}
              </div>

              {/* Header inside items list */}
              <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1.2fr 1.2fr auto', gap: 12, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                <div>{t('billing.vegetable')}</div>
                <div>{t('billing.quantity')}</div>
                <div>{t('billing.rate')} (₹)</div>
                <div>{t('billing.amount')} (₹)</div>
                <div style={{ width: 30 }}></div>
              </div>

              {items.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  Tap a vegetable above to add it to the bill.
                </div>
              )}

              {items.map((item, idx) => (
                <div key={idx} className="bill-item-row" style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1.2fr 1.2fr auto', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  {/* Vegetable Name Display */}
                  <div style={{ fontWeight: 600, paddingLeft: 4, color: 'var(--color-primary)' }}>
                    {item.vegetable_name || '--'}
                  </div>

                  {/* Quantity Input */}
                  <div>
                    <input
                      type="number"
                      className="form-input"
                      placeholder={t('billing.quantity')}
                      value={item.quantity}
                      min="0.01"
                      step="any"
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
                      style={{ padding: '6px 8px' }}
                    />
                  </div>

                  {/* Rate Input */}
                  <div>
                    <input
                      type="number"
                      className="form-input"
                      placeholder={t('billing.rate')}
                      value={item.rate}
                      min="0"
                      step="any"
                      onChange={(e) => handleItemChange(idx, 'rate', e.target.value === '' ? '' : Number(e.target.value))}
                      style={{ padding: '6px 8px' }}
                    />
                  </div>

                  {/* Calculated Row Total */}
                  <div style={{ fontWeight: 600, paddingLeft: 8, color: 'var(--color-text-primary)' }}>
                    ₹{(Number(item.total) || 0).toFixed(2)}
                  </div>

                  {/* Row Delete Button */}
                  <div>
                    <button
                      type="button"
                      className="btn-icon btn-icon-delete"
                      disabled={items.length === 1}
                      onClick={() => removeItemRow(idx)}
                      style={{ padding: '6px', height: '34px', width: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title={t('common.delete')}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="btn btn-outline"
                onClick={addItemRow}
                style={{ marginTop: 8, fontSize: '0.85rem', padding: '6px 14px' }}
              >
                + {t('billing.addItem')}
              </button>
            </div>
          </div>

          {/* Bottom Calculations Grid */}
          <div className="form-row-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
            {/* Left side: Notes */}
            <div className="form-group">
              <label className="form-label">{t('billing.notes')}</label>
              <MarathiInput
                id="bill-notes-input"
                placeholder={t('billing.notesPlaceholder')}
                value={notes}
                onChange={setNotes}
              />
            </div>

            {/* Right side: Summary Details */}
            <div className="bill-summary-wrap" style={{ background: 'var(--color-bg-light)', padding: '16px', borderRadius: 'var(--border-radius-sm)', display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.9rem' }}>
              
              {/* Subtotal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-muted">Subtotal:</span>
                <span style={{ fontWeight: 600 }}>₹{subtotal.toFixed(2)}</span>
              </div>

              {/* Discount selection and value */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-muted">{t('billing.discount')}:</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="form-input"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value)}
                    style={{ width: 85, padding: '4px 6px', fontSize: '0.85rem' }}
                  >
                    <option value="fixed">Fixed</option>
                    <option value="percentage">%</option>
                  </select>
                  <input
                    type="number"
                    className={`form-input${errors.discount ? ' input-error' : ''}`}
                    value={discountValue}
                    min="0"
                    onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                    style={{ width: 80, padding: '4px 8px', textAlign: 'right' }}
                  />
                </div>
              </div>
              {errors.discount && <div style={{ color: 'var(--color-error)', fontSize: '0.8rem', textAlign: 'right', marginTop: -6 }}>{errors.discount}</div>}

              {/* Amount after discount */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                <span>Amount After Discount:</span>
                <span>₹{amountAfterDiscount.toFixed(2)}</span>
              </div>

              {/* Commission at the configured/editable rate */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="text-muted">{t('billing.commissionAmount')}:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <input
                      type="number"
                      className="form-input"
                      value={customCommissionRate}
                      min="0"
                      max="100"
                      step="0.1"
                      onChange={(e) => setCustomCommissionRate(e.target.value)}
                      style={{ width: 65, padding: '3px 6px', fontSize: '0.85rem', textAlign: 'right' }}
                      title={t('billing.commissionRate') || 'Commission Rate %'}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>%</span>
                  </div>
                </div>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>₹{commissionAmount.toFixed(2)}</span>
              </div>

              {/* Grand / Final Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--color-border)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 700 }}>{t('billing.grandTotal')}:</span>
                <span style={{ fontWeight: 800, color: 'var(--color-primary)', fontSize: '1.2rem' }}>
                  ₹{finalAmount.toFixed(2)}
                </span>
              </div>

              {/* Payment Status & Type Selection */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <div style={{ width: '48%' }}>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>{t('billing.status')}</label>
                  <select
                    className="form-input form-select"
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value)}
                    style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                  >
                    <option value="Paid">{t('billing.statusPaid') || 'Paid'}</option>
                    <option value="Credit">{t('billing.statusCredit') || 'Unpaid'}</option>
                    <option value="Partial">{t('billing.statusPartial') || 'Partial'}</option>
                  </select>
                </div>
                <div style={{ width: '48%' }}>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>Payment Method</label>
                  <select
                    className={`form-input form-select${errors.payment_type ? ' input-error' : ''}`}
                    value={paymentType}
                    onChange={(e) => {
                      setPaymentType(e.target.value);
                      if (errors.payment_type) setErrors(prev => ({ ...prev, payment_type: '' }));
                    }}
                    style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                  >
                    <option value="Cash">{t('billing.paymentTypeCash') || 'Cash'}</option>
                    <option value="UPI">{t('billing.paymentTypeUPI') || 'UPI'}</option>
                  </select>
                </div>
              </div>

              {/* Paid Amount Input (Only show if Partial) */}
              {paymentStatus === 'Partial' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span className="text-muted">{t('billing.paid')} (₹):</span>
                    <input
                      type="number"
                      className={`form-input${errors.paid_amount ? ' input-error' : ''}`}
                      value={paidAmount}
                      min="0"
                      step="any"
                      onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                      style={{ width: 120, padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}
                    />
                  </div>
                  {errors.paid_amount && <div style={{ color: 'var(--color-error)', fontSize: '0.8rem', textAlign: 'right', marginTop: -6 }}>{errors.paid_amount}</div>}
                </>
              )}

              {/* Remaining Balance Display */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span className="text-muted">{t('billing.remainingAmount')}:</span>
                <span style={{ fontWeight: 600, color: remainingAmount > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  ₹{remainingAmount.toFixed(2)}
                </span>
              </div>

            </div>
          </div>

          {/* Action Buttons */}
          <div className="modal-actions" style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 16 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onClose()}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
