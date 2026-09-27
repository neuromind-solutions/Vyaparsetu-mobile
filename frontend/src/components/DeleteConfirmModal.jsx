/**
 * DeleteConfirmModal Component
 * Generic confirmation dialog for destructive actions with strict Double Verification.
 * 
 * Double Verification Workflow:
 *  - Step 1: Initial review of the item being deleted with "पुढे जा (Proceed)"
 *  - Step 2: Irreversible warning with mandatory safety checkbox before the final delete button activates.
 * 
 * Props:
 *  - isOpen        {boolean}
 *  - onClose       {function}
 *  - onConfirm     {function}
 *  - title         {string}
 *  - message       {string}
 *  - subMessage    {string}
 *  - loading       {boolean}
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { TrashIcon, AlertIcon } from './Icons';

export default function DeleteConfirmModal({
  isOpen, onClose, onConfirm,
  title, message, subMessage,
  loading = false,
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Reset to Step 1 whenever modal is opened or closed
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setIsConfirmed(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal modal-sm" role="dialog" id="delete-confirm-modal" style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrashIcon /> {title}
          </h2>
          <button className="modal-close-btn" onClick={onClose} disabled={loading}>✕</button>
        </div>

        {/* Double Verification Progress Bar / Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0 16px', background: '#fef2f2', padding: '6px 12px', borderRadius: '6px', border: '1px solid #fee2e2' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#991b1b' }}>
            {step === 1 ? 'खात्री पायरी १/२ : प्राथमिक तपासणी' : 'खात्री पायरी २/२ : अंतिम दुहेरी खात्री (Double Verification)'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <span style={{ width: 12, height: 6, borderRadius: 3, background: '#ef4444' }} />
            <span style={{ width: 12, height: 6, borderRadius: 3, background: step === 2 ? '#ef4444' : '#fca5a5' }} />
          </div>
        </div>

        {step === 1 && (
          <div style={{ padding: '4px 0 20px' }}>
            <p style={{ fontSize: '0.98rem', color: 'var(--color-text-primary)', marginBottom: 8, fontWeight: 600 }}>
              {message}
            </p>
            {subMessage && (
              <p style={{ fontSize: '0.84rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                {subMessage}
              </p>
            )}
            <div style={{ marginTop: '12px', background: '#fffbeb', border: '1px solid #fef3c7', padding: '10px 12px', borderRadius: '6px', fontSize: '0.82rem', color: '#b45309' }}>
              ℹ️ अनपेक्षितपणे डेटा नष्ट होऊ नये म्हणून पुढील पायरीवर दुहेरी खात्री (Double Verification) आवश्यक आहे.
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ padding: '4px 0 20px' }}>
            <div style={{ background: '#fef2f2', border: '1.5px solid #f87171', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c', fontWeight: 800, fontSize: '0.92rem', marginBottom: '4px' }}>
                <AlertIcon style={{ width: '18px', height: '18px' }} />
                <span>अंतिम दुहेरी खात्री (Double Verification)</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#991b1b', lineHeight: 1.4 }}>
                हा व्यवहार किंवा नोंद कायमची हटवली जाईल आणि ती पुन्हा परत मिळवता येणार नाही!
              </p>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                cursor: 'pointer',
                background: isConfirmed ? '#f0fdf4' : 'var(--color-bg-light)',
                border: `1.5px solid ${isConfirmed ? '#86efac' : 'var(--color-border)'}`,
                padding: '10px 12px',
                borderRadius: '6px',
                userSelect: 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <input
                type="checkbox"
                id="delete-double-verify-check"
                checked={isConfirmed}
                onChange={(e) => setIsConfirmed(e.target.checked)}
                style={{ width: '18px', height: '18px', marginTop: '2px', cursor: 'pointer', accentColor: '#dc2626' }}
              />
              <span style={{ fontSize: '0.86rem', fontWeight: 600, color: isConfirmed ? '#15803d' : 'var(--color-text-primary)', lineHeight: 1.4 }}>
                होय, मला खात्री आहे की मला हा डेटा कायमचा हटवायचा आहे.
              </span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          {step === 1 ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={loading}
                id="delete-cancel-btn"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setStep(2)}
                disabled={loading}
                id="delete-step1-next-btn"
                style={{
                  background: '#ea580c',
                  borderColor: '#c2410c',
                  color: 'white',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px'
                }}
              >
                <span>खात्री करा आणि पुढे जा ➔</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setStep(1); setIsConfirmed(false); }}
                disabled={loading}
                id="delete-back-btn"
              >
                ← मागे जा
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={onConfirm}
                disabled={loading || !isConfirmed}
                id="delete-confirm-btn"
                style={{
                  opacity: isConfirmed ? 1 : 0.5,
                  cursor: isConfirmed ? 'pointer' : 'not-allowed',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {loading ? (
                  <span className="flex flex-center gap-sm">
                    <span className="spinner" style={{ width: 14, height: 14, borderTopColor: 'white' }} />
                    {t('common.loading')}
                  </span>
                ) : (
                  <span className="flex flex-center gap-sm">
                    <TrashIcon />
                    होय, कायमचे हटवा
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
