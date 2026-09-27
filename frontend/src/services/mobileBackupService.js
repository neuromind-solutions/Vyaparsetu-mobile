/**
 * Mobile Device Offline Backup Service — VyaparSetu
 * 
 * Provides:
 * 1. Automatic background local backup on every entry/edit (debounced)
 * 2. 1-click device-local backup export and restore for standalone mobile users
 * 3. Native device storage integration via @capacitor/filesystem
 * 4. Automatic restore detection on fresh installs or app upgrades
 */

import { dbGetAll, dbPut, dbClear, onLocalDbMutation } from '../db/localDb';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { downloadFile } from '../utils/fileDownloader';

export const MOBILE_BACKUP_VERSION = 1;
const AUTO_BACKUP_FILENAME = 'vyaparsetu_auto_backup_latest.json';
const AUTO_BACKUP_META_KEY = 'vyaparsetu_last_auto_backup';

let autoBackupTimer = null;

// Automatically schedule local backup whenever any data mutation occurs
if (typeof window !== 'undefined') {
  try {
    onLocalDbMutation(() => {
      scheduleAutoBackup(1200);
    });
  } catch (err) {
    console.warn('Could not register mutation auto-backup listener:', err);
  }
}

/**
 * Get item statistics of data stored locally in IndexedDB.
 */
export async function getLocalDatabaseStats() {
  try {
    const [customers, vegetables, transactions, bills, credit, outbox] = await Promise.all([
      dbGetAll('customers').catch(() => []),
      dbGetAll('vegetables').catch(() => []),
      dbGetAll('transactions').catch(() => []),
      dbGetAll('bills').catch(() => []),
      dbGetAll('credit_transactions').catch(() => []),
      dbGetAll('outbox_mutations').catch(() => []),
    ]);

    return {
      customersCount: customers.filter((c) => !c.is_deleted).length,
      vegetablesCount: vegetables.filter((v) => !v.is_deleted).length,
      transactionsCount: transactions.length,
      billsCount: bills.length,
      creditCount: credit.length,
      pendingOutboxCount: outbox.filter((m) => m.status === 'pending').length,
      totalRecords: customers.length + vegetables.length + transactions.length + bills.length + credit.length,
    };
  } catch (err) {
    console.error('Failed to get local database stats:', err);
    return {
      customersCount: 0,
      vegetablesCount: 0,
      transactionsCount: 0,
      billsCount: 0,
      creditCount: 0,
      pendingOutboxCount: 0,
      totalRecords: 0,
    };
  }
}

/**
 * Compiles all IndexedDB stores into a standardized backup structure.
 */
export async function compileDatabaseSnapshot() {
  const [
    customers,
    vegetables,
    transactions,
    bills,
    bill_items,
    credit_transactions,
    settings,
    outbox_mutations,
  ] = await Promise.all([
    dbGetAll('customers'),
    dbGetAll('vegetables'),
    dbGetAll('transactions'),
    dbGetAll('bills'),
    dbGetAll('bill_items'),
    dbGetAll('credit_transactions'),
    dbGetAll('settings'),
    dbGetAll('outbox_mutations'),
  ]);

  const timestamp = new Date().toISOString();

  return {
    app: 'VyaparSetu',
    type: 'mobile_offline_backup',
    version: MOBILE_BACKUP_VERSION,
    exported_at: timestamp,
    data: {
      customers,
      vegetables,
      transactions,
      bills,
      bill_items,
      credit_transactions,
      settings,
      outbox_mutations,
    },
    meta: {
      customersCount: customers.length,
      vegetablesCount: vegetables.length,
      transactionsCount: transactions.length,
      billsCount: bills.length,
      creditTransactionsCount: credit_transactions.length,
      totalRecords: customers.length + vegetables.length + transactions.length + bills.length + credit_transactions.length,
    },
  };
}

/**
 * Executes an immediate automatic local backup to device storage.
 */
export async function performAutoBackup() {
  try {
    const backupData = await compileDatabaseSnapshot();
    // Don't auto-backup an empty database over an existing backup
    if (backupData.meta.totalRecords === 0) {
      return { skipped: true, reason: 'database_empty' };
    }

    const jsonString = JSON.stringify(backupData);
    const timestamp = backupData.exported_at;

    // 1. If on native mobile (Capacitor), save to native Documents/Data directory
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      try {
        await Filesystem.writeFile({
          path: AUTO_BACKUP_FILENAME,
          data: jsonString,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
      } catch (err) {
        // Fallback to Data directory if Documents permission is restricted
        try {
          await Filesystem.writeFile({
            path: AUTO_BACKUP_FILENAME,
            data: jsonString,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
          });
        } catch (e2) {
          console.warn('Filesystem auto-backup write error:', e2);
        }
      }
    }

    // 2. Also persist metadata & local snapshot
    try {
      localStorage.setItem('vyaparsetu_auto_backup_snapshot', jsonString);
      localStorage.setItem(AUTO_BACKUP_META_KEY, timestamp);
    } catch {}

    try {
      await Preferences.set({ key: AUTO_BACKUP_META_KEY, value: timestamp });
    } catch {}

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('vyaparsetu:auto-backup-completed', {
          detail: { timestamp, totalRecords: backupData.meta.totalRecords },
        })
      );
    }

    return { success: true, timestamp, totalRecords: backupData.meta.totalRecords };
  } catch (err) {
    console.warn('Automatic local backup error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Schedules a debounced auto-backup.
 * Call this whenever any mutation (add/update/delete) occurs.
 * @param {number} delayMs Delay in milliseconds (default: 1200ms)
 */
export function scheduleAutoBackup(delayMs = 1200) {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
  }
  autoBackupTimer = setTimeout(() => {
    performAutoBackup();
  }, delayMs);
}

/**
 * Exports all IndexedDB stores into a JSON file and triggers native download / file save.
 */
export async function exportLocalMobileBackup() {
  const backupData = await compileDatabaseSnapshot();
  const timestamp = backupData.exported_at;
  const dateStr = timestamp.slice(0, 10);
  const timeStr = timestamp.slice(11, 16).replace(':', '');
  const filename = `vyaparsetu_mobile_backup_${dateStr}_${timeStr}.json`;
  const jsonString = JSON.stringify(backupData, null, 2);

  await downloadFile({
    data: jsonString,
    filename,
    mimeType: 'application/json',
    title: 'Export VyaparSetu Backup',
  });

  return {
    filename,
    totalRecords: backupData.meta.totalRecords,
  };
}

/**
 * Restores IndexedDB from a valid parsed backup object or JSON string.
 */
export async function restoreFromBackupData(parsed) {
  if (parsed.app !== 'VyaparSetu' || !parsed.data) {
    throw new Error('This file is not a valid VyaparSetu mobile backup');
  }

  const { data } = parsed;
  const storesToRestore = [
    'customers',
    'vegetables',
    'transactions',
    'bills',
    'bill_items',
    'credit_transactions',
    'settings',
    'outbox_mutations',
  ];

  let restoredCount = 0;
  for (const storeName of storesToRestore) {
    const records = data[storeName];
    if (Array.isArray(records)) {
      await dbClear(storeName).catch(() => {});
      for (const item of records) {
        await dbPut(storeName, item);
        restoredCount++;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('vyaparsetu:data-synced', { detail: { count: restoredCount } })
    );
  }

  return {
    success: true,
    restoredCount,
    exportedAt: parsed.exported_at,
  };
}

/**
 * Restores IndexedDB from a valid JSON File object (e.g. from file picker).
 */
export async function restoreLocalMobileBackup(file) {
  if (!file) throw new Error('No backup file provided');
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error('Invalid JSON file format');
  }
  return restoreFromBackupData(parsed);
}

/**
 * Checks if the local database is currently empty but an auto-backup file exists.
 * Used for automatic recovery on fresh app install or after updates.
 */
export async function checkAutoRestoreEligibility() {
  try {
    const stats = await getLocalDatabaseStats();
    if (stats.totalRecords > 0) {
      return { eligible: false, currentRecords: stats.totalRecords };
    }

    // Check Capacitor Filesystem for existing auto backup
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      try {
        const fileContent = await Filesystem.readFile({
          path: AUTO_BACKUP_FILENAME,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        if (fileContent?.data) {
          const parsed = JSON.parse(fileContent.data);
          if (parsed?.meta?.totalRecords > 0) {
            return { eligible: true, source: 'filesystem', data: parsed };
          }
        }
      } catch {}
    }

    // Check localStorage fallback
    const localSnapshot = localStorage.getItem('vyaparsetu_auto_backup_snapshot');
    if (localSnapshot) {
      const parsed = JSON.parse(localSnapshot);
      if (parsed?.meta?.totalRecords > 0) {
        return { eligible: true, source: 'local_storage', data: parsed };
      }
    }
  } catch (err) {
    console.warn('checkAutoRestoreEligibility check failed:', err);
  }
  return { eligible: false };
}
