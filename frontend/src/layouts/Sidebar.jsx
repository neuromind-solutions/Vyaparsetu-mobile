/**
 * Sidebar Component — Light sidebar inspired by Vyapar/MyBillBook
 * White background with green active state, rounded nav items.
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';
import appLogo from '../assets/logo.png';

// ─── Nav Icon SVGs ────────────────────────────────────────────────────────────
const NavIcons = {
  Dashboard: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Customers: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Vegetables: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 9.8a7 7 0 0 1-9 8.2z"/>
      <path d="M9 22v-4"/>
    </svg>
  ),
  Billing: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/>
      <line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/>
    </svg>
  ),
  Transactions: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="7" y1="15" x2="12" y2="15" />
    </svg>
  ),
  DayBook: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
  Udhar: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Reports: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
    </svg>
  ),
  Backup: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 16 20 20 4 20 4 16"/>
      <polyline points="8 12 12 16 16 12"/>
      <line x1="12" y1="4" x2="12" y2="16"/>
    </svg>
  ),
  Settings: () => (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
};

const NAV_ITEMS = [
  { key: 'dashboard',    to: '/',             icon: NavIcons.Dashboard,    label: 'nav.dashboard' },
  { key: 'transactions', to: '/transactions', icon: NavIcons.Transactions, label: 'nav.transactions', shortcut: 'F1' },
  { key: 'daybook',      to: '/daybook',      icon: NavIcons.DayBook,      label: 'nav.daybook',      shortcut: 'F4' },
  { key: 'billing',      to: '/billing',      icon: NavIcons.Billing,      label: 'nav.billing',      shortcut: 'F2' },
  { key: 'udhar',        to: '/udhar',        icon: NavIcons.Udhar,        label: 'nav.udhar',        shortcut: 'F3' },
  { key: 'customers',    to: '/customers',    icon: NavIcons.Customers,    label: 'nav.customers',    shortcut: 'F6' },
  { key: 'vegetables',   to: '/vegetables',   icon: NavIcons.Vegetables,   label: 'nav.vegetables',   shortcut: 'F7' },
  { key: 'reports',      to: '/reports',      icon: NavIcons.Reports,      label: 'nav.reports',      shortcut: 'F8' },
  { key: 'backup',       to: '/backup',       icon: NavIcons.Backup,       label: 'nav.backup' },
  { key: 'settings',     to: '/settings',     icon: NavIcons.Settings,     label: 'nav.settings' },
];


export default function Sidebar({ isOpen, onClose }) {
  const { t } = useTranslation();

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} id="main-sidebar">
      {/* Official App Logo */}
      <div className="sidebar-brand">
        <NavLink 
          to="/" 
          className="sidebar-brand-link" 
          title="VyapaarSetu"
          onClick={() => { if (onClose) onClose(); }}
        >
          <img
            src={appLogo}
            alt="VyapaarSetu"
            className="sidebar-brand-logo"
          />
        </NavLink>

        {/* Mobile-only close drawer button */}
        <button
          type="button"
          className="sidebar-mobile-close-btn"
          onClick={onClose}
          aria-label="Close Menu"
          title="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-section-label">Menu</div>
        {NAV_ITEMS.map(({ key, to, icon: Icon, label, shortcut }) => (
          <NavLink
            key={key}
            to={to}
            end={to === '/'}
            id={`nav-${key}`}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={() => { if (onClose) onClose(); }}
          >
            <Icon />
            <span style={{ flex: 1 }}>{t(label)}</span>
            {shortcut && (
              <span className="nav-shortcut-badge">{shortcut}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        VyapaarSetu v1.0
      </div>
    </aside>
  );
}
