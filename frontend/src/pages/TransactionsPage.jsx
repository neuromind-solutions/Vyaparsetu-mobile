/**
 * TransactionsPage Component
 * Main page integrating Module A (Transaction Entry) and Module B (Daily Purchase History).
 */

import { useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useTransactions } from '../hooks/useTransactions';
import useSettings from '../hooks/useSettings';
import TransactionEntry from '../components/TransactionEntry';
import PendingSettlements from '../components/PendingSettlements';
import CustomerDailyPurchase from '../components/CustomerDailyPurchase';

/**
 * Non-blocking toast.
 *
 * Carries errors as well as confirmations. It was hardcoded green with a ✅, so the only
 * way to report a refusal was to dress it as a success — which is why refusals were
 * dropped on the floor instead.
 */
function ToastNotification({ toast, onClose, t }) {
  if (!toast) return null;

  const isError = toast.type === 'error';

  // `t()` returns the key itself when a translation is missing, so the old
  // `t(key) || toast.text` never fell back — it rendered "transactions.deleteFailed".
  const key = `transactions.${toast.text}`;
  const translated = t(key);
  const headline = translated === key ? toast.text : translated;

  return (
    <div
      className={`toast toast-${toast.type || 'success'}`}
      id="transaction-toast"
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        maxWidth: '26rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 18px',
        background: isError ? '#b91c1c' : '#15803d',
        color: 'white',
        borderRadius: '6px',
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)',
        fontWeight: 600
      }}
    >
      <span style={{ display: 'inline-block' }}>
        <span>{isError ? '⚠️' : '✅'}</span> <span>{headline}</span>
        {toast.detail && (
          <span style={{ display: 'block', fontWeight: 400, fontSize: '0.82rem', marginTop: 3, opacity: 0.95 }}>
            {toast.detail}
          </span>
        )}
      </span>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          color: 'white',
          cursor: 'pointer',
          fontSize: '1rem',
          padding: '0 4px'
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function TransactionsPage() {
  const { t } = useTranslation();

  const {
    customers,
    vegetables,
    loading,
    error,
    toastMessage,
    setToastMessage,
    activeCustomerId,
    setActiveCustomerId,
    dateFilterType,
    setDateFilterType,
    selectedDate,
    setSelectedDate,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    billPeriod,
    dailyData,
    historyLoading,
    pendingSettlements,
    openSettlement,
    createTransaction,
    updateTransaction,
    generateBill,
    generateStatement,
    deleteTransaction,
    onBillUpdated
  } = useTransactions();

  // The commission rate is a shop-wide setting. It is read here so the live totals
  // in the entry form match what the server will calculate and store.
  const { settings } = useSettings();

  // Auto hide the toast. An error explains a rule and often names a next step, so it is
  // given longer to be read than a confirmation that only says "saved".
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, toastMessage.type === 'error' ? 7000 : 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, setToastMessage]);

  return (
    <div className="page-container" id="transactions-page">
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 className="page-title">{t('transactions.title')}</h1>
          <p className="page-subtitle">{t('transactions.subtitle')}</p>
        </div>
      </div>

      {/* General Error Banner */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '6px' }}>
          ⚠️ {error}
        </div>
      )}

      {/* MODULE A: Customer-wise Vegetable Transaction Entry */}
      <TransactionEntry
        customers={customers}
        vegetables={vegetables}
        onSubmitTransaction={createTransaction}
        loading={loading}
        onCustomerSelectForHistory={(cId) => setActiveCustomerId(cId)}
        commissionRate={settings.commission_rate}
        recentTransactions={dailyData?.transactions || []}
      />

      {/* Where the unbilled work is. Sits directly above the history view because
          clicking a row fills that view — cause and effect stay adjacent, and the
          entry form above keeps its place at the top for the far more frequent job
          of logging the day's sales. */}
      <PendingSettlements
        settlements={pendingSettlements}
        activeCustomerId={activeCustomerId}
        onOpenSettlement={openSettlement}
      />

      {/* MODULE B: Customer Daily Purchase & Transaction History */}
      <CustomerDailyPurchase
        customers={customers}
        vegetables={vegetables}
        activeCustomerId={activeCustomerId}
        onSelectCustomer={(cId) => setActiveCustomerId(cId)}
        dateFilterType={dateFilterType}
        onChangeDateFilterType={setDateFilterType}
        selectedDate={selectedDate}
        onChangeSelectedDate={setSelectedDate}
        startDate={startDate}
        onChangeStartDate={setStartDate}
        endDate={endDate}
        onChangeEndDate={setEndDate}
        billPeriod={billPeriod}
        dailyData={dailyData}
        historyLoading={historyLoading}
        onDeleteTransaction={deleteTransaction}
        onUpdateTransaction={updateTransaction}
        onGenerateBill={generateBill}
        onGenerateStatement={generateStatement}
        onBillUpdated={onBillUpdated}
        commissionRate={settings.commission_rate}
      />


      {/* Non-blocking Toast Notification */}
      <ToastNotification
        toast={toastMessage}
        onClose={() => setToastMessage(null)}
        t={t}
      />
    </div>
  );
}
