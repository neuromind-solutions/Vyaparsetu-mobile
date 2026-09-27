/**
 * ActivationGate
 * The licensing wall. Nothing else in the app mounts until this passes, so it is
 * placed inside LanguageProvider but OUTSIDE BrowserRouter (see App.jsx) — no page,
 * layout, or data hook runs before the machine is activated.
 *
 *   loading      → full-viewport spinner
 *   !activated   → activation screen (Machine ID + key entry)
 *   activated    → renders children (the real app)
 *
 * The Machine ID shown here is what the customer reads to the seller; the seller
 * generates a key bound to it (tools/generate-license.mjs) and the customer pastes
 * it back. The key is verified server-side on every request.
 */

import { useState } from 'react';
import { useLicense } from '../hooks/useLicense';
import { useTranslation } from '../hooks/useTranslation';
import { KeyIcon, CopyIcon, CheckIcon, AlertIcon, GlobeIcon } from './Icons';

export default function ActivationGate({ children }) {
  const { t, language, toggleLanguage } = useTranslation();
  const {
    machineId,
    activated,
    loading,
    error,
    submitting,
    submitError,
    activate,
    refetch,
  } = useLicense();

  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);

  // ── Activated: the app is unlocked, get out of the way ──────────────────────
  if (activated) return children;

  // ── Still checking status on mount ──────────────────────────────────────────
  if (loading) {
    return (
      <div
        lang={language}
        className="flex flex-center"
        style={{ minHeight: '100vh', gap: 12, background: 'var(--color-bg)' }}
      >
        <span className="spinner" />
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {t('common.loading')}
        </span>
      </div>
    );
  }

  const copyMachineId = async () => {
    if (!machineId) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(machineId);
      } else {
        // Fallback for non-secure contexts (plain http://localhost in some setups)
        const ta = document.createElement('textarea');
        ta.value = machineId;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the ID is still visible for manual copying */
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanKey = key.replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
    if (!cleanKey || submitting) return;
    await activate(cleanKey);
    // On success the hook flips `activated` and this component renders children.
  };

  return (
    <div
      lang={language}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'var(--color-bg)',
        position: 'relative',
      }}
    >
      {/* Language toggle — mirrors Topbar, pinned top-right */}
      <button
        className="lang-toggle-btn"
        onClick={toggleLanguage}
        title={language === 'en' ? 'Switch to Marathi' : 'Switch to English'}
        style={{ position: 'absolute', top: 18, right: 18 }}
      >
        <GlobeIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
        {language === 'en' ? 'मराठी' : 'EN'}
      </button>

      <div className="card" style={{ width: '100%', maxWidth: 460, padding: 28 }}>
        {/* Icon + heading */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--color-primary-bg)',
              color: 'var(--color-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <KeyIcon style={{ width: 26, height: 26 }} />
          </div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 6px' }}>
            {t('activation.title')}
          </h1>
          <p
            style={{
              fontSize: '0.88rem',
              color: 'var(--color-text-secondary)',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {t('activation.subtitle')}
          </p>
        </div>

        {/* Machine ID — the number the customer reads to the seller */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              marginBottom: 6,
            }}
          >
            {t('activation.machineIdLabel')}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--border-radius-sm)',
              background: 'var(--color-primary-bg)',
              padding: '10px 14px',
            }}
          >
            <code
              style={{
                fontSize: '1.15rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--color-text-primary)',
                userSelect: 'all',
                wordBreak: 'break-all',
              }}
            >
              {machineId || '—'}
            </code>
            <button
              type="button"
              className="btn-icon"
              onClick={copyMachineId}
              disabled={!machineId}
              title={copied ? t('activation.copied') : t('activation.copy')}
              style={{ flexShrink: 0, color: copied ? 'var(--color-primary)' : 'inherit' }}
            >
              {copied ? (
                <CheckIcon style={{ width: 16, height: 16 }} />
              ) : (
                <CopyIcon style={{ width: 16, height: 16 }} />
              )}
            </button>
          </div>
          <span className="field-hint">{t('activation.machineIdHelp')}</span>
        </div>

        {/* Status fetch failed (e.g. backend not reachable yet) */}
        {error && (
          <div className="form-api-error">
            <AlertIcon style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={refetch}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                fontWeight: 700,
                textDecoration: 'underline',
              }}
            >
              {t('activation.retry')}
            </button>
          </div>
        )}

        {/* Key entry */}
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="license-key-input"
            style={{
              display: 'block',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              marginBottom: 6,
            }}
          >
            {t('activation.keyLabel')}
          </label>
          <textarea
            id="license-key-input"
            className="form-input form-textarea"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('activation.keyPlaceholder')}
            rows={3}
            disabled={submitting}
            spellCheck={false}
            autoComplete="off"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.8rem',
              wordBreak: 'break-all',
            }}
          />

          {submitError && (
            <div className="form-api-error" style={{ marginTop: 12 }}>
              <AlertIcon style={{ flexShrink: 0 }} />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !key.trim()}
            style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
          >
            {submitting ? (
              <>
                <span
                  className="spinner"
                  style={{
                    width: 15,
                    height: 15,
                    borderColor: 'rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                  }}
                />
                {t('activation.activating')}
              </>
            ) : (
              t('activation.activate')
            )}
          </button>
        </form>

        <p
          className="field-hint"
          style={{ textAlign: 'center', marginTop: 16 }}
        >
          {t('activation.contactSeller')}
        </p>
      </div>
    </div>
  );
}
