/** Payment provider abstraction for subscription billing (not POS payments). */

export interface InitiatePaymentInput {
  paymentId: string;
  amountCents: number;
  currency: string;
  phoneNumber: string;
  accountReference: string;
  description: string;
}

export interface InitiatePaymentResult {
  provider: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  customerMessage: string;
  mock?: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  initiateStkPush(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}

export function normalizeKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export function isValidKenyanPhone(phone: string): boolean {
  const normalized = normalizeKenyanPhone(phone);
  return /^2547\d{8}$/.test(normalized);
}
