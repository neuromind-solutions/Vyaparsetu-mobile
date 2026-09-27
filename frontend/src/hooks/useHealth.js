/**
 * useHealth Hook
 * Fetches the backend health status and provides loading/error states.
 */

import { useState, useEffect, useCallback } from 'react';
import { healthApi } from '../services/apiService';

export function useHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await healthApi.getStatus();
      setData(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return { data, loading, error, refetch: fetchHealth };
}
