import { useTranslation } from '../hooks/useTranslation';

export default function ShortcutsHelpModal({ isOpen, onClose }) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const shortcuts = [
    { key: 'F1', desc: 'New Sale / Transactions (नवीन विक्री)' },
    { key: 'F2', desc: 'Invoices Archive (सर्व बिले)' },
    { key: 'F3', desc: 'Udhar / Khata Book (उधारी नोंद)' },
    { key: 'F4', desc: 'DayBook (रोजकीर्द)' },
    { key: 'F6', desc: 'Customers Directory (ग्राहक)' },
    { key: 'F7', desc: 'Vegetables Catalog (भाजीपाला दर)' },
    { key: 'F8', desc: 'Reports & Summary (अहवाल)' },
    { key: 'Ctrl + L', desc: 'Toggle Language (मराठी / EN)' },
    { key: '← → ↑ ↓', desc: 'Navigate Input Fields (घटक निवडा / हलवा)' },
    { key: '/', desc: 'Quick Search Focus (शोधा)' },
    { key: 'Enter', desc: 'Auto-advance & Save in Mandi Entry' },
    { key: 'Esc', desc: 'Close Modal / Deselect (रद्द करा)' },
  ];

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal modal-md" role="dialog" aria-modal="true" style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            ⌨️ Keyboard Shortcuts (शॉर्टकट कीज्)
          </h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
          {shortcuts.map((s) => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--color-bg-light)',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--color-border-light)',
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {s.desc}
              </span>
              <kbd
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.close') || 'Done'}
          </button>
        </div>
      </div>
    </>
  );
}
