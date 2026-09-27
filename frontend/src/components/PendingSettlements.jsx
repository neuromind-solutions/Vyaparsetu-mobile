/**
 * PendingSettlements — every customer whose entries have not been billed yet.
 *
 * This panel answers the question the Transactions page could not previously answer:
 * *who am I yet to settle with, and for what period?* Without it, finding a customer's
 * unbilled entries meant selecting them, switching to the range filter and guessing how
 * far back to drag the start date — with an empty table and a disabled Generate Bill
 * button as the only feedback, and nothing anywhere saying unbilled entries existed.
 *
 * Clicking a row loads that customer and the exact span their unbilled entries occupy
 * into the history view below, which fills the table and enables Generate Bill. It does
 * not bill anything by itself — see useTransactions.openSettlement for why.
 *
 * Every figure here is derived, nothing is stored. The panel can be removed without
 * affecting a single rupee.
 */

import { useTranslation } from '../hooks/useTranslation';
import { formatBillDate } from '../utils/billDisplay';
import { daysSince } from '../utils/dates';

export default function PendingSettlements({
  settlements = [],
  activeCustomerId,
  onOpenSettlement,
}) {
  const { t, language } = useTranslation();
  const isMarathi = language === 'mr';

  const totalPending = settlements.reduce((acc, s) => acc + Number(s.total_amount || 0), 0);
  const totalEntries = settlements.reduce((acc, s) => acc + Number(s.entry_count || 0), 0);

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: settlements.length ? '1rem' : 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', fontWeight: 700 }}>
            <span>🧾</span> <span>{t('transactions.pending.title')}</span>
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            {t('transactions.pending.subtitle')}
          </p>
        </div>

        {settlements.length > 0 && (
          <div style={{ textAlign: 'right' }}>
            <span style={{ display: 'block', fontSize: '0.78rem', color: '#92400e', fontWeight: 600 }}>
              {t('transactions.pending.totalPending')}
            </span>
            <strong style={{ fontSize: '1.25rem', color: '#b45309', fontWeight: 800 }}>
              ₹{totalPending.toFixed(2)}
            </strong>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#a16207' }}>
              {t('transactions.pending.acrossEntries', { count: totalEntries, customers: settlements.length })}
            </span>
          </div>
        )}
      </div>

      {settlements.length === 0 ? (
        <div
          key="empty-pending"
          id="pending-settlements-empty"
          style={{ textAlign: 'center', padding: '1.5rem 1rem', color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', marginTop: '1rem' }}
        >
          <span>✅</span> <span>{t('transactions.pending.allSettled')}</span>
        </div>
      ) : (
        <div key="table-pending" className="table-container" style={{ overflowX: 'auto', maxHeight: '19rem', overflowY: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', textAlign: 'left', fontSize: '0.85rem', color: '#475569' }}>
                <th style={{ padding: '0.6rem 1rem' }}>{t('transactions.pending.customer')}</th>
                <th style={{ padding: '0.6rem 1rem' }}>{t('transactions.pending.entries')}</th>
                <th style={{ padding: '0.6rem 1rem' }}>{t('transactions.pending.period')}</th>
                <th style={{ padding: '0.6rem 1rem' }}>{t('transactions.pending.waiting')}</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>{t('transactions.pending.amount')}</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'center' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => {
                const waited = daysSince(s.oldest_date);
                const isActive = Number(activeCustomerId) === Number(s.customer_id);
                const from = formatBillDate(s.oldest_date, isMarathi);
                const to = formatBillDate(s.newest_date, isMarathi);

                return (
                  <tr
                    key={String(s.customer_id)}
                    id={`pending-row-${s.customer_id}`}
                    onClick={() => onOpenSettlement(s)}
                    style={{
                      borderBottom: '1px solid #e2e8f0',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      background: isActive ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                      <span>{s.customer_name}</span>
                      {s.customer_mobile && (
                        <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 400, color: '#64748b' }}>
                          {s.customer_mobile}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#334155' }}>
                      {s.entry_count}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: '#334155', whiteSpace: 'nowrap' }}>
                      {from === to ? from : `${from} – ${to}`}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap', color: waited >= 7 ? '#b91c1c' : '#64748b', fontWeight: waited >= 7 ? 700 : 400 }}>
                      {waited === null
                        ? '—'
                        : waited <= 0
                          ? t('transactions.pending.since.today')
                          : t('transactions.pending.since.days', { count: waited })}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                      ₹{Number(s.total_amount || 0).toFixed(2)}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        id={`pending-open-${s.customer_id}`}
                        onClick={(e) => { e.stopPropagation(); onOpenSettlement(s); }}
                        style={{ padding: '3px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                      >
                        {t('transactions.pending.open')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
