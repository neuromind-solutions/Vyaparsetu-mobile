/* eslint-disable react-refresh/only-export-components */
/**
 * LanguageContext
 * Provides language state and the t() translation function to the entire app.
 * Selected language is persisted to localStorage.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import en from '../i18n/en.json';
import mr from '../i18n/mr.json';

const TRANSLATIONS = { en, mr };
const STORAGE_KEY = 'vyapaarsetu_lang';

const LanguageContext = createContext(null);

/**
 * Read the saved language, tolerating a localStorage that throws.
 *
 * This runs during the very first render of the provider that wraps the entire app.
 * An unguarded throw here takes the whole UI down before anything is on screen, and
 * a language preference is not worth that — falling back to English is.
 */
function readSavedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return TRANSLATIONS[saved] ? saved : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Resolves a dot-notated key from a nested translation object.
 * Example: t('nav.dashboard') → "Dashboard"
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => {
    return acc && acc[key] !== undefined ? acc[key] : null;
  }, obj);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readSavedLanguage);

  const setLanguage = useCallback((lang) => {
    if (TRANSLATIONS[lang]) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // The switch still applies for this session; only persistence is lost.
      }
      setLanguageState(lang);
    }
  }, []);

  /**
   * Translate a dot-notated key.
   * Falls back to the key itself if translation is missing.
   *
   * `vars` fills `{{name}}` placeholders. Interpolating rather than concatenating
   * in JSX lets each language put the values where its own grammar needs them —
   * Marathi does not order a sentence the way English does.
   *
   * @param {string} key - e.g. 'nav.dashboard'
   * @param {Object} [vars] - e.g. { stored: '400.00' }
   * @returns {string}
   */
  const t = useCallback((key, vars) => {
    const activeTranslations = TRANSLATIONS[language] || TRANSLATIONS.en;
    let text = resolvePath(activeTranslations, key);
    
    // Fallback to English if missing in selected language
    if (text === null || text === undefined) {
      text = resolvePath(TRANSLATIONS.en, key);
    }

    // If still missing, format into clean readable string rather than raw dot-notated key
    if (text === null || text === undefined) {
      const lastKey = key.split('.').pop() || key;
      // Convert camelCase or dot to Title Case words
      text = lastKey.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim();
    }

    if (!vars || typeof text !== 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    );
  }, [language]);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'mr' : 'en');
  }, [language, setLanguage]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
