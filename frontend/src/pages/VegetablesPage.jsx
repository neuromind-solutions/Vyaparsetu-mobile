import { useState, useCallback, useMemo } from 'react';
import { useVegetables } from '../hooks/useVegetables';
import { useTranslation } from '../hooks/useTranslation';
import VegetableModal from '../components/VegetableModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import ImportVegetablesModal from '../components/ImportVegetablesModal';
import MarathiInput from '../components/MarathiInput';
import {
  LeafIcon,
  EditIcon,
  TrashIcon,
  ReceiptIcon,
  SearchIcon,
  AlertIcon,
  DownloadIcon,
  UploadIcon,
} from '../components/Icons';
import { exportVegetablesToExcel } from '../utils/excelUtils';

function hasDevanagari(str) {
  return /[\u0900-\u097F]/.test(str);
}
function isAscii(str) {
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) > 127) return false;
  return true;
}

function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${type}`} id="toast-notification">
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">
        ✕
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function VegetablesPage() {
  const { t } = useTranslation();
  const {
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
  } = useVegetables();

  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingVeg, setEditingVeg] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'success' });

  // Sorting & Pagination State (Scalable for 500+ items)
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50); // 25, 50, 100, 500

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 3500);
  }

  const openAdd = useCallback(() => {
    setEditingVeg(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((v) => {
    setEditingVeg(v);
    setModalOpen(true);
  }, []);

  const openDelete = useCallback((v) => setDeleteTarget(v), []);

  async function handleModalSubmit(data) {
    const res = editingVeg ? await updateVegetable(editingVeg.id, data) : await createVegetable(data);
    if (res.success) showToast(t('vegetables.saveSuccess'));
    return res;
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const res = await deleteVegetable(deleteTarget.id);
    setDeleteLoading(false);
    if (res.success) {
      showToast(t('vegetables.deleteSuccess'));
      setDeleteTarget(null);
    } else {
      showToast(res.error || t('common.error'), 'error');
    }
  }

  function handleExport() {
    if (!vegetables || vegetables.length === 0) {
      showToast(t('excel.noDataToExport') || 'No vegetables to export', 'error');
      return;
    }
    try {
      exportVegetablesToExcel(vegetables);
      showToast(t('excel.exportSuccess') || 'Vegetables exported successfully to Excel!');
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    }
  }

  async function handleBulkImportSubmit(data) {
    const res = await bulkImportVegetables(data);
    if (res.success) {
      const { created, updated, skipped } = res.data;
      showToast(
        `${t('excel.importSuccess') || 'Successfully imported'}: ${created} ${t('excel.added') || 'added'}, ${updated} ${t('excel.updated') || 'updated'}${skipped > 0 ? `, ${skipped} ${t('excel.skipped') || 'skipped'}` : ''}.`
      );
    } else {
      throw new Error(res.error || 'Import failed');
    }
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  }

  // Sorted List
  const sortedVegetables = useMemo(() => {
    if (!vegetables) return [];
    return [...vegetables].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'rate') {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [vegetables, sortField, sortDirection]);

  // Paginated Slices
  const totalItems = sortedVegetables.length;
  const effectivePageSize = pageSize === 0 ? totalItems : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / (effectivePageSize || 1)));
  const paginatedVegetables = useMemo(() => {
    if (pageSize === 0) return sortedVegetables;
    const start = (currentPage - 1) * pageSize;
    return sortedVegetables.slice(start, start + pageSize);
  }, [sortedVegetables, currentPage, pageSize]);

  const avgRate = vegetables.length
    ? (vegetables.reduce((s, v) => s + Number(v.rate), 0) / vegetables.length).toFixed(2)
    : '0.00';

  return (
    <div className="vegetables-page">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header-bar">
        <div>
          <h1 className="page-title">{t('vegetables.title')}</h1>
          <p className="page-desc">{t('vegetables.subtitle')}</p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Export Excel Button */}
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            id="export-veg-btn"
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
            id="import-veg-btn"
            title={t('excel.importExcel') || 'Import from Excel'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <UploadIcon style={{ width: 15, height: 15 }} />
            <span>{t('excel.importExcel') || 'Import Excel'}</span>
          </button>

          {/* Add Vegetable Button */}
          <button className="btn btn-primary" onClick={openAdd} id="add-veg-btn">
            + {t('vegetables.addVegetable')}
          </button>
        </div>
      </div>

      {/* ── Compact Metric Strip ───────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 16 }}>
        <div className="kpi-card" style={{ padding: '12px 16px' }}>
          <div className="kpi-icon-box kpi-icon-green" style={{ width: 34, height: 34 }}>
            <LeafIcon style={{ width: '16px', height: '16px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value" style={{ fontSize: '1.25rem' }}>{vegetables.length}</div>
            <div className="kpi-label">{t('vegetables.totalVegetables')}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ padding: '12px 16px' }}>
          <div className="kpi-icon-box kpi-icon-teal" style={{ width: 34, height: 34 }}>
            <ReceiptIcon style={{ width: '16px', height: '16px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value" style={{ fontSize: '1.25rem' }}>₹{avgRate}</div>
            <div className="kpi-label">{t('vegetables.avgRate') || 'Avg. Rate / Unit'}</div>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Bar ────────────────────────────────────────────── */}
      <div className="search-bar-container" style={{ marginBottom: 16 }}>
        <div className={`search-bar${searchQuery && hasDevanagari(searchQuery) ? ' marathi-mode' : ''}`}>
          <span className="search-icon">
            <SearchIcon />
          </span>
          <MarathiInput
            id="veg-search-input"
            variant="search"
            placeholder={t('vegetables.searchPlaceholder')}
            value={searchQuery}
            onChange={(val) => {
              setSearchQuery(val);
              setCurrentPage(1);
            }}
          />
          {searchQuery && isAscii(searchQuery) && <span className="search-marathi-badge">अ</span>}
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
              ✕
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="search-hint">
            {t('transliteration.searchingFor')} <strong>"{searchQuery}"</strong>
            &nbsp;—&nbsp;{vegetables.length} {t('common.noData').includes('No') ? 'result(s)' : 'निकाल'}
          </div>
        )}
      </div>

      {/* ── Content Table ─────────────────────────────────────────────────── */}
      {error && !loading && (
        <div
          className="table-error"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 'var(--border-radius-sm)', marginBottom: 16 }}
        >
          <AlertIcon /> {error}
        </div>
      )}

      {loading && (
        <div className="table-message">
          <span className="spinner" style={{ margin: 'auto' }} />
        </div>
      )}

      {!loading && !error && vegetables.length === 0 && (
        <div className="table-message" style={{ minHeight: 240 }}>
          <div style={{ marginBottom: 10 }}>
            <LeafIcon style={{ width: '2rem', height: '2rem', color: 'var(--color-text-muted)' }} />
          </div>
          <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
            {searchQuery ? t('vegetables.noSearchResults') : t('vegetables.noVegetables')}
          </p>
          {!searchQuery && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={openAdd}>
                + {t('vegetables.addVegetable')}
              </button>
              <button className="btn btn-secondary" onClick={() => setImportModalOpen(true)}>
                <UploadIcon style={{ width: 15, height: 15 }} /> {t('excel.importExcel') || 'Import Excel'}
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && vegetables.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'none', border: '1px solid var(--color-border)' }}>
          <div className="table-wrapper">
            <table className="data-table" id="vegetables-table">
              <thead>
                <tr>
                  <th style={{ width: '54px', textAlign: 'center' }}>#</th>
                  <th
                    onClick={() => handleSort('name')}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    title="Click to sort by name"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {t('vegetables.name')}
                      {sortField === 'name' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                    </span>
                  </th>
                  <th
                    onClick={() => handleSort('rate')}
                    style={{ textAlign: 'right', width: '130px', cursor: 'pointer', userSelect: 'none' }}
                    title="Click to sort by rate"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', width: '100%' }}>
                      {t('vegetables.rate')} (₹)
                      {sortField === 'rate' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                    </span>
                  </th>
                  <th
                    onClick={() => handleSort('unit')}
                    style={{ width: '110px', cursor: 'pointer', userSelect: 'none' }}
                    title="Click to sort by unit"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {t('vegetables.unit')}
                      {sortField === 'unit' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                    </span>
                  </th>
                  <th>{t('vegetables.keywords') || 'Search Keywords'}</th>
                  <th>{t('vegetables.notes') || 'Notes'}</th>
                  <th style={{ textAlign: 'center', width: '90px' }}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVegetables.map((veg, index) => {
                  const rowNumber = (currentPage - 1) * (pageSize || totalItems) + index + 1;
                  return (
                    <tr className="table-row" key={veg.id} id={`veg-row-${veg.id}`}>
                      <td className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                        {rowNumber}
                      </td>
                      <td className="table-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--color-primary)', display: 'flex' }}>
                            <LeafIcon style={{ width: '15px', height: '15px' }} />
                          </span>
                          <div>
                            <strong style={{ fontSize: '0.92rem', color: 'var(--color-text-primary)', display: 'block' }}>
                              {veg.name}
                            </strong>
                            {veg.category && veg.category !== 'General' && (
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  color: '#2563eb',
                                  background: '#eff6ff',
                                  border: '1px solid #dbeafe',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  display: 'inline-block',
                                  marginTop: '2px',
                                  fontWeight: 500,
                                }}
                              >
                                {veg.category}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="table-cell" style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.95rem' }}>
                          ₹{Number(veg.rate).toFixed(2)}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className="badge badge-neutral" style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                          {veg.unit}
                        </span>
                      </td>
                      <td className="table-cell">
                        {veg.search_keywords ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {veg.search_keywords.split(',').slice(0, 4).map((kw, i) => (
                              <span key={i} className="keyword-chip" style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
                                {kw.trim()}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>-</span>
                        )}
                      </td>
                      <td className="table-cell" style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {veg.notes || '-'}
                      </td>
                      <td className="table-cell" style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <button
                            className="btn-icon btn-icon-edit"
                            onClick={() => openEdit(veg)}
                            title={t('common.edit')}
                            id={`veg-edit-${veg.id}`}
                          >
                            <EditIcon />
                          </button>
                          <button
                            className="btn-icon btn-icon-delete"
                            onClick={() => openDelete(veg)}
                            title={t('common.delete')}
                            id={`veg-delete-${veg.id}`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Table Footer & Pagination Bar ─────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-bg-light)',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: '0.84rem',
            }}
          >
            <div style={{ color: 'var(--color-text-muted)' }}>
              Showing <strong>{totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong>–
              <strong>{Math.min(currentPage * pageSize, totalItems)}</strong> of <strong>{totalItems}</strong> vegetables
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="form-input form-select"
                  style={{ width: 'auto', padding: '3px 8px', fontSize: '0.82rem', height: '28px' }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={0}>All ({totalItems})</option>
                </select>
              </div>

              {pageSize > 0 && totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="btn btn-outline"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{ padding: '3px 10px', fontSize: '0.8rem', height: '28px' }}
                  >
                    ‹ Prev
                  </button>
                  <span style={{ padding: '0 6px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    className="btn btn-outline"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    style={{ padding: '3px 10px', fontSize: '0.8rem', height: '28px' }}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <VegetableModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleModalSubmit} vegetable={editingVeg} />

      <ImportVegetablesModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        existingVegetables={allVegetables || []}
        onImportSuccess={handleBulkImportSubmit}
      />

      <DeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title={t('vegetables.deleteConfirmTitle')}
        message={`${t('vegetables.deleteConfirmMsg')} "${deleteTarget?.name}"?`}
        subMessage={t('vegetables.deleteConfirmNote')}
      />
    </div>
  );
}

