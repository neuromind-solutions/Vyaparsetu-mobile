import { useState, useEffect, useCallback } from 'react';
import { dashboardApi } from '../services/apiService';

export default function useDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSummary = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const response = await dashboardApi.getSummary();
      if (response && response.success) {
        setData(response.data);
      } else {
        throw new Error(response.message || 'Failed to fetch dashboard summary');
      }
    } catch (err) {
      console.error(err);
      if (!opts.silent) setError(err.message || 'Failed to load dashboard data');
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const onSynced = () => fetchSummary({ silent: true });
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [fetchSummary]);

  return {
    data,
    loading,
    error,
    refetch: fetchSummary,
  };
}
