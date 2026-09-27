/**
 * Reusable Coming Soon placeholder component.
 * Used by all feature pages that are not yet implemented.
 */

import { useTranslation } from '../hooks/useTranslation';
import { CogIcon } from './Icons';

export default function ComingSoon({ icon = <CogIcon style={{ fontSize: '2rem', color: 'var(--color-text-secondary)' }} />, pageKey }) {
  const { t } = useTranslation();

  return (
    <div className="coming-soon-container" id={`coming-soon-${pageKey}`}>
      <div className="coming-soon-icon">{icon}</div>
      <h2 className="coming-soon-title">{t('common.comingSoon')}</h2>
      <p className="coming-soon-desc">{t('common.comingSoonDesc')}</p>
    </div>
  );
}
