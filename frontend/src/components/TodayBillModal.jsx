/**
 * TodayBillModal Component
 * Reuses the authentic, unified BillTemplate and ReceiptPrint layout
 * ensuring identical presentation across customer bills and the invoice module.
 */

import ReceiptPrint from './ReceiptPrint';

export default function TodayBillModal({ isOpen, onClose, bill, onEdit }) {
  return <ReceiptPrint isOpen={isOpen} onClose={onClose} bill={bill} onEdit={onEdit} />;
}
