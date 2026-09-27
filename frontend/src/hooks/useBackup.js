import { useState, useEffect, useCallback } from 'react';
import { backupApi } from '../services/apiService';

export default function useBackup() {
  const [backups, setBackups] = useState([]);
  const [lastBackup, setLastBackup] = useState(null);
  const [internetOnline, setInternetOnline] = useState(null);
  const [config, setConfig] = useState({
    defaultDir: '',
    customDir: '',
    activeDir: '',
    autoBackupEnabled: true,
    detectedCloudPaths: [],
    lastAutoBackup: null,
    isDirty: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBackups = useCallback(async () => {
    try {
      const response = await backupApi.listBackups();
      if (response && response.success) {
        setBackups(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch backup history:', err);
    }
  }, []);

  const fetchLastBackupStatus = useCallback(async () => {
    try {
      const response = await backupApi.getLastBackupStatus();
      if (response && response.success) {
        setLastBackup(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch last backup status:', err);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await backupApi.getConfig();
      if (response && response.success && response.data) {
        setConfig(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch backup config:', err);
    }
  }, []);

  const fetchInternetStatus = useCallback(async () => {
    try {
      const response = await backupApi.getInternetStatus();
      if (response && response.success) {
        setInternetOnline(response.data.online);
      }
    } catch (err) {
      console.error('Failed to check internet status:', err);
      setInternetOnline(false);
    }
  }, []);

  const updateConfig = useCallback(async (newConfig) => {
    setLoading(true);
    setError(null);
    try {
      const response = await backupApi.saveConfig(newConfig);
      if (response && response.success && response.data) {
        setConfig(response.data);
        return response.data;
      }
      throw new Error(response.message || 'Failed to save backup config');
    } catch (err) {
      setError(err.message || 'Failed to save config');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const selectBackupFolder = useCallback(async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.selectFolder) {
      try {
        const result = await window.electronAPI.selectFolder();
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
          const selectedPath = result.filePaths[0];
          await updateConfig({ customDir: selectedPath });
          return selectedPath;
        }
      } catch (err) {
        setError(`Failed to select folder: ${err.message}`);
      }
    }
    return null;
  }, [updateConfig]);

  const openBackupFolder = useCallback(async (targetPath) => {
    const pathToOpen = targetPath || config.activeDir || config.defaultDir;
    if (typeof window !== 'undefined' && window.electronAPI?.openFolder && pathToOpen) {
      try {
        await window.electronAPI.openFolder(pathToOpen);
      } catch (err) {
        console.error('Failed to open folder in explorer:', err);
      }
    }
  }, [config.activeDir, config.defaultDir]);

  const createLocalBackup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await backupApi.createLocalBackup();
      if (response && response.success) {
        await Promise.all([fetchBackups(), fetchLastBackupStatus(), fetchConfig()]);
        return response.data;
      }
      throw new Error(response.message || 'Backup failed');
    } catch (err) {
      setError(err.message || 'Backup failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchBackups, fetchLastBackupStatus, fetchConfig]);

  const restoreBackup = useCallback(async (filename) => {
    setLoading(true);
    setError(null);
    try {
      const response = await backupApi.restoreBackup(filename);
      if (response && response.success) {
        await Promise.all([fetchBackups(), fetchLastBackupStatus(), fetchConfig()]);
        return response.data;
      }
      throw new Error(response.message || 'Restore failed');
    } catch (err) {
      setError(err.message || 'Restore failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchBackups, fetchLastBackupStatus, fetchConfig]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchBackups(),
        fetchLastBackupStatus(),
        fetchConfig(),
        fetchInternetStatus(),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchBackups, fetchLastBackupStatus, fetchConfig, fetchInternetStatus]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => {
      fetchConfig();
      fetchInternetStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshAll, fetchConfig, fetchInternetStatus]);

  return {
    backups,
    lastBackup,
    internetOnline,
    config,
    loading,
    error,
    createLocalBackup,
    restoreBackup,
    updateConfig,
    selectBackupFolder,
    openBackupFolder,
    refreshAll,
  };
}
