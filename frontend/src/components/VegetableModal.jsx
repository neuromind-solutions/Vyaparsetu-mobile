/**
 * VegetableModal Component
 * Handles Add and Edit in one modal.
 *
 * The name field is kept as a plain <input> with a comment marking
 * the exact slot where <MarathiInput> will replace it in a future module.
 *
 * Props:
 *  - isOpen       {boolean}
 *  - onClose      {function}
 *  - onSubmit     {function(data): Promise<{success, error?}>}
 *  - vegetable    {object|null}
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import useSettings from '../hooks/useSettings';
import MarathiInput from './MarathiInput';
import { LeafIcon, AlertIcon } from './Icons';

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

const EMPTY_FORM = {
  name: '',
  rate: '',
  unit: 'kg',
  category: 'सर्वसाधारण (General)',
  search_keywords: '',
  notes: '',
};

export default function VegetableModal({ isOpen, onClose, onSubmit, vegetable }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const isEdit = Boolean(vegetable);

  const availableUnits = parseArraySetting(settings?.units, DEFAULT_UNITS);
  const availableCategories = parseArraySetting(settings?.categories, DEFAULT_CATEGORIES);

  const [form, setForm]         = useState(EMPTY_FORM);
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setForm(
        vegetable
          ? {
              name:            vegetable.name,
              rate:            vegetable.rate,
              unit:            vegetable.unit || availableUnits[0] || 'kg',
              category:        vegetable.category || availableCategories[0] || 'General',
              search_keywords: vegetable.search_keywords || '',
              notes:           vegetable.notes || '',
            }
          : {
              ...EMPTY_FORM,
              unit: availableUnits[0] || 'kg',
              category: availableCategories[0] || 'General',
            }
      );
      setErrors({});
      setApiError('');
    }
  }, [isOpen, vegetable, settings]);

  if (!isOpen) return null;

  function validate() {
    const errs = {};
    if (!form.name.trim())  errs.name = t('vegetables.nameRequired');
    if (form.rate === '' || form.rate === null || form.rate === undefined)
      errs.rate = t('vegetables.rateRequired');
    else if (isNaN(parseFloat(form.rate)) || parseFloat(form.rate) < 0)
      errs.rate = t('vegetables.rateInvalid');
    return errs;
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((p) => ({ ...p, [name]: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);
    setApiError('');

    const result = await onSubmit({
      name:            form.name.trim(),
      rate:            parseFloat(form.rate),
      unit:            form.unit.trim() || 'kg',
      category:        (form.category || 'General').trim(),
      search_keywords: form.search_keywords.trim(),
      notes:           form.notes.trim(),
    });

    setSaving(false);
    if (result.success) onClose();
    else setApiError(result.error || t('common.error'));
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" id="vegetable-modal">
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LeafIcon style={{ color: 'var(--color-primary)' }} />
            {isEdit ? t('vegetables.editVegetable') : t('vegetables.addVegetable')}
          </h2>
          <button className="modal-close-btn" onClick={onClose} id="veg-modal-close">✕</button>
        </div>

        {apiError && (
          <div className="form-api-error" id="veg-form-api-error" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertIcon style={{ flexShrink: 0 }} />
            <span>{apiError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* ── Vegetable Name ─────────────────────────────────────────── */}
          <div className="form-group">
            <label className="form-label" htmlFor="veg-name">
              {t('vegetables.name')} <span className="required-star">*</span>
            </label>
            <MarathiInput
              id="veg-name"
              name="name"
              value={form.name}
              onChange={(val) => {
                setForm((p) => ({ ...p, name: val }));
                if (errors.name) setErrors((p) => ({ ...p, name: '' }));
              }}
              placeholder={t('vegetables.namePlaceholder')}
              hasError={Boolean(errors.name)}
              autoFocus
              label={t('transliteration.suggestionsLabel')}
            />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>

          {/* ── Rate + Unit (side by side) ─────────────────────────────── */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="veg-rate">
                {t('vegetables.rate')} <span className="required-star">*</span>
              </label>
              <div className="input-prefix-wrap">
                <span className="input-prefix">₹</span>
                <input
                  id="veg-rate"
                  name="rate"
                  type="number"
                  min="0"
                  step="0.01"
                  className={`form-input input-with-prefix${errors.rate ? ' input-error' : ''}`}
                  placeholder={t('vegetables.ratePlaceholder')}
                  value={form.rate}
                  onChange={handleChange}
                />
              </div>
              {errors.rate && <span className="field-error">{errors.rate}</span>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="veg-unit">
                {t('vegetables.unit')}
              </label>
              <select
                id="veg-unit"
                name="unit"
                className="form-input form-select"
                value={form.unit}
                onChange={handleChange}
              >
                {availableUnits.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Category Selector ──────────────────────────────────────── */}
          <div className="form-group">
            <label className="form-label" htmlFor="veg-category">
              वर्गवारी / Category
            </label>
            <select
              id="veg-category"
              name="category"
              className="form-input form-select"
              value={form.category}
              onChange={handleChange}
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* ── Search Keywords ────────────────────────────────────────── */}
          <div className="form-group">
            <label className="form-label" htmlFor="veg-keywords">
              {t('vegetables.searchKeywords')}
            </label>
            <MarathiInput
              id="veg-keywords"
              name="search_keywords"
              value={form.search_keywords}
              onChange={(val) => setForm((p) => ({ ...p, search_keywords: val }))}
              placeholder={t('vegetables.searchKeywordsPlaceholder')}
              label={t('transliteration.suggestionsLabel')}
            />
            <span className="field-hint">{t('vegetables.searchKeywordsHelp')}</span>
          </div>

          {/* ── Notes ─────────────────────────────────────────────────── */}
          <div className="form-group">
            <label className="form-label" htmlFor="veg-notes">
              {t('vegetables.notes')}
            </label>
            <MarathiInput
              id="veg-notes"
              name="notes"
              value={form.notes}
              onChange={(val) => setForm((p) => ({ ...p, notes: val }))}
              placeholder={t('vegetables.notesPlaceholder')}
              label={t('transliteration.suggestionsLabel')}
            />
          </div>

          {/* ── Actions ───────────────────────────────────────────────── */}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving} id="veg-cancel-btn">
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving} id="veg-save-btn">
              {saving ? (
                <span className="flex flex-center gap-sm">
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  {t('common.loading')}
                </span>
              ) : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
