/**
 * Billing Calculation Utility
 * Handles billing mathematics and validation parameters.
 */
function calculateBill({ 
  items = [], 
  discount_type = 'fixed', 
  discount_value = 0, 
  paid_amount = 0, 
  commission_rate = 8.0,
  hamali_amount = 0,
  transport_amount = 0
}) {
  // 1. Calculate subtotal (each item total = quantity * rate)
  const subtotal = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.rate) || 0;
    const itemTotal = Number((qty * rate).toFixed(2));
    item.total = itemTotal; // Assign item total
    return sum + itemTotal;
  }, 0);

  // 2. Calculate discount amount
  let discount_amount = 0;
  const val = Number(discount_value) || 0;
  if (discount_type === 'percentage') {
    discount_amount = Number(((subtotal * val) / 100).toFixed(2));
  } else {
    // fixed
    discount_amount = Number(val.toFixed(2));
  }

  // Ensure discount doesn't exceed subtotal
  if (discount_amount > subtotal) {
    discount_amount = subtotal;
  }

  const amount_after_discount = Number((subtotal - discount_amount).toFixed(2));

  // 3. Commission calculation
  const comRate = Number(commission_rate);
  const rate = isNaN(comRate) ? 8.0 : comRate;
  const commission_amount = Number((amount_after_discount * (rate / 100)).toFixed(2));

  // 4. Added Expenses (Hamali and Transport)
  const hamali = Number(hamali_amount) || 0;
  const transport = Number(transport_amount) || 0;

  // 5. Final Amount (Subtotal - Discount + Commission + Hamali + Transport)
  const final_amount = Number((amount_after_discount + commission_amount + hamali + transport).toFixed(2));

  // 6. Remaining Amount
  const paid = Number(paid_amount) || 0;
  const remaining_amount = Number((final_amount - paid).toFixed(2));

  // 6. Payment Status auto-determination
  // paid_amount >= final_amount -> Paid
  // paid_amount == 0 -> Credit
  // paid_amount > 0 and less than final_amount -> Partial
  let payment_status = 'Credit';
  if (paid >= final_amount) {
    payment_status = 'Paid';
  } else if (paid > 0 && paid < final_amount) {
    payment_status = 'Partial';
  } else {
    payment_status = 'Credit';
  }

  return {
    subtotal: Number(subtotal.toFixed(2)),
    discount_type,
    discount_value: val,
    discount_amount: Number(discount_amount.toFixed(2)),
    commission_rate: rate,
    commission_amount: Number(commission_amount.toFixed(2)),
    hamali_amount: hamali,
    transport_amount: transport,
    final_amount: Number(final_amount.toFixed(2)),
    paid_amount: Number(paid.toFixed(2)),
    remaining_amount: Number(remaining_amount.toFixed(2)),
    payment_status,
    items
  };
}

module.exports = { calculateBill };
