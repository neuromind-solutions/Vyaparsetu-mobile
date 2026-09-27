// frontend/src/hooks/useCredit.js
import { useState, useEffect, useCallback, useMemo } from 'react';
import { creditApi } from '../services/apiService';
import { applyFuzzyFilter } from '../utils/fuzzySearch';
import { cloudSyncService } from '../services/cloudSyncService';

export function useCredit() {
  const [summary, setSummary] = useState({ total_outstanding: 0, today_added: 0, today_recovered: 0 });
  const [allCustomers, setAllCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Active selected customer details
  const [activeCustomerId, setActiveCustomerId] = useState(null);
  const [activeCustomer, setActiveCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await creditApi.getSummary();
      if (res.success) setSummary(res.data);
    } catch (e) {
      console.error('Failed to fetch credit summary:', e.message);
    }
  }, []);

  const fetchCustomers = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await creditApi.getCustomers();
      if (res.success) setAllCustomers(res.data || []);
    } catch (err) {
      if (!opts.silent) setError(err.message);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async (customerId, opts = {}) => {
    if (!customerId) return;
    if (!opts.silent) setTransactionsLoading(true);
    try {
      const resTrans = await creditApi.getTransactions(customerId);
      const resCust = await creditApi.getCustomerById(customerId);
      if (resTrans.success) {
        const txList = Array.isArray(resTrans.data)
          ? resTrans.data
          : (Array.isArray(resTrans.data?.ledger) ? resTrans.data.ledger : []);
        setTransactions(txList);
      }
      if (resCust.success) setActiveCustomer(resCust.data);
    } catch (e) {
      console.error('Failed to fetch customer transactions:', e.message);
    } finally {
      if (!opts.silent) setTransactionsLoading(false);
    }
  }, []);

  // Fetch initial summary and customer list & listen for cloud auto-sync
  useEffect(() => {
    fetchSummary();
    fetchCustomers();
    const onSynced = () => {
      fetchSummary();
      fetchCustomers({ silent: true });
      if (activeCustomerId) fetchTransactions(activeCustomerId, { silent: true });
    };
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [fetchSummary, fetchCustomers, activeCustomerId, fetchTransactions]);

  // Refetch transaction logs when active customer changes
  useEffect(() => {
    if (activeCustomerId) {
      fetchTransactions(activeCustomerId);
    } else {
      setActiveCustomer(null);
      setTransactions([]);
    }
  }, [activeCustomerId, fetchTransactions]);

  // Offline fuzzy filtering for customers with outstanding balance
  const customers = useMemo(() => {
    if (!searchQuery.trim()) return allCustomers;
    return applyFuzzyFilter(allCustomers, searchQuery, ['name', 'mobile', 'search_keywords']);
  }, [allCustomers, searchQuery]);

  // Receive a payment from a customer
  async function collectPayment({ customer_id, amount, payment_mode, note }) {
    try {
      const res = await creditApi.collectPayment({ customer_id, amount, payment_mode, note });
      if (res.success) {
        // Refetch summary and customer list
        await fetchSummary();
        await fetchCustomers();
        // If the updated customer is the current one, reload transactions/balance
        if (activeCustomerId === customer_id) {
          await fetchTransactions(customer_id);
        }
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to submit payment' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Manually adjust credit balance
  async function adjustCredit({ customer_id, amount, note }) {
    try {
      const res = await creditApi.adjustCredit({ customer_id, amount, note });
      if (res.success) {
        await fetchSummary();
        await fetchCustomers();
        if (activeCustomerId === customer_id) {
          await fetchTransactions(customer_id);
        }
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to submit adjustment' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Bring a notebook customer's existing debt onto the ledger. Distinct from
  // adjustCredit: it is refused once the customer already has an opening balance, so a
  // vendor cannot migrate the same figure twice.
  async function recordOpeningBalance({ customer_id, amount, note }) {
    try {
      const res = await creditApi.recordOpeningBalance({ customer_id, amount, note });
      if (res.success) {
        await fetchSummary();
        await fetchCustomers();
        if (activeCustomerId === customer_id) {
          await fetchTransactions(customer_id);
        }
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to save opening balance' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Apply a discount to a customer's udhar
  async function recordDiscount({ customer_id, amount, note }) {
    try {
      const res = await creditApi.recordDiscount({ customer_id, amount, note });
      if (res.success) {
        await fetchSummary();
        await fetchCustomers();
        if (activeCustomerId === customer_id) {
          await fetchTransactions(customer_id);
        }
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to apply discount' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Undo / delete a payment or discount transaction
  async function undoPayment(transactionId, customer_id) {
    try {
      const res = await creditApi.undoPayment(transactionId);
      if (res.success) {
        await fetchSummary();
        await fetchCustomers();
        const cid = customer_id || activeCustomerId;
        if (cid) {
          await fetchTransactions(cid);
        }
        await cloudSyncService.deleteFromSupabase('credit_transactions', transactionId).catch(() => {});
        cloudSyncService.triggerImmediateSync();
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to undo transaction' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    summary,
    customers,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    activeCustomerId,
    setActiveCustomerId,
    activeCustomer,
    transactions,
    transactionsLoading,
    fetchSummary,
    fetchCustomers,
    fetchTransactions,
    collectPayment,
    recordDiscount,
    undoPayment,
    adjustCredit,
    recordOpeningBalance
  };
}
