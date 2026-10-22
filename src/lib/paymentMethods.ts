/** Human-readable POS / sale payment method labels (Kenya retail). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MPESA_STK: 'M-Pesa STK',
  MPESA_MANUAL: 'M-Pesa (manual code)',
  MPESA: 'M-Pesa',
  SPLIT: 'Split payment',
  GIFT_CARD: 'Gift card',
  BANK: 'Bank transfer',
};

export function formatPaymentMethod(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method.replace(/_/g, ' ');
}
