/**
 * DayBookPage — the vendor's रोजकीर्द: one day, every customer, one screen.
 *
 * An adatya's day is a running log across dozens of customers. The Transactions page is
 * built for the opposite shape — one customer at a time — because that is what settling a
 * bill needs. So the question every vendor asks at close of business had no answer here:
 * *how much did I move today, to whom, and how much of it is still owed to me?* Totalling
 * it meant clicking through every customer in turn with a calculator.
 *
 * Read-only by construction. It calls exactly one endpoint, `GET /api/transactions?date=`,
 * which cannot write. There is no action on this page that changes a stored rupee, so the
 * vendor can navigate the whole year's days freely.
 *
 * Commission is shown. This is the vendor's own screen on the vendor's own PC — the
 * internal view the hidden-commission work deliberately preserved. Nothing here is ever
 * handed to a customer.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';
import { useDayBook } from '../hooks/useDayBook';
import BilledBadge from '../components/BilledBadge';
import { parseLocalDate, formatStoredTime } from '../utils/dates';
import { CalendarIcon, ReceiptIcon, ChartIcon, HistoryIcon, UsersIcon } from '../components/Icons';

/** ₹ with thousands separators, always to the paisa on money the vendor may reconcile. */
function rupees(value, decimals = 2) {
  const n = Number(value || 0);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Weight to at most 2dp, but without a trailing `.00` on whole numbers. */
function weight(value) {
  const n = Number(value || 0);
  return Number(n.toFixed(2)).toLocaleString('en-IN');
}

/**
 * A unit's label in the vendor's language, falling back to the stored string.
 *
 * `t()` returns the key itself when a translation is missing, so the obvious
 * `t(key) || unit` never falls back — it renders the literal "vegetables.units.crate".
 * The vegetable form offers six fixed units, but the column is plain TEXT with no CHECK
 * constraint, so data created through the API or carried in from a client's old system
 * can hold anything. Showing the raw unit is right in that case; showing a translation
 * key is never right.
 */
function unitLabel(t, unit) {
  const key = `vegetables.units.${unit}`;
  const label = t(key);
  return label === key ? unit : label;
}

export default function DayBookPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const isMarathi = language === 'mr';

  const {
    date,
    setDate,
    stepDay,
    goToToday,
    isToday,
    today,
    timeline,
    summary,
    byVegetable,
    loading,
    error,
  } = useDayBook();

  /**
   * Open the bill in the billing archive directly from the Day Book row.
   */
  function openBillInArchive(billId) {
    if (!billId) return;
    navigate(`/billing?bill=${encodeURIComponent(billId)}`);
  }

  /**
   * "Friday, 28 August 2026" — the weekday matters. A vendor navigating back through days
   * thinks in market days, not calendar numbers, and the weekday is what tells them which
   * day they are actually looking at.
   */
  const headingDate = useMemo(() => {
    const parsed = parseLocalDate(date);
    if (!parsed) return date;
    return parsed.toLocaleDateString(isMarathi ? 'mr-IN' : 'en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [date, isMarathi]);

  const cellStyle = { padding: '10px 14px', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.88rem', color: 'var(--color-text-primary)' };
  const headStyle = { padding: '10px 14px', fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div className="page-container" id="daybook-page" style={{ animation: 'pageIn 0.2s ease' }}>
      {/* ── Header + date navigator ─────────────────────────────────────────── */}
      <div
        className="page-header"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.25rem' }}
      >
        <div>
          <h1 className="page-title">{t('daybook.title')}</h1>
          <p className="page-subtitle" id="daybook-heading-date">
            {headingDate}
            {isToday && (
              <span style={{ marginLeft: '0.5rem', padding: '1px 8px', borderRadius: '999px', background: '#dcfce7', color: '#15803d', fontSize: '0.72rem', fontWeight: 700 }}>
                {t('daybook.todayTag')}
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            className="btn btn-outline"
            id="daybook-prev-day"
            onClick={() => stepDay(-1)}
            title={t('daybook.prevDay')}
            aria-label={t('daybook.prevDay')}
            style={{ padding: '6px 11px', lineHeight: 1 }}
          >
            ◀
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
            <CalendarIcon style={{ width: '16px', height: '16px', color: '#64748b' }} />
            <input
              type="date"
              id="daybook-date"
              className="form-input"
              value={date}
              // Cannot look past today: there are no entries in the future, and an empty
              // screen dated next week reads as data loss rather than as an empty day.
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              style={{ padding: '5px 8px', fontSize: '0.88rem', width: '9.5rem' }}
            />
          </div>

          <button
            type="button"
            className="btn btn-outline"
            id="daybook-next-day"
            onClick={() => stepDay(1)}
            // Disabled rather than hidden, so the control does not jump position when the
            // vendor steps back and forth.
            disabled={isToday}
            title={t('daybook.nextDay')}
            aria-label={t('daybook.nextDay')}
            style={{ padding: '6px 11px', lineHeight: 1, opacity: isToday ? 0.4 : 1 }}
          >
            ▶
          </button>

          <button
            type="button"
            className="btn btn-primary"
            id="daybook-today"
            onClick={goToToday}
            disabled={isToday}
            style={{ padding: '6px 14px', fontSize: '0.85rem', opacity: isToday ? 0.5 : 1 }}
          >
            {t('daybook.today')}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" id="daybook-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '6px' }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── The day's totals ───────────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: '1.25rem' }}>
        <div className="kpi-card" id="daybook-kpi-entries">
          <div className="kpi-icon-box kpi-icon-blue">
            <UsersIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{summary.entryCount}</div>
            <div className="kpi-label">
              {t('daybook.kpi.entries')}
              {summary.customerCount > 0 && (
                <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>
                  {t('daybook.kpi.customers', { count: summary.customerCount })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-card" id="daybook-kpi-total">
          <div className="kpi-icon-box kpi-icon-green">
            <ReceiptIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{rupees(summary.totalValue, 0)}</div>
            <div className="kpi-label">{t('daybook.kpi.totalValue')}</div>
          </div>
        </div>

        <div className="kpi-card" id="daybook-kpi-received">
          <div className="kpi-icon-box kpi-icon-teal">
            <ChartIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{rupees(summary.totalPaid, 0)}</div>
            <div className="kpi-label">{t('daybook.kpi.received')}</div>
          </div>
        </div>

        <div className="kpi-card" id="daybook-kpi-outstanding">
          <div className="kpi-icon-box kpi-icon-red">
            <HistoryIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{rupees(summary.totalRemaining, 0)}</div>
            <div className="kpi-label">{t('daybook.kpi.outstanding')}</div>
          </div>
        </div>

        {/* The shop's own margin. Vendor-facing only — see the header comment. */}
        <div className="kpi-card" id="daybook-kpi-commission">
          <div className="kpi-icon-box kpi-icon-blue">
            <ChartIcon style={{ width: '20px', height: '20px' }} />
          </div>
          <div className="kpi-content">
            <div className="kpi-value">{rupees(summary.totalCommission, 0)}</div>
            <div className="kpi-label">{t('daybook.kpi.commission')}</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" id="daybook-loading" style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
          {t('common.loading')}
        </div>
      ) : timeline.length === 0 ? (
        <div className="card" id="daybook-empty" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📖</div>
          <p style={{ margin: 0, fontWeight: 700, color: '#0f172a' }}>{t('daybook.empty.title')}</p>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>
            {isToday ? t('daybook.empty.today') : t('daybook.empty.pastDay')}
          </p>
        </div>
      ) : (
        <>
          {/* ── What moved today, per vegetable ─────────────────────────────── */}
          <div className="card" id="daybook-by-vegetable" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.15rem 0', fontSize: '1.05rem', color: '#0f172a', fontWeight: 700 }}>
              🥔 {t('daybook.byVegetable.title')}
            </h3>
            <p style={{ margin: '0 0 0.9rem 0', fontSize: '0.82rem', color: '#64748b' }}>
              {t('daybook.byVegetable.subtitle')}
            </p>
            <div className="table-container" style={{ overflowX: 'auto', maxHeight: '17rem', overflowY: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={headStyle}>{t('daybook.byVegetable.vegetable')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.byVegetable.entries')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.byVegetable.quantity')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.byVegetable.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byVegetable.map((v) => (
                    <tr key={`${v.name}|${v.unit}`}>
                      <td style={{ ...cellStyle, fontWeight: 600, color: '#0f172a' }}>{v.name}</td>
                      <td style={{ ...cellStyle, textAlign: 'right', color: '#64748b' }}>{v.entryCount}</td>
                      <td style={{ ...cellStyle, textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>
                        {weight(v.weight)} {unitLabel(t, v.unit)}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                        {rupees(v.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Every entry, in the order it was logged ─────────────────────── */}
          <div className="card" id="daybook-entries" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.15rem 0', fontSize: '1.05rem', color: '#0f172a', fontWeight: 700 }}>
              📋 {t('daybook.entries.title')}
            </h3>
            <p style={{ margin: '0 0 0.9rem 0', fontSize: '0.82rem', color: '#64748b' }}>
              {t('daybook.entries.subtitle')}
            </p>
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={headStyle}>#</th>
                    <th style={headStyle}>{t('daybook.entries.time')}</th>
                    <th style={headStyle}>{t('daybook.entries.customer')}</th>
                    <th style={headStyle}>{t('daybook.entries.vegetable')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.entries.quantity')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.entries.rate')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.entries.amount')}</th>
                    <th style={{ ...headStyle, textAlign: 'right' }}>{t('daybook.entries.due')}</th>
                    <th style={{ ...headStyle, textAlign: 'center' }}>{t('daybook.entries.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((e, i) => {
                    const due = Number(e.remaining_amount || 0);
                    return (
                      <tr key={e.id} id={`daybook-row-${e.id}`}>
                        <td style={{ ...cellStyle, color: '#94a3b8', fontSize: '0.8rem' }}>{i + 1}</td>
                        <td style={{ ...cellStyle, color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatStoredTime(e.created_at, isMarathi) || '—'}
                        </td>
                        <td style={{ ...cellStyle, fontWeight: 700, color: '#0f172a' }}>
                          {e.customer_name}
                          {e.customer_mobile && (
                            <span style={{ display: 'block', fontSize: '0.73rem', fontWeight: 400, color: '#94a3b8' }}>
                              {e.customer_mobile}
                            </span>
                          )}
                        </td>
                        <td style={{ ...cellStyle, color: '#334155' }}>{e.vegetable_name_snapshot}</td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>
                          {weight(e.weight)} {unitLabel(t, e.unit || 'kg')}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {rupees(e.rate)}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                          {rupees(e.final_amount)}
                        </td>
                        {/* What is still owed on this one entry. Zero shows greyed rather
                            than hidden, so a fully-paid row is visibly settled instead of
                            looking like a missing value. */}
                        <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: due > 0 ? 700 : 400, color: due > 0 ? '#b45309' : '#94a3b8' }}>
                          {rupees(due)}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                          <BilledBadge
                            billId={e.bill_id}
                            billNumber={e.bill_number}
                            id={`daybook-status-${e.id}`}
                            onOpenBill={openBillInArchive}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer totals repeat the KPI figures at full precision. The cards round to
                whole rupees to stay readable; a vendor reconciling against cash needs the
                paise, and needs them at the bottom of the column they are adding up. */}
            <div
              id="daybook-footer-totals"
              style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '2px solid #e2e8f0' }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{t('daybook.kpi.totalValue')}</div>
                <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>{rupees(summary.totalValue)}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{t('daybook.kpi.received')}</div>
                <strong style={{ fontSize: '1.05rem', color: '#15803d' }}>{rupees(summary.totalPaid)}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{t('daybook.kpi.outstanding')}</div>
                <strong style={{ fontSize: '1.05rem', color: '#b45309' }}>{rupees(summary.totalRemaining)}</strong>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
