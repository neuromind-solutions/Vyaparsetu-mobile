import { useState, useCallback, useMemo } from 'react';

import { useCustomers } from '../hooks/useCustomers';
import { useTranslation } from '../hooks/useTranslation';
import CustomerModal from '../components/CustomerModal';
import CustomerLedgerModal from '../components/CustomerLedgerModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import ImportCustomersModal from '../components/ImportCustomersModal';
import MarathiInput from '../components/MarathiInput';
import {
  PhoneIcon,
  EditIcon,
  TrashIcon,
  UsersIcon,
  ReceiptIcon,
  SearchIcon,
  AlertIcon,
  HistoryIcon,
  DownloadIcon,
  UploadIcon,
  FileSpreadsheetIcon,
} from '../components/Icons';
import { exportCustomersToExcel } from '../utils/excelUtils';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hasDevanagari(str) {
  return /[\u0900-\u097F]/.test(str);
}
function isAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return false;
  }
  return true;
}

// ─── Toast Notification (inline, no dependency) ───────────────────────────────
function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${type}`} id="toast-notification">
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">✕</button>
    </div>
  );
}

// ─── Customer Table Row ───────────────────────────────────────────────────────
function CustomerRow({ customer, onEdit, onDelete, onHistory, t }) {
  const initials = customer.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const hasCredit = customer.credit_balance > 0;

  return (
    <tr className="table-row" id={`customer-row-${customer.id}`}>
      {/* Avatar + Name */}
      <td className="table-cell">
        <div className="customer-name-cell">
          <div className="avatar">{initials}</div>
          <div>
            <div className="customer-name">{customer.name}</div>
            {customer.address && (
              <div className="customer-address">{customer.address}</div>
            )}
            {customer.search_keywords && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {customer.search_keywords.split(',').slice(0, 3).map((kw, i) => (
                  <span key={i} className="keyword-chip" style={{ fontSize: '0.72rem', padding: '1px 6px' }}>
                    {kw.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Mobile */}
      <td className="table-cell">
        {customer.mobile ? (
          <a href={`tel:${customer.mobile}`} className="mobile-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <PhoneIcon /> {customer.mobile}
          </a>
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>—</span>
        )}
      </td>

      {/* Credit Balance */}
      <td className="table-cell">
        <span className={`badge ${hasCredit ? 'badge-warning' : 'badge-success'}`}>
          ₹ {Number(customer.credit_balance).toFixed(2)}
        </span>
      </td>

      {/* Registered On */}
      <td className="table-cell text-muted text-sm">
        {new Date(customer.created_at).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        })}
      </td>

      {/* Actions */}
      <td className="table-cell">
        <div className="action-btns">
          {/* History / Ledger Button */}
          <button
            className="btn-icon"
            onClick={() => onHistory(customer)}
            title={t('customers.viewHistory') || 'View History'}
            id={`history-btn-${customer.id}`}
            style={{ background: 'var(--color-primary-bg)', borderColor: '#bfdbfe' }}
          >
            <HistoryIcon style={{ color: 'var(--color-primary)' }} />
          </button>
          <button
            className="btn-icon btn-icon-edit"
            onClick={() => onEdit(customer)}
            title={t('common.edit')}
            id={`edit-btn-${customer.id}`}
          >
            <EditIcon />
          </button>
          <button
            className="btn-icon btn-icon-delete"
            onClick={() => onDelete(customer)}
            title={t('common.delete')}
            id={`delete-btn-${customer.id}`}
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const { t } = useTranslation();
  const {
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
  } = useCustomers();

  // Modal state
  const [modalOpen, setModalOpen]               = useState(false);
  const [importModalOpen, setImportModalOpen]   = useState(false);
  const [editingCustomer, setEditingCustomer]   = useState(null);
  const [deleteTarget, setDeleteTarget]         = useState(null);
  const [deleteLoading, setDeleteLoading]       = useState(false);
  const [ledgerCustomer, setLedgerCustomer]     = useState(null); // for history modal
  const [dedupLoading, setDedupLoading]         = useState(false);
  const [toast, setToast]                       = useState({ message: '', type: 'success' });

  // ─── Duplicate Detection ───────────────────────────────────────────────────
  const duplicateDetectedCount = useMemo(() => {
    if (!allCustomers || allCustomers.length < 2) return 0;
    const names = new Set();
    const mobiles = new Set();
    let count = 0;
    for (const c of allCustomers) {
      const mob = (c.mobile || '').trim();
      const name = (c.name || '').trim().toLowerCase();
      if ((mob && mobiles.has(mob)) || (name && names.has(name))) {
        count++;
      }
      if (mob) mobiles.add(mob);
      if (name) names.add(name);
    }
    return count;
  }, [allCustomers]);

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 3500);
  }

  const openAdd = useCallback(() => {
    setEditingCustomer(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((customer) => {
    setEditingCustomer(customer);
    setModalOpen(true);
  }, []);

  const openHistory = useCallback((customer) => {
    setLedgerCustomer(customer);
  }, []);

  const openDelete = useCallback((customer) => {
    setDeleteTarget(customer);
  }, []);

  // ─── Submit Handlers ────────────────────────────────────────────────────────
  async function handleModalSubmit(data) {
    if (editingCustomer) {
      const res = await updateCustomer(editingCustomer.id, data);
      if (res.success) showToast(t('customers.saveSuccess'));
      return res;
    } else {
      const res = await createCustomer(data);
      if (res.success) showToast(t('customers.saveSuccess'));
      return res;
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const res = await deleteCustomer(deleteTarget.id);
    setDeleteLoading(false);
    if (res.success) {
      showToast(t('customers.deleteSuccess'));
      setDeleteTarget(null);
    } else {
      showToast(res.error || t('common.error'), 'error');
    }
  }

  async function handleDeduplicate() {
    setDedupLoading(true);
    const res = await deduplicateCustomers();
    setDedupLoading(false);
    if (res.success) {
      const removed = res.data?.duplicatesRemoved ?? 0;
      showToast(
        removed > 0
          ? `Cleaned up ${removed} duplicate customer record(s) and merged ledgers successfully!`
          : 'No duplicate records found.'
      );
    } else {
      showToast(res.error || 'Failed to merge duplicates', 'error');
    }
  }

  function handleExport() {
    if (!customers || customers.length === 0) {
      showToast(t('excel.noDataToExport') || 'No customers to export', 'error');
      return;
    }
    try {
      exportCustomersToExcel(customers);
      showToast(t('excel.exportSuccess') || 'Customers exported successfully to Excel!');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    }
  }

  async function handleBulkImportSubmit(data) {
    const res = await bulkImportCustomers(data);
    if (res.success) {
      const { created, updated, skipped } = res.data;
      showToast(
        `${t('excel.importSuccess') || 'Successfully imported'}: ${created} ${t('excel.added') || 'added'}, ${updated} ${t('excel.updated') || 'updated'}${skipped > 0 ? `, ${skipped} ${t('excel.skipped') || 'skipped'}` : ''}.`
      );
    } else {
      throw new Error(res.error || 'Import failed');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="customers-page">
      {/* Toast */}
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: 'success' })}
      />

      {/* Duplicate Alert Banner */}
      {duplicateDetectedCount > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fef3c7',
          borderLeft: '4px solid #f59e0b',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: '#92400e', fontSize: '0.88rem' }}>
                Duplicate customer records detected ({duplicateDetectedCount} potential duplicate{duplicateDetectedCount > 1 ? 's' : ''})
              </div>
              <div style={{ color: '#b45309', fontSize: '0.78rem' }}>
                Customers with identical names or phone numbers are present. Click below to safely merge their bills and credit balances into single records.
              </div>
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleDeduplicate}
            disabled={dedupLoading}
            style={{
              background: '#fef3c7',
              borderColor: '#fcd34d',
              color: '#92400e',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {dedupLoading ? 'Merging...' : '✨ Merge & Clean Duplicates'}
          </button>
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header-bar">
        <div>
          <h1 className="page-title">{t('customers.title')}</h1>
          <p className="page-desc">{t('customers.subtitle')}</p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Export Excel Button */}

          <button
            className="btn btn-secondary"
            onClick={handleExport}
            id="export-customer-btn"
            title={t('excel.exportExcel') || 'Export to Excel'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <DownloadIcon style={{ width: 15, height: 15 }} />
            <span>{t('excel.exportExcel') || 'Export Excel'}</span>
          </button>

          {/* Import Excel Button */}
          <button
            className="btn btn-secondary"
            onClick={() => setImportModalOpen(true)}
            id="import-customer-btn"
            title={t('excel.importExcel') || 'Import from Excel'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <UploadIcon style={{ width: 15, height: 15 }} />
            <span>{t('excel.importExcel') || 'Import Excel'}</span>
          </button>

          {/* Add Customer Button */}
          <button
            className="btn btn-primary"
            onClick={openAdd}
            id="add-customer-btn"
          >
            + {t('customers.addCustomer')}
          </button>
        </div>
      </div>

      {/* ── KPI Stats ──────────────────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-blue">
            <UsersIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{customers.length}</div>
            <div className="kpi-label">{t('customers.totalCustomers')}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-box kpi-icon-red">
            <ReceiptIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">₹{customers.reduce((s, c) => s + Number(c.credit_balance), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-label">{t('customers.creditBalance')}</div>
          </div>
        </div>
      </div>

      {/* ── Smart Search Bar (Marathi + Fuzzy) ─────────────────────── */}
      <div className="search-bar-container">
        <div className={`search-bar${searchQuery && hasDevanagari(searchQuery) ? ' marathi-mode' : ''}`}>
          <span className="search-icon" style={{ display: 'flex', alignItems: 'center' }}>
            <SearchIcon />
          </span>
          <MarathiInput
            id="customer-search-input"
            variant="search"
            placeholder={t('customers.searchPlaceholder')}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {searchQuery && isAscii(searchQuery) && (
            <span className="search-marathi-badge">अ</span>
          )}
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')} title="Clear">✕</button>
          )}
        </div>
        {searchQuery && (
          <div className="search-hint">
            {t('transliteration.searchingFor')} <strong>"{searchQuery}"</strong>
            &nbsp;—&nbsp;{customers.length} {t('common.noData').includes('No') ? 'result(s)' : 'निकाल'}
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Error state */}
        {error && !loading && (
          <div className="table-message table-error" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertIcon /> {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="table-message">
            <span className="spinner" style={{ margin: 'auto' }} />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && customers.length === 0 && (
          <div className="table-message">
            <div style={{ marginBottom: 10 }}>
              <UsersIcon style={{ width: '2rem', height: '2rem', color: 'var(--color-text-muted)' }} />
            </div>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              {searchQuery ? t('customers.noSearchResults') : t('customers.noCustomers')}
            </p>
            {!searchQuery && (
              <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={openAdd}>
                  + {t('customers.addCustomer')}
                </button>
                <button className="btn btn-secondary" onClick={() => setImportModalOpen(true)}>
                  <UploadIcon style={{ width: 15, height: 15 }} /> {t('excel.importExcel') || 'Import Excel'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        {!loading && !error && customers.length > 0 && (
          <div className="table-wrapper">
            <table className="data-table" id="customers-table">
              <thead>
                <tr>
                  <th className="table-th">{t('customers.name')}</th>
                  <th className="table-th">{t('customers.mobile')}</th>
                  <th className="table-th">{t('customers.creditBalance')}</th>
                  <th className="table-th">{t('customers.createdAt')}</th>
                  <th className="table-th">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <CustomerRow
                    key={customer.id}
                    customer={customer}
                    onEdit={openEdit}
                    onDelete={openDelete}
                    onHistory={openHistory}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <CustomerModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSubmit={handleModalSubmit}
          customer={editingCustomer}
        />
      )}

      {/* Import Customers Modal */}
      <ImportCustomersModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        existingCustomers={allCustomers || []}
        onImportSuccess={handleBulkImportSubmit}
      />

      {/* Customer Full Ledger / History Modal */}
      {ledgerCustomer && (
        <CustomerLedgerModal
          customerId={ledgerCustomer.id}
          customerName={ledgerCustomer.name}
          onClose={() => setLedgerCustomer(null)}
          // An opening balance entered inside the ledger changes credit_balance, which
          // this page shows in its own column. Refetch so the two do not disagree.
          onLedgerChange={fetchAll}
        />
      )}

      <DeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title={t('customers.deleteConfirmTitle')}
        message={`${t('customers.deleteConfirmMsg')} "${deleteTarget?.name}"?`}
        subMessage={t('customers.deleteConfirmNote')}
      />
    </div>
  );
}

