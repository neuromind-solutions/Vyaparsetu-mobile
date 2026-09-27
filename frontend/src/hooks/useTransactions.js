import { useState, useEffect, useCallback, useMemo } from 'react';
import { transactionApi, customersApi, vegetablesApi } from '../services/apiService';
import { getLocalDateString, getYesterdayDateString, getDaysAgoDateString } from '../utils/dates';
import { cloudSyncService } from '../services/cloudSyncService';

/**
 * How far back the date-range filter reaches when the vendor first opens it.
 *
 * It used to open on today→today, which made the range filter useless for the one job
 * it exists for. A customer who last bought a fortnight ago showed an empty table and a
 * disabled Generate Bill button, and nothing on screen said unbilled entries existed at
 * all — the only way through was to guess that the start date needed dragging backwards.
 *
 * A month covers how long an adatya's customer actually runs a tab before settling, so
 * the default range already contains the entries in the overwhelming majority of cases.
 * The end stays today: the vendor is billing up to now, not up to some past date.
 *
 * This only picks the *starting position* of two inputs the vendor can still move
 * anywhere. It does not widen what gets billed — generateBillFromTransactions bills the
 * span shown in the inputs, and the Pending Settlements panel sets that span to a
 * customer's exact oldest→newest so nothing outside their own entries is ever included.
 */
const RANGE_LOOKBACK_DAYS = 30;

export function useTransactions() {
  const [customers, setCustomers] = useState([]);
  const [vegetables, setVegetables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Active customer & date filtering for history
  const [activeCustomerId, setActiveCustomerId] = useState(null);
  const [dateFilterType, setDateFilterType] = useState('today'); // 'today', 'yesterday', 'specific', 'range'
  const [selectedDate, setSelectedDate] = useState(getLocalDateString());
  const [startDate, setStartDate] = useState(getDaysAgoDateString(RANGE_LOOKBACK_DAYS));
  const [endDate, setEndDate] = useState(getLocalDateString());

  // Customers with entries waiting to be billed. Read-only; it only tells the vendor
  // where the unbilled work is.
  const [pendingSettlements, setPendingSettlements] = useState([]);

  // Purchase History state
  const [dailyData, setDailyData] = useState({
    summary: { total_transactions: 0, total_weight: 0, total_base_amount: 0, total_commission: 0, total_final_amount: 0 },
    transactions: []
  });
  const [historyLoading, setHistoryLoading] = useState(false);

  // Initial load of customers and vegetables masters
  const loadMasterData = useCallback(async () => {
    try {
      const [resCust, resVeg] = await Promise.all([
        customersApi.getAll(),
        vegetablesApi.getAll()
      ]);
      if (resCust?.success) setCustomers(resCust.data || []);
      if (resVeg?.success) setVegetables(resVeg.data || []);
    } catch (err) {
      console.error('Failed to load customers/vegetables master data:', err);
    }
  }, []);

  /**
   * Refresh the pending-settlements list.
   */
  const loadPendingSettlements = useCallback(async () => {
    try {
      const res = await transactionApi.getPendingSettlements();
      if (res?.success) setPendingSettlements(res.data || []);
    } catch (err) {
      console.error('Failed to load pending settlements:', err);
    }
  }, []);

  useEffect(() => {
    loadMasterData();
    loadPendingSettlements();
    const onSynced = () => {
      loadMasterData();
      loadPendingSettlements();
    };
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [loadMasterData, loadPendingSettlements]);

  // Fetch daily/range customer transactions
  const fetchCustomerHistory = useCallback(async (customerId, filterType, sDate, eDate, specDate) => {
    if (!customerId) {
      setDailyData({
        summary: { total_transactions: 0, total_weight: 0, total_base_amount: 0, total_commission: 0, total_final_amount: 0 },
        transactions: []
      });
      return;
    }

    setHistoryLoading(true);
    try {
      let targetDate = specDate || getLocalDateString();
      if (filterType === 'today') {
        targetDate = getLocalDateString();
      } else if (filterType === 'yesterday') {
        targetDate = getYesterdayDateString();
      }

      if (filterType === 'range') {
        const resRange = await transactionApi.getCustomerRange(customerId, sDate, eDate);
        if (resRange?.success) {
          const list = resRange.data || [];
          const totalWeight = list.reduce((acc, t) => acc + Number(t.weight || 0), 0);
          const totalBase = list.reduce((acc, t) => acc + Number(t.base_amount || 0), 0);
          const totalComm = list.reduce((acc, t) => acc + Number(t.commission_amount || 0), 0);
          const totalFinal = list.reduce((acc, t) => acc + Number(t.final_amount || 0), 0);

          setDailyData({
            summary: {
              total_transactions: list.length,
              total_weight: Math.round(totalWeight * 100) / 100,
              total_base_amount: Math.round(totalBase * 100) / 100,
              total_commission: Math.round(totalComm * 100) / 100,
              total_final_amount: Math.round(totalFinal * 100) / 100
            },
            transactions: list
          });
        }
      } else {
        const resDaily = await transactionApi.getCustomerDaily(customerId, targetDate);
        if (resDaily?.success) {
          setDailyData({
            summary: resDaily.data.summary,
            transactions: resDaily.data.transactions || []
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch customer history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
  }, [activeCustomerId, dateFilterType, startDate, endDate, selectedDate, fetchCustomerHistory]);

  /**
   * The period the Generate Bill button should bill.
   *
   * Derived from the same filter that drives the history table, so a bill covers
   * exactly what the vendor is looking at. The button used to send `selectedDate`
   * unconditionally — and `selectedDate` is today unless the "specific date" input was
   * touched, so a vendor reviewing yesterday's purchases and pressing Generate Bill
   * billed today's instead.
   */
  const billPeriod = useMemo(() => {
    if (dateFilterType === 'range') return { startDate, endDate };
    if (dateFilterType === 'today') return { date: getLocalDateString() };
    if (dateFilterType === 'yesterday') return { date: getYesterdayDateString() };
    return { date: selectedDate };
  }, [dateFilterType, selectedDate, startDate, endDate]);

  // Create a new transaction
  async function createTransaction(payload) {
    setLoading(true);
    setError(null);
    try {
      const res = await transactionApi.create(payload);
      if (res?.success) {
        setToastMessage({ text: 'saveSuccess', type: 'success' });
        // Automatically refresh history if the transaction belongs to the active customer
        if (activeCustomerId === Number(payload.customer_id)) {
          fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
        }
        // A new entry is unbilled by definition, so it belongs in the pending list.
        loadPendingSettlements();
        cloudSyncService.triggerImmediateSync();
        return { success: true, data: res.data };
      }
      setError(res?.error || 'Transaction save failed');
      return { success: false, error: res?.error };
    } catch (err) {
      const msg = err.message || 'Failed to save transaction';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Generate a consolidated bill.
   *
   * `period` is either `{ date }` for a single day or `{ startDate, endDate }` for a
   * range. A bare date string is still accepted, because that is what every existing
   * caller passes.
   */
  async function generateBill(customerId, period) {
    setLoading(true);
    setError(null);
    try {
      const payload =
        typeof period === 'string' || period == null
          ? { customerId, date: period }
          : { customerId, ...period };

      const res = await transactionApi.generateBill(payload);
      if (res?.success) {
        setToastMessage({ text: 'billGeneratedSuccess', type: 'success' });
        // Those entries now carry a bill_id, so this customer's settlement is closed and
        // must leave the pending list — otherwise the panel keeps offering a bill that
        // would find nothing left to consolidate.
        loadPendingSettlements();
        fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
        cloudSyncService.triggerImmediateSync();
        return { success: true, data: res.data };
      }
      setError(res?.error || 'Failed to generate bill');
      return { success: false, error: res?.error };
    } catch (err) {
      const msg = err.message || 'Failed to generate bill';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Generate a read-only period statement (not saved to DB).
   *
   * Returns a bill-shaped object for display/print/share, without creating
   * an invoice in the database. Used for date-range customer reports.
   */
  async function generateStatement(customerId, { startDate: sd, endDate: ed }) {
    setLoading(true);
    setError(null);
    try {
      const res = await transactionApi.generateStatement({ customerId, startDate: sd, endDate: ed });
      if (res?.success) {
        return { success: true, data: res.data };
      }
      setError(res?.error || 'Failed to generate statement');
      return { success: false, error: res?.error };
    } catch (err) {
      const msg = err.message || 'Failed to generate statement';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }

  // Delete transaction
  async function deleteTransaction(id) {

    setLoading(true);
    try {
      const res = await transactionApi.remove(id);
      if (res?.success) {
        setToastMessage({ text: 'deleteSuccess', type: 'success' });
        if (activeCustomerId) {
          fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
        }
        // One fewer unbilled entry — and possibly the customer's last one, which drops
        // them off the panel entirely.
        loadPendingSettlements();
        await cloudSyncService.deleteFromSupabase('transactions', id).catch(() => {});
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      // The backend refuses to delete an entry that belongs to a bill, and this used to
      // return that refusal to a caller that ignored it: the confirm modal closed, the
      // row stayed, and no message appeared anywhere. The button is disabled on billed
      // rows now, but the table can still be a few seconds stale — the entry may have
      // been billed since it was drawn — so the reason has to reach the vendor.
      setToastMessage({ text: 'deleteFailed', detail: res?.error, type: 'error' });
      return { success: false, error: res?.error };
    } catch (err) {
      setToastMessage({ text: 'deleteFailed', detail: err.message, type: 'error' });
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Point the history view at one pending settlement.
   *
   * Sets the customer and the exact span their unbilled entries occupy, so the table
   * below fills with precisely what a bill would consolidate and the Generate Bill
   * button — which is disabled while the table is empty — comes alive.
   *
   * Deliberately does not generate the bill. Billing is a real write that books a
   * settlement document against a customer, and the vendor should see the entries before
   * committing to it. Keeping generation in one place also keeps one code path: this
   * panel is a way to *reach* the bill, not a second way to make one.
   */
  const openSettlement = useCallback((settlement) => {
    if (!settlement) return;
    setActiveCustomerId(Number(settlement.customer_id));
    setDateFilterType('range');
    setStartDate(settlement.oldest_date);
    setEndDate(settlement.newest_date);
  }, []);

  // Update transaction
  async function updateTransaction(id, payload) {
    setLoading(true);
    setError(null);
    try {
      const res = await transactionApi.update(id, payload);
      if (res?.success) {
        setToastMessage({ text: 'updateSuccess', type: 'success' });
        if (activeCustomerId) {
          fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
        }
        loadPendingSettlements();
        cloudSyncService.triggerImmediateSync();
        return { success: true, data: res.data };
      }
      setToastMessage({ text: 'updateFailed', detail: res?.error, type: 'error' });
      return { success: false, error: res?.error };
    } catch (err) {
      setToastMessage({ text: 'updateFailed', detail: err.message, type: 'error' });
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }

  const handleBillUpdated = useCallback(() => {
    loadMasterData();
    loadPendingSettlements();
    if (activeCustomerId) {
      fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate);
    }
  }, [loadMasterData, loadPendingSettlements, activeCustomerId, dateFilterType, startDate, endDate, selectedDate, fetchCustomerHistory]);

  return {
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
    refreshPendingSettlements: loadPendingSettlements,
    createTransaction,
    updateTransaction,
    generateBill,
    generateStatement,
    deleteTransaction,
    onBillUpdated: handleBillUpdated,
    refreshHistory: () => fetchCustomerHistory(activeCustomerId, dateFilterType, startDate, endDate, selectedDate)
  };
}

