/**
 * useBills Hook
 * Manages state and CRUD operations for bills.
 * Integrates offline-first fuzzy search via Fuse.js.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { billsApi } from '../services/apiService';
import { applyFuzzyFilter } from '../utils/fuzzySearch';
import { cloudSyncService } from '../services/cloudSyncService';
import {
  getLocalDateString,
  getYesterdayDateString,
  getStartOfWeekDateString,
  getStartOfMonthDateString,
} from '../utils/dates';

function billMatchesDate(b, filterType, startDate, endDate, selectedDate) {
  if (filterType === 'all') return true;

  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();
  const weekStart = getStartOfWeekDateString();
  const monthStart = getStartOfMonthDateString();

  let rangeStart = null;
  let rangeEnd = null;

  if (filterType === 'today') {
    rangeStart = today;
    rangeEnd = today;
  } else if (filterType === 'yesterday') {
    rangeStart = yesterday;
    rangeEnd = yesterday;
  } else if (filterType === 'week') {
    rangeStart = weekStart;
    rangeEnd = today;
  } else if (filterType === 'month') {
    rangeStart = monthStart;
    rangeEnd = today;
  } else if (filterType === 'range') {
    rangeStart = startDate || null;
    rangeEnd = endDate || null;
  } else if (filterType === 'specific') {
    rangeStart = selectedDate || null;
    rangeEnd = selectedDate || null;
  }

  if (!rangeStart && !rangeEnd) return true;

  const billDate = b.date;
  const periodStart = b.period_start;
  const periodEnd = b.period_end;

  if (rangeStart && rangeEnd) {
    if (periodStart && periodEnd) {
      return (
        (periodStart <= rangeEnd && periodEnd >= rangeStart) ||
        (billDate >= rangeStart && billDate <= rangeEnd)
      );
    }
    return billDate >= rangeStart && billDate <= rangeEnd;
  }

  if (rangeStart && !rangeEnd) {
    if (periodStart && periodEnd) {
      return periodEnd >= rangeStart || billDate >= rangeStart;
    }
    return billDate >= rangeStart;
  }

  if (!rangeStart && rangeEnd) {
    if (periodStart && periodEnd) {
      return periodStart <= rangeEnd || billDate <= rangeEnd;
    }
    return billDate <= rangeEnd;
  }

  return true;
}

export function useBills() {
  const [allBills, setAllBills] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilterType, setDateFilterType] = useState('all'); // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'specific' | 'range'
  const [selectedDate, setSelectedDate]     = useState(getLocalDateString());
  const [startDate, setStartDate]           = useState(getLocalDateString());
  const [endDate, setEndDate]               = useState(getLocalDateString());

  // Distinct from `!loading`: loading is false both before the first fetch starts and
  // after it finishes. A deep link that has to decide "this bill does not exist" needs
  // to tell those apart, or it reports not-found against a list it has not read yet.
  const [loaded, setLoaded]     = useState(false);

  const fetchAll = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await billsApi.getAll();
      setAllBills(res.data || []);
    } catch (err) {
      if (!opts.silent) setError(err.message);
    } finally {
      if (!opts.silent) setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const onSynced = () => fetchAll({ silent: true });
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [fetchAll]);

  // Combined date filter + fuzzy text search
  const dateFilteredBills = useMemo(() => {
    return allBills.filter((b) =>
      billMatchesDate(b, dateFilterType, startDate, endDate, selectedDate)
    );
  }, [allBills, dateFilterType, startDate, endDate, selectedDate]);

  const bills = useMemo(() => {
    if (!searchQuery.trim()) return dateFilteredBills;
    return applyFuzzyFilter(dateFilteredBills, searchQuery, ['bill_number', 'customer_name', 'notes']);
  }, [dateFilteredBills, searchQuery]);

  async function createBill(data) {
    try {
      const res = await billsApi.create(data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateBill(id, data) {
    try {
      const res = await billsApi.update(id, data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteBill(id) {
    try {
      await billsApi.remove(id);
      await fetchAll();
      await cloudSyncService.deleteFromSupabase('bills', id).catch(() => {});
      cloudSyncService.triggerImmediateSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    bills,
    allBills,
    loading,
    loaded,
    error,
    searchQuery,
    setSearchQuery,
    dateFilterType,
    setDateFilterType,
    selectedDate,
    setSelectedDate,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    fetchAll,
    createBill,
    updateBill,
    deleteBill,
  };
}
