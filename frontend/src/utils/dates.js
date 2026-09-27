/**
 * Local calendar-date helpers.
 *
 * Every date the backend stores in `transaction_date` / `bills.date` is a bare
 * `YYYY-MM-DD` day, not an instant. Converting between that and a JS Date has exactly
 * two traps, and both bite silently:
 *
 *  1. `d.toISOString().slice(0, 10)` converts to UTC first, so any evening in India
 *     (UTC+5:30) reports tomorrow's date. A sale logged at 9 PM would land on the wrong
 *     day and vanish from the vendor's day book.
 *  2. `new Date('2026-08-14')` *parses* a bare date as UTC midnight, so west of
 *     Greenwich it reads back as the 13th.
 *
 * So: build strings from local parts, and parse strings by splitting the parts. These
 * live here rather than in a hook because the day book, the history filter and the
 * settlements panel all need them, and three private copies is how the two bugs above
 * get reintroduced one file at a time.
 */

/** Today (or any Date) as the `YYYY-MM-DD` the backend stores. Local, never UTC. */
export function getLocalDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Yesterday as `YYYY-MM-DD`. */
export function getYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

/** First day of current week (Monday) as `YYYY-MM-DD`. */
export function getStartOfWeekDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return getLocalDateString(d);
}

/** First day of current month as `YYYY-MM-DD`. */
export function getStartOfMonthDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** `days` before today as `YYYY-MM-DD`. */
export function getDaysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return getLocalDateString(d);
}

/**
 * A `YYYY-MM-DD` string as a Date at *local* midnight, or null if unparseable.
 *
 * `setDate` handles month and year rollover, so callers can step days without
 * special-casing the 1st or the 31st.
 */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Steps a `YYYY-MM-DD` string by whole days, forwards or backwards.
 *
 * Returns the input unchanged if it cannot be parsed, so a bad value cannot turn the
 * date navigator into `NaN-NaN-NaN` and leave the vendor stuck on a blank screen.
 */
export function shiftDateString(dateStr, deltaDays) {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + deltaDays);
  return getLocalDateString(d);
}

/**
 * Whole days between a `YYYY-MM-DD` string and today, both at local midnight.
 * Positive means in the past. Null if unparseable.
 */
export function daysSince(dateStr) {
  const then = parseLocalDate(dateStr);
  if (!then) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86400000);
}

/**
 * A stored `created_at` as the clock time the vendor saw when they logged the entry.
 *
 * `created_at` comes from the column default `CURRENT_TIMESTAMP`, and SQLite writes that
 * in **UTC** as `YYYY-MM-DD HH:MM:SS` with no zone marker. JS reads that bare format as
 * *local* time, so passing it straight to `new Date` shows every Indian entry 5 hours 30
 * minutes early — a sale logged at 6:42 PM would print as 1:12 PM. Wrong in a way nobody
 * would question, because 1:12 PM is a perfectly believable time to sell vegetables.
 *
 * So the `Z` is appended explicitly and the browser converts back to local for display.
 * Returns '' for anything unparseable rather than 'Invalid Date'.
 */
export function formatStoredTime(stored, isMarathi) {
  if (!stored) return '';
  const raw = String(stored).trim();
  // Already zoned (ISO with Z or ±hh:mm)? Then trust it as-is.
  const isZoned = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const parsed = new Date(isZoned ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(isMarathi ? 'mr-IN' : 'en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Formats any YYYY-MM-DD string, ISO timestamp, or Date into strict DD/MM/YYYY format. */
export function formatDDMMYYYY(dateStr) {
  if (!dateStr) return '';
  if (dateStr instanceof Date) {
    const day = String(dateStr.getDate()).padStart(2, '0');
    const month = String(dateStr.getMonth() + 1).padStart(2, '0');
    const year = dateStr.getFullYear();
    return `${day}/${month}/${year}`;
  }
  // Strip out any time component, whether preceded by 'T' (ISO) or ' ' (SQL/human)
  const str = String(dateStr).trim().split(/[ T]/)[0];
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    return str;
  }
  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(str)) {
    const [d, m, y] = str.split('-');
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }
  // YYYY-MM-DD or YYYY/MM/DD
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const [y, m, d] = parts;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    if (parts[2].length === 4) {
      const [d, m, y] = parts;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }
  return dateStr;
}

/** Parses a DD/MM/YYYY or DD-MM-YYYY string into backend standard YYYY-MM-DD. */
export function parseDDMMYYYY(str) {
  if (!str) return '';
  const clean = String(str).trim();
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const m = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    const year = m[3];
    return `${year}-${month}-${day}`;
  }
  return '';
}

/** Checks if a string is a valid DD/MM/YYYY date. */
export function isValidDDMMYYYY(str) {
  if (!str) return false;
  const iso = parseDDMMYYYY(str);
  if (!iso) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const parsed = new Date(y, m - 1, d);
  return (
    parsed.getFullYear() === y &&
    parsed.getMonth() === m - 1 &&
    parsed.getDate() === d
  );
}
