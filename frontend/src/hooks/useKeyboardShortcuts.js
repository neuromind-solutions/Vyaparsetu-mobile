import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from './useTranslation';

export function useKeyboardShortcuts({ onOpenHelp }) {
  const navigate = useNavigate();
  const { toggleLanguage } = useTranslation();

  useEffect(() => {
    function handleKeyDown(e) {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      const key = e.key;
      const code = e.code;

      if (key === 'Escape' || code === 'Escape') {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        return;
      }

      // F1 or Alt+1: New Sale / Transactions
      if (key === 'F1' || code === 'F1' || (e.altKey && (key === '1' || code === 'Digit1'))) {
        e.preventDefault();
        navigate('/transactions');
        return;
      }

      // F2 or Alt+2: Billing Archive
      if (key === 'F2' || code === 'F2' || (e.altKey && (key === '2' || code === 'Digit2'))) {
        e.preventDefault();
        navigate('/billing');
        return;
      }

      // F3 or Alt+3: Udhar / Khata
      if (key === 'F3' || code === 'F3' || (e.altKey && (key === '3' || code === 'Digit3'))) {
        e.preventDefault();
        navigate('/udhar');
        return;
      }

      // F4 or Alt+4: DayBook
      if (key === 'F4' || code === 'F4' || (e.altKey && (key === '4' || code === 'Digit4'))) {
        e.preventDefault();
        navigate('/daybook');
        return;
      }

      // F6 or Alt+6: Customers
      if (key === 'F6' || code === 'F6' || (e.altKey && (key === '6' || code === 'Digit6'))) {
        e.preventDefault();
        navigate('/customers');
        return;
      }

      // F7 or Alt+7: Vegetables Catalog
      if (key === 'F7' || code === 'F7' || (e.altKey && (key === '7' || code === 'Digit7'))) {
        e.preventDefault();
        navigate('/vegetables');
        return;
      }

      // F8 or Alt+8: Reports
      if (key === 'F8' || code === 'F8' || (e.altKey && (key === '8' || code === 'Digit8'))) {
        e.preventDefault();
        navigate('/reports');
        return;
      }

      // F12 or Alt+H or '?': Shortcuts Help
      if (key === 'F12' || code === 'F12' || (e.altKey && (key === 'h' || key === 'H')) || (key === '?' && !isInput)) {
        e.preventDefault();
        if (onOpenHelp) onOpenHelp();
        return;
      }

      // Ctrl+L or Alt+L: Toggle Language
      if ((e.ctrlKey || e.altKey) && (key === 'l' || key === 'L' || code === 'KeyL')) {
        e.preventDefault();
        toggleLanguage();
        return;
      }

      // Focus global search with '/' if not already typing
      if (key === '/' && !isInput) {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="text"], input[type="search"]');
        searchInput?.focus();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [navigate, toggleLanguage, onOpenHelp]);
}
