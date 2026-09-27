import { useState, useEffect, useCallback } from 'react';
import { driveApi } from '../services/apiService';

export default function useGoogleDrive() {
  const [connected, setConnected] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [lastChange, setLastChange] = useState(null);
  const [hasCredentials, setHasCredentials] = useState(true);
  const [driveBackups, setDriveBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await driveApi.getStatus();
      if (res && res.success && res.data) {
        setConnected(res.data.connected);
        setIsDirty(!!res.data.isDirty);
        setLastSync(res.data.lastSync || null);
        setLastChange(res.data.lastChange || null);
        setHasCredentials(res.data.hasCredentials !== false);
        return res.data.connected;
      }
    } catch (err) {
      console.error('Failed to fetch Drive connection status:', err);
    }
    return false;
  }, []);

  const fetchDriveBackups = useCallback(async () => {
    try {
      const res = await driveApi.listBackups();
      if (res && res.success) {
        setDriveBackups(res.data || []);
      }
    } catch (err) {
      console.error('Failed to list Drive backups:', err);
    }
  }, []);

  const connectDrive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await driveApi.getAuthUrl();
      if (res && res.success && res.authUrl) {
        // In Electron: Launch system browser so Google does not block with 403 disallowed_useragent
        if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
          await window.electronAPI.openExternal(res.authUrl);
          setSuccess('Opening Google OAuth login in your default web browser...');
        } else {
          window.location.href = res.authUrl;
        }

        // Auto-poll status every 2 seconds for up to 2 minutes so UI activates immediately upon browser completion
        let attempts = 0;
        const maxAttempts = 60;
        const poller = setInterval(async () => {
          attempts += 1;
          try {
            const isConnected = await fetchStatus();
            if (isConnected) {
              clearInterval(poller);
              await fetchDriveBackups();
              setSuccess('Connected to Google Drive successfully!');
            } else if (attempts >= maxAttempts) {
              clearInterval(poller);
            }
          } catch (_) {
            if (attempts >= maxAttempts) clearInterval(poller);
          }
        }, 2000);
      } else {
        throw new Error('Could not retrieve authentication URL.');
      }
    } catch (err) {
      setError(err.message || 'OAuth initialization failed.');
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchDriveBackups]);

  const disconnectDrive = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await driveApi.disconnect();
      if (res && res.success) {
        setConnected(false);
        setIsDirty(false);
        setDriveBackups([]);
        setSuccess('Disconnected from Google Drive successfully.');
      }
    } catch (err) {
      setError(err.message || 'Disconnect failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  const backupToDrive = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await driveApi.backup(force);
      if (res && res.success) {
        if (res.skipped) {
          setSuccess('Database has not changed since last sync. Cloud copy is already up-to-date.');
        } else {
          setSuccess(`Backup synced to Google Drive successfully: ${res.data?.filename || 'vyapaarsetu-backup.db'}`);
        }
        await fetchStatus();
        await fetchDriveBackups();
        return res.data;
      }
      throw new Error(res.message || 'Google Drive backup failed.');
    } catch (err) {
      setError(err.message || 'Upload failed.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchDriveBackups]);

  const restoreFromDrive = useCallback(async (fileId) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await driveApi.restore(fileId);
      if (res && res.success) {
        setSuccess(`Database restored successfully from Google Drive backup. Local safety backup created: ${res.data.safetyBackup}`);
        await fetchStatus();
        return res.data;
      }
      throw new Error(res.message || 'Google Drive restore failed.');
    } catch (err) {
      setError(err.message || 'Google Drive restore failed.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const isConnected = await fetchStatus();
      if (isConnected) {
        await fetchDriveBackups();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchDriveBackups]);

  // Initial load & URL query param check
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const isConnected = await fetchStatus();
      if (isConnected) {
        await fetchDriveBackups();
      }

      // Check query params for redirected callback success or error
      const params = new URLSearchParams(window.location.search);
      if (params.get('drive_connected') === 'true') {
        setSuccess('Connected to Google Drive successfully!');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.get('drive_error')) {
        setError(`Google Drive error: ${params.get('drive_error')}`);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      setLoading(false);
    };
    init();
  }, [fetchStatus, fetchDriveBackups]);

  return {
    connected,
    isDirty,
    lastSync,
    lastChange,
    hasCredentials,
    driveBackups,
    loading,
    error,
    success,
    setSuccess,
    setError,
    connectDrive,
    disconnectDrive,
    backupToDrive,
    restoreFromDrive,
    refreshAll,
  };
}
