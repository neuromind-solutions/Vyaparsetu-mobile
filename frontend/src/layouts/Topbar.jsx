/**
 * Topbar Component — Cleaner, Vyapar-inspired
 * Pill language toggle, slim border, business-name display.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { GlobeIcon } from '../components/Icons';
import cloudSyncService from '../services/cloudSyncService';

export default function Topbar({ pageTitle, pageSubtitle, onOpenShortcuts, onToggleSidebar }) {
  const { language, toggleLanguage } = useTranslation();
  const [syncState, setSyncState] = useState({
    status: cloudSyncService.status,
    isSyncing: cloudSyncService.isSyncing,
    lastSyncTime: cloudSyncService.lastSyncTime,
  });

  useEffect(() => {
    return cloudSyncService.subscribe((state) => {
      setSyncState({
        status: state.status,
        isSyncing: state.isSyncing,
        lastSyncTime: state.lastSyncTime,
      });
    });
  }, []);

  const handleManualSync = async () => {
    try {
      await cloudSyncService.syncNow();
    } catch (e) {
      console.warn('Sync click error:', e);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Mobile Hamburger Toggle Button - Strictly Pinned to Far Left */}
        <button
          type="button"
          id="mobile-nav-toggle"
          className="mobile-menu-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle Navigation Menu"
          title="Open Menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Page Title & Subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="topbar-title">{pageTitle || 'VyapaarSetu'}</span>
          {pageSubtitle && (
            <>
              <span style={{ color: 'var(--color-border)', fontSize: '0.9rem' }}>|</span>
              <span className="topbar-subtitle">{pageSubtitle}</span>
            </>
          )}
        </div>
      </div>

      <div className="topbar-right">
        {/* Live Auto-Sync Status & Action Button */}
        <button
          type="button"
          id="topbar-sync-btn"
          className="lang-toggle-btn"
          onClick={handleManualSync}
          disabled={syncState.isSyncing}
          title={
            syncState.isSyncing
              ? 'Auto-syncing with Cloud...'
              : syncState.lastSyncTime
              ? `Auto-sync active (Last: ${new Date(syncState.lastSyncTime).toLocaleTimeString()}) - Click to sync now`
              : 'Auto-sync active - Click to sync now'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.78rem',
            padding: '4px 10px',
            borderRadius: '16px',
            cursor: syncState.isSyncing ? 'wait' : 'pointer',
            border: syncState.status === 'error' ? '1px solid #f87171' : '1px solid var(--border-color, #e2e8f0)',
            backgroundColor: syncState.isSyncing ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
          }}
        >
          {syncState.isSyncing ? (
            <>
              <svg className="spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
              </svg>
              <span style={{ color: '#2563eb', fontWeight: 600 }}>{language === 'mr' ? 'सिंक होत आहे...' : 'Syncing...'}</span>
            </>
          ) : (
            <>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: syncState.status === 'error' ? '#ef4444' : '#10b981',
                display: 'inline-block',
                boxShadow: syncState.status === 'error' ? '0 0 6px #ef4444' : '0 0 6px #10b981',
              }} />
              <span style={{ color: 'var(--text-secondary, #64748b)', fontWeight: 500 }}>
                {syncState.status === 'error' ? (language === 'mr' ? 'त्रुटी' : 'Error') : (language === 'mr' ? 'क्लाउड सिंक' : 'Cloud Sync')}
              </span>
            </>
          )}
        </button>


        {/* Keyboard Shortcuts button (desktop only) */}
        <button
          id="shortcuts-help-btn"
          className="lang-toggle-btn shortcuts-btn"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts (F12 or ?)"
          style={{ gap: '5px', fontSize: '0.78rem' }}
        >
          <span>⌨️</span>
          <span>F12</span>
        </button>

        {/* Language Toggle — pill style */}
        <button
          id="lang-toggle-btn"
          className="lang-toggle-btn"
          onClick={toggleLanguage}
          title={language === 'en' ? 'Switch to Marathi (Ctrl+L)' : 'Switch to English (Ctrl+L)'}
        >
          <GlobeIcon style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          <span>{language === 'en' ? 'मराठी' : 'EN'}</span>
        </button>
      </div>
    </header>
  );
}
