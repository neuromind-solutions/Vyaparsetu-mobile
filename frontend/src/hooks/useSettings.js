import { useState, useEffect, useCallback } from 'react';
import { settingsApi } from '../services/apiService';
import { useLanguage } from '../context/LanguageContext';

export default function useSettings() {
  const [settings, setSettings] = useState({
    language: 'en',
    vendor_name: '',
    owner_name: '',
    mobile_number: '',
    address: '',
    commission_rate: '8',
    default_payment_mode: 'Cash',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const { setLanguage } = useLanguage();

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await settingsApi.getAll();
      if (response && response.success) {
        // Merge returned keys with our state defaults
        setSettings((prev) => ({
          ...prev,
          ...response.data,
        }));
      } else {
        throw new Error(response.message || 'Failed to fetch settings');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (newSettings) => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await settingsApi.updateBulk(newSettings);
      if (response && response.success) {
        setSettings((prev) => ({
          ...prev,
          ...response.data,
        }));
        setSuccess(true);
        
        // If language has changed, immediately update frontend translation context
        if (newSettings.language) {
          setLanguage(newSettings.language);
        }
        
        // Hide success alert after 4 seconds
        setTimeout(() => setSuccess(false), 4000);
        return response.data;
      } else {
        throw new Error(response.message || 'Failed to save settings');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save settings');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [setLanguage]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    loading,
    saving,
    error,
    success,
    refetch: fetchSettings,
    saveSettings,
  };
}
