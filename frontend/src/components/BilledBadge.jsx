/**
 * BilledBadge — whether one logged entry has been consolidated into a bill yet.
 *
 * An entry's `bill_id` is the single fact that decides this: NULL means the entry is still
 * waiting to be settled, non-NULL means it already belongs to a bill and generating another
 * one will not pick it up again. That distinction drives the vendor's whole settlement
 * workflow, and until now it was invisible in every table — so an entry that had already
 * been billed looked exactly like one that had not.
 *
 * Lives in its own file because more than one table needs it and they must agree. Two
 * hand-rolled versions of this badge would eventually disagree about what NULL means,
 * and the one that got it backwards would tell a vendor a debt was settled when it was not.
 *
 * `billNumber` is optional: not every query joins `bills`. With it, the badge names the bill
 * so the vendor can find it; without it, the badge still states the fact correctly.
 *
 * `onOpenBill` is optional too. Given one, the badge becomes a button that opens the bill —
 * the shortest path from "this entry is settled" to the sheet the customer was handed. It
 * stays one component rather than two so the reading of NULL can never fork; only whether
 * the result is clickable changes.
 *
 * The NULL reading itself lives in `utils/billDisplay.isBilled`, because the history
 * table needs the same answer to decide whether Delete is allowed.
 */

import { useTranslation } from '../hooks/useTranslation';
import { isBilled } from '../utils/billDisplay';

export default function BilledBadge({ billId, billNumber, id, onOpenBill }) {
  const { t } = useTranslation();
  const billed = isBilled(billId);

  const style = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '0.72rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    border: '1px solid',
  };

  if (!billed) {
    return (
      <span
        id={id}
        style={{ ...style, background: '#fffbeb', color: '#b45309', borderColor: '#fcd34d' }}
      >
        {t('daybook.status.pending')}
      </span>
    );
  }

  // The bill number replaces the word "Billed" rather than sitting beside it: the number
  // already implies the entry is billed, and the badge has to fit in a cell.
  const label = billNumber ? `✓ ${billNumber}` : `✓ ${t('daybook.status.billed')}`;
  const billedStyle = { ...style, background: '#f0fdf4', color: '#15803d', borderColor: '#86efac' };

  if (!onOpenBill) {
    return (
      <span id={id} title={t('daybook.status.billed')} style={billedStyle}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      id={id}
      onClick={() => onOpenBill(billId)}
      title={t('daybook.status.openBill')}
      style={{
        ...billedStyle,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '0.72rem',
        fontWeight: 700,
        // Underlined because a green pill on its own does not read as clickable, and a
        // vendor who does not know it opens the bill will never try it.
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: '2px',
      }}
    >
      {label}
    </button>
  );
}
