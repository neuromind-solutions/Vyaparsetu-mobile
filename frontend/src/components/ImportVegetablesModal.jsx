/**
 * ImportVegetablesModal
 * Interactive modal for importing vegetables from Excel/CSV files.
 * Provides sample template download, file validation, live preview, and conflict settings.
 */

import { useState, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import {
  generateVegetablesSampleTemplate,
  parseVegetablesExcelFile,
} from '../utils/excelUtils';
import {
  UploadIcon,
  DownloadIcon,
  CheckIcon,
  AlertIcon,
  FileSpreadsheetIcon,
} from './Icons';

export default function ImportVegetablesModal({
  isOpen,
  onClose,
  existingVegetables = [],
  onImportSuccess,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);

  const [file, setFile]                     = useState(null);
  const [parsedData, setParsedData]         = useState(null);
  const [loading, setLoading]               = useState(false);
  const [importing, setImporting]           = useState(false);
  const [error, setError]                   = useState('');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [isDragOver, setIsDragOver]         = useState(false);

  if (!isOpen) return null;

  function resetState() {
    setFile(null);
    setParsedData(null);
    setError('');
    setLoading(false);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function processFile(uploadedFile) {
    if (!uploadedFile) return;
    const name = uploadedFile.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      setError(t('excel.invalidFileType') || 'Please select a valid Excel (.xlsx, .xls) or CSV (.csv) file.');
      return;
    }

    setFile(uploadedFile);
    setLoading(true);
    setError('');

    try {
      const result = await parseVegetablesExcelFile(uploadedFile, existingVegetables);
      if (result.items.length === 0) {
        setError(t('excel.noDataRows') || 'No data rows found in the selected file.');
        setParsedData(null);
      } else {
        setParsedData(result);
      }
    } catch (err) {
      setError(err.message || 'Failed to read file.');
      setParsedData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    if (selected) processFile(selected);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) processFile(droppedFile);
  }

  async function handleImport() {
    if (!parsedData || !parsedData.items) return;

    const validItems = parsedData.items.filter((item) => item.isValid);
    if (validItems.length === 0) {
      setError(t('excel.noValidItems') || 'No valid items to import.');
      return;
    }

    setImporting(true);
    setError('');

    try {
      await onImportSuccess({
        items: validItems.map((item) => ({
          name: item.name,
          rate: item.rate,
          unit: item.unit,
          search_keywords: item.search_keywords,
          notes: item.notes,
        })),
        updateExisting,
      });
      handleClose();
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const validCount = parsedData?.summary.valid || 0;
  const invalidCount = parsedData?.summary.invalid || 0;
  const duplicateCount = parsedData?.summary.duplicates || 0;

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={handleClose}>
      <div
        className="modal modal-lg"
        style={{ maxWidth: 850, width: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: 'rgba(34, 197, 94, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-primary, #16a34a)',
            }}>
              <FileSpreadsheetIcon style={{ width: 22, height: 22 }} />
            </div>
            <div>
              <h2 className="modal-title">{t('excel.importVegetablesTitle') || 'Import Vegetables from Excel'}</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {t('excel.importVegetablesSubtitle') || 'Upload .xlsx, .xls, or .csv to quickly add or update multiple vegetables'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        {/* ── Modal Body ── */}
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Template Download Card */}
          <div style={{
            background: 'var(--color-surface-hover, #f8fafc)',
            border: '1px solid var(--color-border, #e2e8f0)',
            borderRadius: 'var(--border-radius-sm, 8px)',
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>
                {t('excel.needTemplate') || 'Need a format template?'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                {t('excel.templateDesc') || 'Download the sample Excel template pre-filled with columns and sample rows.'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={generateVegetablesSampleTemplate}
            >
              <DownloadIcon style={{ width: 14, height: 14 }} />
              {t('excel.downloadSample') || 'Download Sample (.xlsx)'}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="table-error" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 6, marginBottom: 14 }}>
              <AlertIcon /> {error}
            </div>
          )}

          {/* Upload Zone */}
          {!parsedData && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragOver ? 'var(--color-primary)' : 'var(--color-border, #cbd5e1)'}`,
                background: isDragOver ? 'rgba(34, 197, 94, 0.05)' : 'var(--color-surface, #ffffff)',
                borderRadius: 12,
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'var(--color-primary-light, #eef9f2)', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UploadIcon style={{ width: 24, height: 24, color: 'var(--color-primary, #16a34a)' }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                {loading ? (t('common.loading') || 'Processing file...') : (t('excel.dragOrClick') || 'Click to select or drag & drop Excel file')}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                {t('excel.supportedFormats') || 'Supported formats: .xlsx, .xls, .csv'}
              </div>
            </div>
          )}

          {/* Preview & Options when file is parsed */}
          {parsedData && (
            <div>
              {/* File details & KPI pills */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileSpreadsheetIcon style={{ color: 'var(--color-primary)', width: 18, height: 18 }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{file?.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    ({(file?.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                  onClick={resetState}
                >
                  {t('excel.changeFile') || 'Change File'}
                </button>
              </div>

              {/* Stats Summary Banner */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}>
                <div style={{ padding: '8px 12px', background: 'var(--color-surface-hover)', borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{t('excel.totalRows') || 'Total Rows'}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{parsedData.summary.total}</div>
                </div>
                <div style={{ padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 6, textAlign: 'center', color: '#16a34a' }}>
                  <div style={{ fontSize: '0.72rem' }}>{t('excel.validRows') || 'Ready to Import'}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{validCount}</div>
                </div>
                {invalidCount > 0 && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 6, textAlign: 'center', color: '#dc2626' }}>
                    <div style={{ fontSize: '0.72rem' }}>{t('excel.invalidRows') || 'Errors (Skipped)'}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{invalidCount}</div>
                  </div>
                )}
                {duplicateCount > 0 && (
                  <div style={{ padding: '8px 12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: 6, textAlign: 'center', color: '#2563eb' }}>
                    <div style={{ fontSize: '0.72rem' }}>{t('excel.duplicates') || 'Already Exists'}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{duplicateCount}</div>
                  </div>
                )}
              </div>

              {/* Conflict Mode Setting */}
              <div style={{
                background: 'var(--color-surface-hover)',
                padding: '10px 14px',
                borderRadius: 6,
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    style={{ cursor: 'pointer', width: 16, height: 16 }}
                  />
                  <span>
                    {t('excel.updateExistingLabel') || 'Update rate and info if vegetable name already exists'}
                  </span>
                </label>
              </div>

              {/* Data Preview Table */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, maxHeight: 260, overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.8rem', margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '8px 10px', width: 45 }}>#</th>
                      <th style={{ padding: '8px 10px' }}>{t('vegetables.name') || 'Name'}</th>
                      <th style={{ padding: '8px 10px' }}>{t('vegetables.rate') || 'Rate'}</th>
                      <th style={{ padding: '8px 10px' }}>{t('vegetables.unit') || 'Unit'}</th>
                      <th style={{ padding: '8px 10px' }}>{t('vegetables.searchKeywords') || 'Keywords'}</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.items.map((item, idx) => (
                      <tr key={idx} style={{ background: !item.isValid ? 'rgba(239, 68, 68, 0.04)' : undefined }}>
                        <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>{item.rowIndex}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>{item.name || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>₹{Number(item.rate).toFixed(2)}</td>
                        <td style={{ padding: '6px 10px' }}>{item.unit}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)', maxWidth: 140, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {item.search_keywords || '—'}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {item.isValid ? (
                            item.isExisting ? (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(59, 130, 246, 0.15)', color: '#2563eb', padding: '2px 6px', borderRadius: 4 }}>
                                {updateExisting ? (t('excel.willUpdate') || 'Update') : (t('excel.willSkip') || 'Skip')}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(34, 197, 94, 0.15)', color: '#16a34a', padding: '2px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <CheckIcon style={{ width: 11, height: 11 }} /> {t('excel.valid') || 'Valid'}
                              </span>
                            )
                          ) : (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.15)', color: '#dc2626', padding: '2px 6px', borderRadius: 4 }} title={item.errors.join(', ')}>
                              {item.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
          <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={importing}>
            {t('common.cancel')}
          </button>
          {parsedData && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {importing ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {t('excel.importing') || 'Importing...'}
                </>
              ) : (
                <>
                  <CheckIcon style={{ width: 15, height: 15 }} />
                  {`${t('excel.importAction') || 'Import'} (${validCount})`}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
