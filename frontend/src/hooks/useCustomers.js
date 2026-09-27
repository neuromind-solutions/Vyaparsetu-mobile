/**
 * useCustomers Hook
 * Manages all customer state: list, search, loading, errors, CRUD operations.
 * Module 3: Uses frontend fuzzy search (Fuse.js) — no extra network calls for search.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { customersApi } from '../services/apiService';
import { applyFuzzyFilter } from '../utils/fuzzySearch';
import { cloudSyncService } from '../services/cloudSyncService';

export function useCustomers() {
  const [allCustomers, setAllCustomers] = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [searchQuery, setSearchQuery]   = useState('');

  // ─── Fetch all customers once from backend ────────────────────────────────
  const fetchAll = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await customersApi.getAll();
      setAllCustomers(res.data);
    } catch (err) {
      if (!opts.silent) setError(err.message);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  // Initial load and sync listener
  useEffect(() => {
    fetchAll();
    const onSynced = () => fetchAll({ silent: true });
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [fetchAll]);

  // ─── Frontend fuzzy filtering (instant, offline) ──────────────────────────
  // Searches name, mobile, address, and search_keywords with fuzzy matching + normalization.
  const customers = useMemo(() => {
    if (!searchQuery.trim()) return allCustomers;
    return applyFuzzyFilter(allCustomers, searchQuery, ['name', 'mobile', 'address', 'search_keywords']);
  }, [allCustomers, searchQuery]);

  // ─── CRUD Operations ──────────────────────────────────────────────────────

  async function createCustomer(data) {
    try {
      await customersApi.create(data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateCustomer(id, data) {
    try {
      await customersApi.update(id, data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteCustomer(id) {
    try {
      await customersApi.remove(id);
      await fetchAll();
      await cloudSyncService.deleteFromSupabase('customers', id).catch(() => {});
      cloudSyncService.triggerImmediateSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function bulkImportCustomers(data) {
    try {
      const res = await customersApi.bulkImport(data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deduplicateCustomers() {
    try {
      const res = await customersApi.deduplicate();
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res.data, message: res.message };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    customers,
    allCustomers,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    fetchAll,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    bulkImportCustomers,
    deduplicateCustomers,
  };
}


