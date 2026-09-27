/**
 * useVegetables Hook
 * Manages all vegetable/produce state: list, search, loading, errors, CRUD operations.
 * Uses frontend fuzzy search (Fuse.js) for instant offline search.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { vegetablesApi } from '../services/apiService';
import { applyFuzzyFilter } from '../utils/fuzzySearch';
import { cloudSyncService } from '../services/cloudSyncService';

export function useVegetables() {
  const [allVegetables, setAllVegetables] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [searchQuery, setSearchQuery]     = useState('');

  // ─── Fetch all vegetables from backend / offline repository ────────────────
  const fetchAll = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await vegetablesApi.getAll();
      setAllVegetables(Array.isArray(res?.data) ? res.data : []);
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

  // ─── Frontend fuzzy filtering (instant, offline) ────────────────────────────
  const vegetables = useMemo(() => {
    if (!searchQuery.trim()) return allVegetables;
    return applyFuzzyFilter(allVegetables, searchQuery, ['name', 'category', 'search_keywords', 'notes']);
  }, [allVegetables, searchQuery]);

  // ─── CRUD Operations ────────────────────────────────────────────────────────

  async function createVegetable(data) {
    try {
      const res = await vegetablesApi.create(data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res?.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateVegetable(id, data) {
    try {
      const res = await vegetablesApi.update(id, data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res?.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteVegetable(id) {
    try {
      await vegetablesApi.remove(id);
      await fetchAll();
      await cloudSyncService.deleteFromSupabase('vegetables', id).catch(() => {});
      cloudSyncService.triggerImmediateSync();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function bulkImportVegetables(data) {
    try {
      const res = await vegetablesApi.bulkImport(data);
      await fetchAll();
      cloudSyncService.triggerImmediateSync();
      return { success: true, data: res?.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    vegetables,
    allVegetables,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    createVegetable,
    updateVegetable,
    deleteVegetable,
    bulkImportVegetables,
    fetchAll,
    refreshVegetables: fetchAll,
  };
}
