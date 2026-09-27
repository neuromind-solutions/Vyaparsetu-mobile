/**
 * SettingsPage — Vyapar Business & Shop Settings
 * Section-grouped form cards: Business Profile / Bill Customization / Billing Setup / Preferences / Backup
 */

import { useState, useEffect } from 'react';
import useSettings from '../hooks/useSettings';
import { useTranslation } from '../hooks/useTranslation';
import MarathiInput from '../components/MarathiInput';
import cloudSyncService from '../services/cloudSyncService';
import {
  AlertIcon,
  CheckIcon,
  BuildingIcon,
  ChartIcon,
  CogIcon,
  CloudIcon,
  SaveIcon,
  ReceiptIcon,
  LeafIcon,
} from '../components/Icons';

const DEFAULT_UNITS = ['kg', 'piece', 'bundle', 'dozen', 'gram', 'liter', 'crate', 'bag', 'quintal'];
const DEFAULT_CATEGORIES = [
  'पालेभाज्या (Leafy)',
  'फळभाज्या (Fruit)',
  'कंदमुळे (Roots/Tubers)',
  'मिरची व मसाले (Chilli & Spices)',
  'सर्वसाधारण (General)',
];

function parseArraySetting(val, fallback) {
  if (!val) return fallback;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${type}`} id="toast-notification">
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">✕</button>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { settings, loading, saving, error: apiError, success, saveSettings } = useSettings();

  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [form, setForm] = useState({
    vendor_name: '',
    tagline: '',
    owner_name: '',
    mobile_number: '',
    secondary_mobile: '',
    market_name: '',
    gala_number: '',
    address: '',
    city: '',
    devotion_text: '',
    bill_footer_note: '',
    upi_id: '',
    commission_rate: '8',
    default_payment_mode: 'Cash',
    language: 'en',
    units: DEFAULT_UNITS,
    categories: DEFAULT_CATEGORIES,
    supabase_url: '',
    supabase_anon_key: '',
    auto_sync_enabled: 'false',
  });

  const [syncStats, setSyncStats] = useState({
    pendingCount: 0,
    syncedCount: 0,
    isConfigured: false,
    lastSyncTime: null,
    status: 'idle',
  });
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [showAnonKey, setShowAnonKey] = useState(false);

  const [newUnitInput, setNewUnitInput] = useState('');
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [validationError, setValidationError] = useState('');

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 4000);
  }

  useEffect(() => {
    async function loadStats() {
      const stats = await cloudSyncService.getSyncStats();
      setSyncStats(stats);
    }
    loadStats();
    const unsub = cloudSyncService.subscribe(async () => {
      const stats = await cloudSyncService.getSyncStats();
      setSyncStats(stats);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (settings) {
      setForm({
        vendor_name:          settings.vendor_name || '',
        tagline:              settings.tagline || '',
        owner_name:           settings.owner_name || '',
        mobile_number:        settings.mobile_number || '',
        secondary_mobile:     settings.secondary_mobile || '',
        market_name:          settings.market_name || '',
        gala_number:          settings.gala_number || '',
        address:              settings.address || '',
        city:                 settings.city || '',
        devotion_text:        settings.devotion_text || '',
        bill_footer_note:     settings.bill_footer_note || '',
        upi_id:               settings.upi_id || '',
        commission_rate:      settings.commission_rate || '8',
        default_payment_mode: settings.default_payment_mode || 'Cash',
        language:             settings.language || 'en',
        units:                parseArraySetting(settings.units, DEFAULT_UNITS),
        categories:           parseArraySetting(settings.categories, DEFAULT_CATEGORIES),
        supabase_url:         settings.supabase_url || '',
        supabase_anon_key:    settings.supabase_anon_key || '',
        auto_sync_enabled:    settings.auto_sync_enabled || 'false',
      });
    }
  }, [settings]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddUnit = () => {
    const trimmed = newUnitInput.trim();
    if (!trimmed) return;
    if (form.units.some((u) => u.toLowerCase() === trimmed.toLowerCase())) {
      showToast(t('settings.unitExists') || 'Unit already exists.', 'error');
      return;
    }
    setForm((prev) => ({ ...prev, units: [...prev.units, trimmed] }));
    setNewUnitInput('');
  };

  const handleRemoveUnit = (unitToRemove) => {
    if (form.units.length <= 1) {
      showToast('At least one measurement unit must remain.', 'error');
      return;
    }
    setForm((prev) => ({
      ...prev,
      units: prev.units.filter((u) => u !== unitToRemove),
    }));
  };

  const handleAddCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (form.categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      showToast(t('settings.categoryExists') || 'Category already exists.', 'error');
      return;
    }
    setForm((prev) => ({ ...prev, categories: [...prev.categories, trimmed] }));
    setNewCategoryInput('');
  };

  const handleRemoveCategory = (catToRemove) => {
    if (form.categories.length <= 1) {
      showToast('At least one category must remain.', 'error');
      return;
    }
    setForm((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c !== catToRemove),
    }));
  };

  const handleTestConnection = async () => {
    if (!form.supabase_url || !form.supabase_anon_key) {
      showToast('Please enter both Supabase Project URL and Public Anon Key.', 'error');
      return;
    }
    setTestingConnection(true);
    try {
      const res = await cloudSyncService.testConnection(form.supabase_url, form.supabase_anon_key);
      if (res.success) {
        // Auto-save credentials so Sync Now can find them without requiring a full Settings save
        await saveSettings({
          supabase_url: form.supabase_url.trim(),
          supabase_anon_key: form.supabase_anon_key.trim(),
        });
        showToast(res.message + ' Credentials saved.', 'success');
      } else {
        showToast(res.message, 'error');
      }
      const stats = await cloudSyncService.getSyncStats();
      setSyncStats(stats);
    } catch (err) {
      showToast(err.message || 'Connection test failed', 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleManualSync = async () => {
    if (!form.supabase_url || !form.supabase_anon_key) {
      showToast('Please enter Supabase credentials and click Test Connection first.', 'error');
      return;
    }
    setSyncingNow(true);
    try {
      // Ensure credentials are saved before pushing — handles case where user
      // typed new credentials but hasn't saved the full Settings form yet.
      await saveSettings({
        supabase_url: form.supabase_url.trim(),
        supabase_anon_key: form.supabase_anon_key.trim(),
      });
      const res = await cloudSyncService.syncNow();
      if (res.success) {
        showToast(res.message, 'success');
      } else {
        showToast(res.message, 'error');
      }
      const stats = await cloudSyncService.getSyncStats();
      setSyncStats(stats);
    } catch (err) {
      showToast(err.message || 'Sync failed', 'error');
    } finally {
      setSyncingNow(false);
    }
  };

  const handleResetAllData = async () => {
    if (!window.confirm('Are you sure you want to reset all local data? All customers, vegetables, transactions, and bills will be cleared.')) {
      return;
    }
    try {
      const { offlineDatabaseRepo } = await import('../db/offlineRepository');
      await offlineDatabaseRepo.resetAllData();
      showToast('All local data cleared to zero.', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err) {
      showToast(err.message || 'Failed to reset data', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');

    const rate = parseFloat(form.commission_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      const msg = t('settings.commissionError') || 'Commission must be 0–100%.';
      setValidationError(msg);
      showToast(msg, 'error');
      return;
    }

    const primaryMob = form.mobile_number ? form.mobile_number.trim() : '';
    if (primaryMob && !/^\d{10}$/.test(primaryMob)) {
      const msg = t('customers.mobileInvalid') || 'Mobile must be 10 digits.';
      setValidationError(msg);
      showToast(msg, 'error');
      return;
    }

    const secMob = form.secondary_mobile ? form.secondary_mobile.trim() : '';
    if (secMob && !/^\d{10}$/.test(secMob)) {
      const msg = t('customers.mobileInvalid') || 'Secondary mobile must be 10 digits.';
      setValidationError(msg);
      showToast(msg, 'error');
      return;
    }

    try {
      await saveSettings({
        ...form,
        mobile_number: primaryMob,
        secondary_mobile: secMob,
        units: JSON.stringify(form.units),
        categories: JSON.stringify(form.categories),
      });
      showToast(t('settings.saveSuccess'));
    } catch (err) {
      console.error('Failed to save settings:', err);
      showToast(err.message || t('settings.saveError'), 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-center" style={{ minHeight: '60vh', gap: 10 }}>
        <span className="spinner" /> {t('common.loading')}
      </div>
    );
  }

  const hasAlert = success || apiError || validationError;
  const isError  = !!(apiError || validationError);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', animation: 'pageIn 0.2s ease' }}>
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="page-header-bar" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-desc">{t('settings.subtitle')}</p>
        </div>
      </div>

      {hasAlert && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: isError ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
            color: isError ? 'var(--color-error)' : 'var(--color-success)',
            padding: '10px 16px',
            borderRadius: 'var(--border-radius-sm)',
            marginBottom: 20,
            fontSize: '0.875rem',
            fontWeight: 500,
            border: `1px solid ${isError ? 'var(--color-error)' : 'var(--color-success)'}20`,
          }}
        >
          {isError
            ? <AlertIcon style={{ flexShrink: 0 }} />
            : <CheckIcon style={{ flexShrink: 0 }} />}
          {validationError || (apiError || t('settings.saveSuccess'))}
        </div>
      )}

      <form onSubmit={handleSubmit}>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#dcfce7' }}>
              <BuildingIcon style={{ color: 'var(--color-primary)', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('settings.businessProfile')}</span>
          </div>
          <div className="settings-section-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label htmlFor="vendor_name" className="form-label">{t('settings.businessName')}</label>
                <MarathiInput
                  id="vendor_name"
                  name="vendor_name"
                  value={form.vendor_name}
                  onChange={(val) => setForm(p => ({ ...p, vendor_name: val }))}
                  placeholder={t('settings.businessNamePlaceholder')}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="tagline" className="form-label">{t('settings.tagline')}</label>
                <MarathiInput
                  id="tagline"
                  name="tagline"
                  value={form.tagline}
                  onChange={(val) => setForm(p => ({ ...p, tagline: val }))}
                  placeholder={t('settings.taglinePlaceholder')}
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label htmlFor="owner_name" className="form-label">{t('settings.ownerName')}</label>
                <MarathiInput
                  id="owner_name"
                  name="owner_name"
                  value={form.owner_name}
                  onChange={(val) => setForm(p => ({ ...p, owner_name: val }))}
                  placeholder={t('settings.ownerNamePlaceholder')}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="city" className="form-label">{t('settings.city')}</label>
                <MarathiInput
                  id="city"
                  name="city"
                  value={form.city}
                  onChange={(val) => setForm(p => ({ ...p, city: val }))}
                  placeholder={t('settings.cityPlaceholder')}
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label htmlFor="mobile_number" className="form-label">{t('settings.mobileNumber')}</label>
                <input
                  type="text"
                  id="mobile_number"
                  name="mobile_number"
                  value={form.mobile_number}
                  onChange={handleChange}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  className="form-input"
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="secondary_mobile" className="form-label">{t('settings.secondaryMobile')}</label>
                <input
                  type="text"
                  id="secondary_mobile"
                  name="secondary_mobile"
                  value={form.secondary_mobile}
                  onChange={handleChange}
                  placeholder="Optional 10-digit WhatsApp/mobile"
                  maxLength={10}
                  className="form-input"
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label htmlFor="market_name" className="form-label">{t('settings.marketName')}</label>
                <MarathiInput
                  id="market_name"
                  name="market_name"
                  value={form.market_name}
                  onChange={(val) => setForm(p => ({ ...p, market_name: val }))}
                  placeholder={t('settings.marketNamePlaceholder')}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="gala_number" className="form-label">{t('settings.galaNumber')}</label>
                <MarathiInput
                  id="gala_number"
                  name="gala_number"
                  value={form.gala_number}
                  onChange={(val) => setForm(p => ({ ...p, gala_number: val }))}
                  placeholder={t('settings.galaNumberPlaceholder')}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="address" className="form-label">{t('settings.address')}</label>
              <MarathiInput
                id="address"
                name="address"
                value={form.address}
                onChange={(val) => setForm(p => ({ ...p, address: val }))}
                placeholder={t('settings.addressPlaceholder')}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#dcfce7' }}>
              <LeafIcon style={{ color: 'var(--color-primary)', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('settings.produceMaster')}</span>
          </div>
          <div className="settings-section-body">
            <div style={{ marginBottom: 20 }}>
              <label className="form-label" style={{ fontWeight: 700, marginBottom: 4, display: 'block' }}>
                {t('settings.unitsManager')}
              </label>
              <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                {t('settings.unitsManagerHelp')}
              </p>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {form.units.map((u, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#f0fdf4',
                      color: '#15803d',
                      border: '1px solid #bbf7d0',
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                  >
                    <span>{u}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveUnit(u)}
                      title={`Remove unit "${u}"`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#15803d',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, maxWidth: 380 }}>
                <MarathiInput
                  id="new-unit-input"
                  value={newUnitInput}
                  onChange={setNewUnitInput}
                  placeholder={t('settings.addUnitPlaceholder')}
                />
                <button
                  type="button"
                  onClick={handleAddUnit}
                  className="btn btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                >
                  {t('settings.addUnitBtn')}
                </button>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '18px 0' }} />

            <div>
              <label className="form-label" style={{ fontWeight: 700, marginBottom: 4, display: 'block' }}>
                {t('settings.categoriesManager')}
              </label>
              <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                {t('settings.categoriesManagerHelp')}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {form.categories.map((cat, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#eff6ff',
                      color: '#1d4ed8',
                      border: '1px solid #bfdbfe',
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      title={`Remove category "${cat}"`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#1d4ed8',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, maxWidth: 440 }}>
                <MarathiInput
                  id="new-category-input"
                  value={newCategoryInput}
                  onChange={setNewCategoryInput}
                  placeholder={t('settings.addCategoryPlaceholder')}
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className="btn btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                >
                  {t('settings.addCategoryBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#fef3c7' }}>
              <ReceiptIcon style={{ color: '#d97706', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('settings.billCustomization')}</span>
          </div>
          <div className="settings-section-body">
            <div className="form-group">
              <label htmlFor="devotion_text" className="form-label">{t('settings.devotionText')}</label>
              <MarathiInput
                id="devotion_text"
                name="devotion_text"
                value={form.devotion_text}
                onChange={(val) => setForm(p => ({ ...p, devotion_text: val }))}
                placeholder={t('settings.devotionTextPlaceholder')}
                disabled={saving}
              />
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {t('settings.devotionTextHelp')}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="bill_footer_note" className="form-label">{t('settings.billFooterNote')}</label>
                <MarathiInput
                  id="bill_footer_note"
                  name="bill_footer_note"
                  value={form.bill_footer_note}
                  onChange={(val) => setForm(p => ({ ...p, bill_footer_note: val }))}
                  placeholder={t('settings.billFooterNotePlaceholder')}
                  disabled={saving}
                />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {t('settings.billFooterNoteHelp')}
                </p>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="upi_id" className="form-label">{t('settings.upiId')}</label>
                <input
                  type="text"
                  id="upi_id"
                  name="upi_id"
                  value={form.upi_id}
                  onChange={handleChange}
                  placeholder={t('settings.upiIdPlaceholder')}
                  className="form-input"
                  disabled={saving}
                />
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {t('settings.upiIdHelp')}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#dcfce7' }}>
              <ChartIcon style={{ color: 'var(--color-success)', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('settings.billingSetup')}</span>
          </div>
          <div className="settings-section-body">
            <div className="form-group" style={{ maxWidth: 300, marginBottom: 0 }}>
              <label htmlFor="commission_rate" className="form-label">{t('settings.commissionRate')}</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  id="commission_rate"
                  name="commission_rate"
                  step="0.1"
                  min="0"
                  max="100"
                  value={form.commission_rate}
                  onChange={handleChange}
                  className="form-input"
                  disabled={saving}
                  style={{ paddingRight: 32 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-text-muted)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                  }}
                >
                  %
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Applied as commission on each sale/bill
              </p>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#ede9fe' }}>
              <CogIcon style={{ color: '#7c3aed', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('settings.preferences')}</span>
          </div>
          <div className="settings-section-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="default_payment_mode" className="form-label">{t('settings.defaultPaymentMode')}</label>
                <select
                  id="default_payment_mode"
                  name="default_payment_mode"
                  value={form.default_payment_mode}
                  onChange={handleChange}
                  className="form-input form-select"
                  disabled={saving}
                >
                  <option value="Cash">{t('billing.paymentTypeCash')}</option>
                  <option value="UPI">{t('billing.paymentTypeUPI')}</option>
                  <option value="Credit">{t('billing.paymentTypeCredit')}</option>
                  <option value="Partial">{t('billing.paymentTypePartial')}</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="language" className="form-label">{t('settings.defaultLanguage')}</label>
                <select
                  id="language"
                  name="language"
                  value={form.language}
                  onChange={handleChange}
                  className="form-input form-select"
                  disabled={saving}
                >
                  <option value="en">{t('common.english')}</option>
                  <option value="mr">{t('common.marathi')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Cloud Data Synchronization & Supabase (PowerSync) Card */}
        <div className="settings-section" id="cloud-sync-settings">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#ecfdf5' }}>
              <CloudIcon style={{ color: '#059669', width: '16px', height: '16px' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span className="settings-section-title">Cloud Data Sync (Supabase & PowerSync)</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: '12px',
                  background: !form.supabase_url ? 'var(--color-bg)' : syncStats.pendingCount > 0 ? '#fef3c7' : '#d1fae5',
                  color: !form.supabase_url ? 'var(--color-text-muted)' : syncStats.pendingCount > 0 ? '#b45309' : '#065f46',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: !form.supabase_url ? '#9ca3af' : syncStats.pendingCount > 0 ? '#f59e0b' : '#10b981',
                  }}
                />
                {!form.supabase_url
                  ? 'Standalone Local Offline'
                  : syncStats.pendingCount > 0
                  ? `${syncStats.pendingCount} Pending Sync`
                  : 'Connected & Synced'}
              </span>
            </div>
          </div>
          <div className="settings-section-body">
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginBottom: 16 }}>
              Connect your Mobile app and Desktop computer to the same Supabase database. All bills, customers, vegetables, and transactions automatically synchronize in real-time or when network is available.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="supabase_url" className="form-label">
                  Supabase Project URL
                </label>
                <input
                  id="supabase_url"
                  name="supabase_url"
                  type="url"
                  value={form.supabase_url}
                  onChange={handleChange}
                  placeholder="https://xyzcompany.supabase.co"
                  className="form-input"
                  disabled={saving}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="supabase_anon_key" className="form-label">
                    Supabase Public Anon Key
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAnonKey(!showAnonKey)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showAnonKey ? 'Hide Key' : 'Show Key'}
                  </button>
                </div>
                <input
                  id="supabase_anon_key"
                  name="supabase_anon_key"
                  type={showAnonKey ? 'text' : 'password'}
                  value={form.supabase_anon_key}
                  onChange={handleChange}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                  className="form-input"
                  disabled={saving}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                padding: '12px 16px',
                background: 'var(--color-bg)',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                <span>Queue: <strong>{syncStats.pendingCount} pending</strong> changes ({syncStats.syncedCount} synced)</span>
                {syncStats.lastSyncTime && (
                  <span style={{ marginLeft: 12, color: 'var(--color-text-muted)' }}>
                    Last sync: {new Date(syncStats.lastSyncTime).toLocaleTimeString()}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  id="test-cloud-sync-btn"
                  className="btn btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                  onClick={handleTestConnection}
                  disabled={testingConnection || !form.supabase_url || !form.supabase_anon_key}
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  id="manual-cloud-sync-btn"
                  className="btn btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                  onClick={handleManualSync}
                  disabled={syncingNow || !form.supabase_url || !form.supabase_anon_key}
                >
                  {syncingNow ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  type="button"
                  id="reset-local-data-btn"
                  className="btn"
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.82rem',
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fecaca',
                  }}
                  onClick={handleResetAllData}
                >
                  Reset Local Data
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon" style={{ background: '#dbeafe' }}>
              <CloudIcon style={{ color: '#2563eb', width: '16px', height: '16px' }} />
            </div>
            <span className="settings-section-title">{t('nav.backup')}</span>
          </div>
          <div className="settings-section-body">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 700 }}>
                  Backup Directory
                </div>
                <code style={{ background: 'var(--color-bg)', padding: '5px 10px', borderRadius: 6, fontSize: '0.82rem', border: '1px solid var(--color-border)' }}>
                  /backups
                </code>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 700 }}>
                  {t('backup.googleDrive')}
                </div>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  Manage in <strong>Backup</strong> section
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 40,
            paddingTop: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            {toast.message && (
              <span
                style={{
                  color: toast.type === 'error' ? 'var(--color-error)' : 'var(--color-success)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {toast.type === 'error' ? <AlertIcon /> : <CheckIcon />}
                {toast.message}
              </span>
            )}
          </div>

          <button
            id="save-settings-btn"
            type="submit"
            className="btn btn-primary"
            style={{ padding: '10px 28px', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 7 }}
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="spinner" style={{ width: 13, height: 13 }} /> {t('settings.saving')}
              </>
            ) : (
              <>
                <SaveIcon style={{ width: '15px', height: '15px' }} /> {t('common.save')}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
