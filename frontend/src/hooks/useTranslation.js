/**
 * useTranslation Hook
 * Thin convenience hook to access the t() function from LanguageContext.
 */

import { useLanguage } from '../context/LanguageContext';

export function useTranslation() {
  const { t, language, setLanguage, toggleLanguage } = useLanguage();
  return { t, language, setLanguage, toggleLanguage };
}
