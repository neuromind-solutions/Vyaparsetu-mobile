/**
 * MainLayout Component
 * Shell layout that wraps all authenticated pages.
 * Renders: Sidebar + Topbar + page content via <Outlet />.
 */

import { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useTranslation } from '../hooks/useTranslation';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import ShortcutsHelpModal from '../components/ShortcutsHelpModal';
import cloudSyncService from '../services/cloudSyncService';

// Map routes to their title translation keys
const PAGE_META = {
  '/':             { title: 'nav.dashboard',    subtitle: 'dashboard.subtitle' },
  '/transactions': { title: 'nav.transactions', subtitle: 'transactions.subtitle' },
  '/daybook':      { title: 'nav.daybook',      subtitle: 'daybook.title' },
  '/billing':      { title: 'nav.billing',      subtitle: 'pages.billing.desc' },
  '/udhar':        { title: 'nav.udhar',        subtitle: 'pages.udhar.desc' },
  '/customers':    { title: 'nav.customers',    subtitle: 'pages.customers.desc' },
  '/vegetables':   { title: 'nav.vegetables',   subtitle: 'pages.vegetables.desc' },
  '/reports':      { title: 'nav.reports',      subtitle: 'pages.reports.desc' },
  '/backup':       { title: 'nav.backup',       subtitle: 'pages.backup.desc' },
  '/settings':     { title: 'nav.settings',     subtitle: 'pages.settings.desc' },
};

export default function MainLayout() {
  const { t, language, toggleLanguage } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useKeyboardShortcuts({ onOpenHelp: openShortcuts });

  // Auto-sync in background every 30 seconds (paused while user is typing/scrolling)
  useEffect(() => {
    cloudSyncService.startAutoSync(30000);
    return () => cloudSyncService.stopAutoSync();
  }, []);

  const meta = PAGE_META[pathname] || { title: 'common.appName', subtitle: '' };

  const QUICK_KEYS = [
    { key: 'F1', label: 'nav.transactions', to: '/transactions' },
    { key: 'F2', label: 'nav.billing',      to: '/billing' },
    { key: 'F3', label: 'nav.udhar',        to: '/udhar' },
    { key: 'F4', label: 'nav.daybook',      to: '/daybook' },
    { key: 'F6', label: 'nav.customers',    to: '/customers' },
    { key: 'F7', label: 'nav.vegetables',   to: '/vegetables' },
    { key: 'F8', label: 'nav.reports',      to: '/reports' },
    { key: 'Ctrl+L', label: language === 'mr' ? 'English' : 'मराठी', action: 'lang' },
    { key: 'F12', label: 'common.shortcuts', action: 'help' },
  ];

  return (
    <div className="app-layout" lang={language}>
      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={closeSidebar}
          aria-hidden="true" 
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
      <div className="main-content">
        <Topbar
          pageTitle={t(meta.title)}
          pageSubtitle={t(meta.subtitle)}
          onOpenShortcuts={openShortcuts}
          onToggleSidebar={toggleSidebar}
        />
        <main className="page-content" id="main-page-content">
          <Outlet />
        </main>

        {/* Mandi Quick Keyboard Shortcuts Dock */}
        <footer className="mandi-shortcuts-dock" aria-label="Keyboard Shortcuts Bar">
          <div className="shortcuts-dock-inner">
            <span className="dock-title">⚡ {(!t('common.shortcuts') || t('common.shortcuts').includes('common.')) ? (language === 'mr' ? 'शॉर्टकट्स' : 'Shortcuts') : t('common.shortcuts')}:</span>
            <div className="dock-keys-group">
              {QUICK_KEYS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="dock-key-chip"
                  onClick={() => {
                    if (item.action === 'help') openShortcuts();
                    else if (item.action === 'lang') toggleLanguage();
                    else if (item.to) navigate(item.to);
                  }}
                  title={`${item.key}: ${t(item.label)}`}
                >
                  <kbd className="dock-kbd">{item.key}</kbd>
                  <span className="dock-label">{t(item.label)}</span>
                </button>
              ))}
            </div>
          </div>
        </footer>
      </div>

      {/* Global Keyboard Shortcuts Help Modal */}
      <ShortcutsHelpModal isOpen={shortcutsOpen} onClose={closeShortcuts} />
    </div>
  );
}
