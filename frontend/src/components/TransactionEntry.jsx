/**
 * TransactionEntry Component (MODULE A)
 * Customer-wise Vegetable Transaction Entry Interface
 * 
 * Features:
 * - Keyboard-first workflow: Customer -> Vegetable -> Weight -> Rate -> Save -> Reset & Focus Customer
 * - Payment Type Selector: Paid (Full), Credit (Udhar), Partial
 * - Payment Mode Selector: Cash, UPI, Other
 * - Live Payment Calculations (Paid Amount vs Remaining Udhar)
 * - Commission calculated at the shop's configured rate & total computation
 * - Read-only calculated fields (Base Amount, Commission, Final Amount)
 * - Non-blocking toast feedback
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import CustomerAutocomplete from './CustomerAutocomplete';
import VegetableAutocomplete from './VegetableAutocomplete';
import {
  calculateTransactionTotals,
  formatCommissionPercent,
  DEFAULT_COMMISSION_PERCENT,
} from '../utils/money';
import { getLocalDateString, formatDDMMYYYY, parseDDMMYYYY, isValidDDMMYYYY } from '../utils/dates';

export default function TransactionEntry({
  customers = [],
  vegetables = [],
  onSubmitTransaction,
  loading = false,
  onCustomerSelectForHistory,
  commissionRate = DEFAULT_COMMISSION_PERCENT,
  recentTransactions = []
}) {
  const { t } = useTranslation();
  const todayStr = getLocalDateString();

  const [transactionDate, setTransactionDate] = useState(todayStr);
  const [dateInputText, setDateInputText] = useState(formatDDMMYYYY(todayStr));
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedVegetable, setSelectedVegetable] = useState(null);
  const [weight, setWeight] = useState('');
  const [rate, setRate] = useState('');
  const [customCommRate, setCustomCommRate] = useState(String(commissionRate || DEFAULT_COMMISSION_PERCENT));
  const [paymentType, setPaymentType] = useState('Credit'); // 'Paid', 'Credit', 'Partial'
  const [paymentMode, setPaymentMode] = useState('Cash');  // 'Cash', 'UPI', 'Other'
  const [paidInput, setPaidInput] = useState('');
  const [errors, setErrors] = useState({});
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);

  useEffect(() => {
    setCustomCommRate(String(commissionRate || DEFAULT_COMMISSION_PERCENT));
  }, [commissionRate]);

  // Element Refs for Auto Focus & Arrow Navigation
  const customerRef = useRef(null);
  const vegetableRef = useRef(null);
  const weightRef = useRef(null);
  const rateRef = useRef(null);
  const commRateRef = useRef(null);
  const dateRef = useRef(null);
  const nativePickerRef = useRef(null);
  const paymentTypeRef = useRef(null);
  const paymentModeRef = useRef(null);
  const paidInputRef = useRef(null);
  const saveBtnRef = useRef(null);

  // Field focus helpers
  function focusCustomer() {
    customerRef.current?.focus();
    customerRef.current?.select?.();
  }

  function focusVegetable() {
    vegetableRef.current?.focus();
    vegetableRef.current?.select?.();
  }

  function focusWeight() {
    weightRef.current?.focus();
    weightRef.current?.select?.();
  }

  function focusRate() {
    rateRef.current?.focus();
    rateRef.current?.select?.();
  }

  function focusCommRate() {
    commRateRef.current?.focus();
    commRateRef.current?.select?.();
  }

  function focusDate() {
    dateRef.current?.focus();
  }

  function focusPaymentType() {
    paymentTypeRef.current?.focus();
  }

  function focusPaymentMode() {
    paymentModeRef.current?.focus();
  }

  function focusPaidInput() {
    paidInputRef.current?.focus();
    paidInputRef.current?.select?.();
  }

  function focusSaveBtn() {
    saveBtnRef.current?.focus();
  }

  // Auto focus Customer input on component mount
  useEffect(() => {
    const timer = setTimeout(() => {
      customerRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Calculate totals in real-time, at custom or shop configured commission rate
  const numWeight = parseFloat(weight) || 0;
  const numRate = parseFloat(rate) || 0;
  const effectiveCommissionRate = customCommRate !== '' && !isNaN(parseFloat(customCommRate)) && parseFloat(customCommRate) >= 0
    ? parseFloat(customCommRate)
    : (commissionRate || DEFAULT_COMMISSION_PERCENT);

  const { baseAmount, commissionAmount, finalAmount } = calculateTransactionTotals(
    numWeight,
    numRate,
    effectiveCommissionRate
  );

  // Paid & Remaining calculations
  let calculatedPaid = 0;
  let calculatedRemaining = finalAmount;

  if (paymentType === 'Paid') {
    calculatedPaid = finalAmount;
    calculatedRemaining = 0;
  } else if (paymentType === 'Partial') {
    const rawPaid = parseFloat(paidInput) || 0;
    calculatedPaid = Math.min(finalAmount, Math.max(0, Math.round(rawPaid * 100) / 100));
    calculatedRemaining = Math.round((finalAmount - calculatedPaid) * 100) / 100;
  } else {
    // Credit
    calculatedPaid = 0;
    calculatedRemaining = finalAmount;
  }

  // Handle Customer Selection
  function handleSelectCustomer(customer) {
    setSelectedCustomer(customer);
    if (customer && onCustomerSelectForHistory) {
      onCustomerSelectForHistory(customer.id);
    }
    if (customer) {
      if (customer.commission_rate !== undefined && customer.commission_rate !== null && String(customer.commission_rate).trim() !== '') {
        setCustomCommRate(String(customer.commission_rate));
      } else {
        setCustomCommRate(String(commissionRate || DEFAULT_COMMISSION_PERCENT));
      }
      setErrors((prev) => ({ ...prev, customer: null }));
      // If vegetable is already selected from a previous entry, jump straight to weight input!
      if (selectedVegetable) {
        setTimeout(() => {
          focusWeight();
        }, 50);
      } else {
        setTimeout(() => {
          focusVegetable();
        }, 50);
      }
    } else {
      setCustomCommRate(String(commissionRate || DEFAULT_COMMISSION_PERCENT));
    }
  }

  // Handle Vegetable Selection
  function handleSelectVegetable(veg) {
    setSelectedVegetable(veg);
    if (veg) {
      setRate(veg.rate != null ? String(veg.rate) : '');
      setErrors((prev) => ({ ...prev, vegetable: null }));
      setTimeout(() => {
        focusWeight();
      }, 50);
    }
  }

  // Form Validation & Smart Input Auto-Resolution
  function validate() {
    const errs = {};
    let cust = selectedCustomer;
    if (!cust) {
      const custInput = document.getElementById('customer-autocomplete-input');
      const typed = custInput?.value?.trim()?.toLowerCase();
      if (typed) {
        cust = customers.find((c) => c.name?.toLowerCase() === typed || c.mobile === typed)
             || customers.find((c) => c.name?.toLowerCase().includes(typed));
        if (cust) setSelectedCustomer(cust);
      } else if (customers.length === 1) {
        cust = customers[0];
        setSelectedCustomer(cust);
      }
    }
    if (!cust) {
      errs.customer = t('transactions.customerRequired');
    }

    let veg = selectedVegetable;
    if (!veg) {
      const vegInput = document.getElementById('vegetable-input');
      const typed = vegInput?.value?.trim()?.toLowerCase();
      if (typed) {
        veg = vegetables.find((v) => v.name?.toLowerCase() === typed)
           || vegetables.find((v) => v.name?.toLowerCase().includes(typed));
        if (veg) {
          setSelectedVegetable(veg);
          if (!rate && veg.rate != null) setRate(String(veg.rate));
        }
      } else if (vegetables.length === 1) {
        veg = vegetables[0];
        setSelectedVegetable(veg);
        if (!rate && veg.rate != null) setRate(String(veg.rate));
      }
    }
    if (!veg) {
      errs.vegetable = t('transactions.vegetableRequired');
    }

    if (isNaN(numWeight) || numWeight <= 0) {
      errs.weight = t('transactions.weightRequired');
    }
    if (isNaN(numRate) || numRate < 0) {
      errs.rate = t('transactions.rateRequired');
    }
    setErrors(errs);
    return { valid: Object.keys(errs).length === 0, cust, veg };
  }

  // Actual execution of submit after duplicate checks pass or confirmed
  async function executeSubmit(payloadToSubmit) {
    const res = await onSubmitTransaction(payloadToSubmit);
    if (res?.success) {
      setDuplicatePrompt(null);
      // Mandi workflow: Keep selected vegetable & rate sticky for consecutive customer sales.
      // Reset customer and weight fields for the next buyer.
      setSelectedCustomer(null);
      setWeight('');
      setPaidInput('');
      setPaymentType('Credit');
      setPaymentMode('Cash');
      setCustomCommRate(String(commissionRate || DEFAULT_COMMISSION_PERCENT));
      setErrors({});

      // Clear customer autocomplete
      customerRef.current?.clear();

      // Return focus directly to Customer input for the next buyer
      setTimeout(() => {
        focusCustomer();
      }, 50);
    }
  }

  // Submit Handler with duplicate check
  async function handleSubmit(e) {
    if (e) e.preventDefault();
    const validation = validate();
    if (!validation.valid) return;

    const currentCustomer = validation.cust || selectedCustomer;
    const currentVegetable = validation.veg || selectedVegetable;

    const payload = {
      customer_id: currentCustomer.id,
      vegetable_id: currentVegetable.id,
      vegetable_name_snapshot: currentVegetable.name,
      weight: numWeight,
      rate: numRate,
      commission_rate: effectiveCommissionRate,
      unit: currentVegetable.unit || 'kg',
      payment_type: paymentType,
      payment_mode: paymentType === 'Credit' ? 'Credit' : paymentMode,
      paid_amount: calculatedPaid,
      remaining_amount: calculatedRemaining,
      transaction_date: transactionDate
    };

    // Duplicate detection: same customer, vegetable, weight, rate, and date in recent transactions
    const isDuplicate = recentTransactions && recentTransactions.some((t) => {
      const cMatch = Number(t.customer_id) === Number(selectedCustomer.id);
      const vMatch = Number(t.vegetable_id) === Number(selectedVegetable.id);
      const wMatch = Math.abs(Number(t.weight) - numWeight) < 0.001;
      const rMatch = Math.abs(Number(t.rate) - numRate) < 0.001;
      const dMatch = t.transaction_date ? t.transaction_date.startsWith(transactionDate) : true;
      return cMatch && vMatch && wMatch && rMatch && dMatch;
    });

    if (isDuplicate) {
      setDuplicatePrompt(payload);
      return;
    }

    await executeSubmit(payload);
  }

  // KeyDown Navigation Logic
  function handleWeightKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusVegetable();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusRate();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (numWeight > 0) {
        setErrors((prev) => ({ ...prev, weight: null }));
        focusRate();
      } else {
        setErrors((prev) => ({ ...prev, weight: t('transactions.weightRequired') }));
      }
    }
  }

  function handleRateKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusWeight();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusCommRate();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isNaN(numRate) && numRate >= 0) {
        setErrors((prev) => ({ ...prev, rate: null }));
        focusCommRate();
      } else {
        setErrors((prev) => ({ ...prev, rate: t('transactions.rateRequired') }));
      }
    }
  }

  function handleCommRateKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusRate();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      focusDate();
    }
  }

  function handleDateKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusCommRate();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      focusPaymentType();
    }
  }

  function handlePaymentTypeKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusDate();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (paymentType !== 'Credit') {
        focusPaymentMode();
      } else {
        focusSaveBtn();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (paymentType === 'Partial') {
        focusPaidInput();
      } else {
        focusSaveBtn();
      }
    }
  }

  function handlePaymentModeKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusPaymentType();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (paymentType === 'Partial') {
        focusPaidInput();
      } else {
        focusSaveBtn();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (paymentType === 'Partial') {
        focusPaidInput();
      } else {
        focusSaveBtn();
      }
    }
  }

  function handlePaidKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusPaymentMode();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusSaveBtn();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSaveBtnKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (paymentType === 'Partial') {
        focusPaidInput();
      } else if (paymentType !== 'Credit') {
        focusPaymentMode();
      } else {
        focusPaymentType();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusCustomer();
    }
  }

  return (
    <div className="card" style={{ padding: '1.5rem', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-text-primary)', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
          {t('transactions.entryTitle')}
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-light)', padding: '4px 12px', borderRadius: 'var(--border-radius-pill)', border: '1px solid var(--color-border)', fontWeight: 600 }}>
          ⌨️ ← → ↑ ↓ Arrow Keys / Enter to navigate
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          {/* Customer Input */}
          <div>
            <label htmlFor="customer-input" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
              1. {t('transactions.selectCustomer')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <CustomerAutocomplete
              ref={customerRef}
              id="customer-input"
              name="customer"
              customers={customers}
              selectedCustomer={selectedCustomer}
              onSelectCustomer={handleSelectCustomer}
              onNavigateNext={() => {
                if (selectedVegetable) {
                  focusWeight();
                } else {
                  focusVegetable();
                }
              }}
              placeholder={t('transactions.selectCustomer')}
              hasError={!!errors.customer}
            />
            {errors.customer && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '2px', display: 'block' }}>
                {errors.customer}
              </span>
            )}
          </div>

          {/* Vegetable Input */}
          <div>
            <label htmlFor="vegetable-input" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
              2. {t('transactions.selectVegetable')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <VegetableAutocomplete
              ref={vegetableRef}
              id="vegetable-input"
              name="vegetable"
              vegetables={vegetables}
              selectedVegetable={selectedVegetable}
              onSelectVegetable={handleSelectVegetable}
              onNavigateNext={() => focusWeight()}
              onNavigatePrev={() => focusCustomer()}
              placeholder={t('transactions.selectVegetable')}
              hasError={!!errors.vegetable}
            />
            {errors.vegetable && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '2px', display: 'block' }}>
                {errors.vegetable}
              </span>
            )}
          </div>

          {/* Weight Input */}
          <div>
            <label htmlFor="weight-input" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
              3. {t('transactions.weight')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              ref={weightRef}
              id="weight-input"
              name="weight"
              type="number"
              step="any"
              min="0.01"
              className={`input-field ${errors.weight ? 'input-error' : ''}`}
              placeholder={t('transactions.weightPlaceholder') || 'उदा. 10.5 kg'}
              title={t('transactions.weight')}
              value={weight}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setWeight(e.target.value);
                setErrors((prev) => ({ ...prev, weight: null }));
              }}
              onKeyDown={handleWeightKeyDown}
              style={{ fontSize: '1.05rem', padding: '0.65rem 0.85rem' }}
            />
            {errors.weight && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '2px', display: 'block' }}>
                {errors.weight}
              </span>
            )}
          </div>

          {/* Rate Input */}
          <div>
            <label htmlFor="rate-input" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
              4. {t('transactions.rate')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              ref={rateRef}
              id="rate-input"
              name="rate"
              type="number"
              step="any"
              min="0"
              className={`input-field ${errors.rate ? 'input-error' : ''}`}
              placeholder={t('transactions.ratePlaceholder') || 'उदा. 35 ₹/kg'}
              title={t('transactions.rate')}
              value={rate}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setRate(e.target.value);
                setErrors((prev) => ({ ...prev, rate: null }));
              }}
              onKeyDown={handleRateKeyDown}
              style={{ fontSize: '1.05rem', padding: '0.65rem 0.85rem' }}
            />
            {errors.rate && (
              <span style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '2px', display: 'block' }}>
                {errors.rate}
              </span>
            )}
          </div>

          {/* Custom Commission Rate Input */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label htmlFor="comm-rate-input" className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                5. {t('transactions.customCommission')}
              </label>
              {parseFloat(customCommRate) !== parseFloat(commissionRate || DEFAULT_COMMISSION_PERCENT) && (
                <button
                  type="button"
                  onClick={() => setCustomCommRate(String(commissionRate || DEFAULT_COMMISSION_PERCENT))}
                  style={{
                    border: 'none',
                    background: '#e0e7ff',
                    color: '#3730a3',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  title="Reset to default"
                >
                  Reset ({commissionRate || DEFAULT_COMMISSION_PERCENT}%)
                </button>
              )}
            </div>
            <input
              ref={commRateRef}
              id="comm-rate-input"
              name="commissionRate"
              type="number"
              step="any"
              min="0"
              max="100"
              className="input-field"
              placeholder={t('transactions.customCommissionPlaceholder') || 'उदा. 8'}
              title={t('transactions.customCommission')}
              value={customCommRate}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setCustomCommRate(e.target.value)}
              onKeyDown={handleCommRateKeyDown}
              style={{ fontSize: '1rem', padding: '0.65rem 0.85rem', color: '#4338ca', fontWeight: 600 }}
            />
          </div>

          {/* Transaction Date (Strictly DD/MM/YYYY, Defaults to Today, with calendar picker & backdating) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label htmlFor="tx-date-input" className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                6. {t('billing.date') || 'तारीख / Date'} <span style={{ fontSize: '0.75rem', color: '#6366f1' }}>(DD/MM/YYYY)</span>
              </label>
              {transactionDate !== todayStr && (
                <button
                  type="button"
                  onClick={() => {
                    setTransactionDate(todayStr);
                    setDateInputText(formatDDMMYYYY(todayStr));
                  }}
                  style={{
                    border: 'none',
                    background: '#fef3c7',
                    color: '#b45309',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                  title="Reset to today"
                >
                  आजची तारीख
                </button>
              )}
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                ref={dateRef}
                id="tx-date-input"
                name="transactionDateText"
                type="text"
                placeholder="DD/MM/YYYY"
                title="तारीख (DD/MM/YYYY)"
                className="input-field"
                value={dateInputText}
                onChange={(e) => {
                  const val = e.target.value;
                  setDateInputText(val);
                  const iso = parseDDMMYYYY(val);
                  if (iso) {
                    setTransactionDate(iso);
                  }
                }}
                onBlur={() => {
                  if (isValidDDMMYYYY(dateInputText)) {
                    const iso = parseDDMMYYYY(dateInputText);
                    setTransactionDate(iso);
                    setDateInputText(formatDDMMYYYY(iso));
                  } else {
                    setDateInputText(formatDDMMYYYY(transactionDate || todayStr));
                  }
                }}
                onKeyDown={handleDateKeyDown}
                style={{
                  fontSize: '0.95rem',
                  padding: '0.65rem 2.2rem 0.65rem 0.85rem',
                  borderColor: transactionDate !== todayStr ? '#f59e0b' : undefined,
                  background: transactionDate !== todayStr ? '#fffbeb' : undefined,
                  fontWeight: transactionDate !== todayStr ? 700 : 500,
                  width: '100%'
                }}
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    nativePickerRef.current?.showPicker?.();
                  } catch {
                    nativePickerRef.current?.focus();
                  }
                }}
                style={{
                  position: 'absolute',
                  right: 8,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  padding: '2px 4px',
                  lineHeight: 1
                }}
                title="कॅलेंडर उघडा (Open Calendar)"
                tabIndex={-1}
              >
                📅
              </button>
              <input
                ref={nativePickerRef}
                type="date"
                max={todayStr}
                value={transactionDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setTransactionDate(e.target.value);
                    setDateInputText(formatDDMMYYYY(e.target.value));
                  }
                }}
                style={{
                  position: 'absolute',
                  opacity: 0,
                  pointerEvents: 'none',
                  width: 0,
                  height: 0,
                  bottom: 0,
                  right: 0
                }}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
            {transactionDate !== todayStr && (
              <span style={{ color: '#b45309', fontSize: '0.75rem', marginTop: '2px', display: 'block', fontWeight: 600 }}>
                ⚠️ मागील तारीख: {formatDDMMYYYY(transactionDate)}
              </span>
            )}
          </div>

          {/* Payment Type Selector (Credit, Paid, Partial) */}
          <div>
            <label htmlFor="payment-type-select" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
              7. {t('billing.paymentStatus')}
            </label>
            <select
              ref={paymentTypeRef}
              id="payment-type-select"
              name="paymentType"
              title={t('billing.paymentStatus')}
              className="input-field"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
              onKeyDown={handlePaymentTypeKeyDown}
              style={{ fontSize: '0.95rem', padding: '0.65rem 0.85rem', fontWeight: 600 }}
            >
              <option value="Credit">🔴 {t('billing.statusCredit')}</option>
              <option value="Paid">🟢 {t('billing.statusPaid')}</option>
              <option value="Partial">🟡 {t('billing.statusPartial')}</option>
            </select>
          </div>

          {/* Payment Mode Selector (Cash, UPI, Other) */}
          {paymentType !== 'Credit' && (
            <div>
              <label htmlFor="payment-mode-select" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                {t('credit.paymentMode')}
              </label>
              <select
                ref={paymentModeRef}
                id="payment-mode-select"
                name="paymentMode"
                title={t('credit.paymentMode')}
                className="input-field"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                onKeyDown={handlePaymentModeKeyDown}
                style={{ fontSize: '0.95rem', padding: '0.65rem 0.85rem' }}
              >
                <option value="Cash">💵 {t('billing.paymentTypeCash')}</option>
                <option value="UPI">📱 {t('billing.paymentTypeUPI')}</option>
                <option value="Other">💳 {t('credit.modeOther')}</option>
              </select>
            </div>
          )}

          {/* Paid Amount Input (Shown when Partial is selected) */}
          {paymentType === 'Partial' && (
            <div>
              <label htmlFor="paid-input" className="form-label" style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                {t('billing.paid')} (₹)
              </label>
              <input
                ref={paidInputRef}
                id="paid-input"
                name="paidAmount"
                type="number"
                step="any"
                min="0"
                max={finalAmount}
                className="input-field"
                placeholder={t('transactions.paidPlaceholder') || 'उदा. 500 ₹'}
                title={t('billing.paid')}
                value={paidInput}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPaidInput(e.target.value)}
                onKeyDown={handlePaidKeyDown}
                style={{ fontSize: '1rem', padding: '0.65rem 0.85rem' }}
              />
            </div>
          )}
        </div>

        {/* Calculated Financial Summaries Panel & Action Bar */}
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1.25rem',
            background: 'var(--color-bg-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}
        >
          {/* 5 Financial Metric Chips - Evenly Distributed Grid */}
          <div
            className="tx-calc-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.85rem',
              width: '100%'
            }}
          >
            {/* 1. Base Amount */}
            <div style={{ background: 'var(--color-surface)', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                {t('transactions.baseAmount')}
              </span>
              <strong style={{ fontSize: '1.15rem', color: 'var(--color-text-primary)' }}>
                ₹{baseAmount.toFixed(2)}
              </strong>
            </div>

            {/* 2. Commission */}
            <div style={{ background: 'var(--color-surface)', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: '#4338ca', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                {t('transactions.commission')} ({formatCommissionPercent(effectiveCommissionRate)})
              </span>
              <strong style={{ fontSize: '1.15rem', color: '#4338ca' }}>
                ₹{commissionAmount.toFixed(2)}
              </strong>
            </div>

            {/* 3. Final Amount */}
            <div style={{ background: 'var(--color-success-bg)', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid #86efac', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: '#15803d', display: 'block', fontWeight: 700, marginBottom: '4px' }}>
                {t('transactions.finalAmount')}
              </span>
              <strong style={{ fontSize: '1.25rem', color: '#15803d', fontWeight: 800 }}>
                ₹{finalAmount.toFixed(2)}
              </strong>
            </div>

            {/* 4. Paid Amount */}
            <div style={{ background: 'var(--color-surface)', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: '#15803d', display: 'block', fontWeight: 600, marginBottom: '4px' }}>
                {t('billing.paid')}
              </span>
              <strong style={{ fontSize: '1.15rem', color: '#15803d' }}>
                ₹{calculatedPaid.toFixed(2)}
              </strong>
            </div>

            {/* 5. Remaining Udhar */}
            <div style={{ background: calculatedRemaining > 0 ? '#fef2f2' : 'var(--color-surface)', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-sm)', border: calculatedRemaining > 0 ? '1px solid #fca5a5' : '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.74rem', color: '#dc2626', display: 'block', fontWeight: 700, marginBottom: '4px' }}>
                {t('billing.remainingAmount')} (Udhar)
              </span>
              <strong style={{ fontSize: '1.2rem', color: '#dc2626', fontWeight: 800 }}>
                ₹{calculatedRemaining.toFixed(2)}
              </strong>
            </div>
          </div>

          {/* Action Row - Save Button */}
          <div className="tx-save-action-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border-light)', paddingTop: '1rem' }}>
            <button
              ref={saveBtnRef}
              id="save-transaction-btn"
              type="submit"
              disabled={loading}
              onKeyDown={handleSaveBtnKeyDown}
              className="btn btn-primary"
              style={{
                padding: '0.85rem 2.2rem',
                fontSize: '1rem',
                fontWeight: 700,
                borderRadius: 'var(--border-radius-pill)',
                minWidth: '240px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(20, 110, 245, 0.3)',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderTopColor: '#ffffff' }} />
                  <span>{t('transactions.saving')}...</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.15rem' }}>💾</span>
                  <span>{t('transactions.saveTransaction')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Duplicate Transaction Confirmation Popup Modal */}
      {duplicatePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-warning-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '1.75rem',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #fed7aa',
              textAlign: 'center'
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#fff7ed',
                border: '2px solid #fdba74',
                color: '#ea580c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.75rem',
                margin: '0 auto 1rem'
              }}
            >
              ⚠️
            </div>

            <h3
              id="duplicate-warning-title"
              style={{
                margin: '0 0 0.5rem 0',
                fontSize: '1.25rem',
                fontWeight: 800,
                color: '#9a3412',
                fontFamily: 'var(--font-display)'
              }}
            >
              {t('transactions.duplicateWarningTitle')}
            </h3>

            <p style={{ fontSize: '0.95rem', color: '#4b5563', lineHeight: 1.5, margin: '0 0 1.25rem 0' }}>
              {t('transactions.duplicateWarningMsg')}
            </p>

            {/* Quick summary box */}
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: '8px',
                padding: '0.75rem',
                marginBottom: '1.5rem',
                fontSize: '0.85rem',
                color: '#92400e',
                textAlign: 'left'
              }}
            >
              <div>👤 <strong>{selectedCustomer?.name}</strong></div>
              <div>🥬 <strong>{selectedVegetable?.name}</strong>: {duplicatePrompt.weight} {duplicatePrompt.unit} @ ₹{duplicatePrompt.rate}</div>
              <div>📅 <strong>तारीख: {formatDDMMYYYY(duplicatePrompt.transaction_date)}</strong></div>
              <div>💰 <strong>Total: ₹{finalAmount.toFixed(2)}</strong></div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setDuplicatePrompt(null)}
                className="btn"
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: 'var(--border-radius-pill)',
                  border: '1px solid #d1d5db',
                  background: '#f3f4f6',
                  color: '#374151',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => executeSubmit(duplicatePrompt)}
                className="btn btn-primary"
                style={{
                  padding: '0.65rem 1.4rem',
                  borderRadius: 'var(--border-radius-pill)',
                  background: '#ea580c',
                  borderColor: '#c2410c',
                  color: '#ffffff',
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(234, 88, 12, 0.35)',
                  cursor: 'pointer'
                }}
              >
                {t('transactions.addAnyway')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
