/**
 * Billing/subscription amounts use true fractional cents (100 = 1 KES).
 * POS checkout stores whole KES in fields named *Cents (see posPricingService.toCents).
 */

/** Billing: integer cents → Daraja whole KES. */
export function billingCentsToDarajaKes(amountCents: number): number {
  return Math.round(amountCents / 100);
}

/** @deprecated Use billingCentsToDarajaKes or posAmountUnitsToDarajaKes explicitly. */
export function centsToDarajaKes(amountCents: number): number {
  return billingCentsToDarajaKes(amountCents);
}

/** POS sale/payment units (whole KES) → Daraja STK Amount. */
export function posAmountUnitsToDarajaKes(posAmountUnits: number): number {
  return Math.max(0, Math.round(posAmountUnits));
}

export function assertPosStkDarajaAmount(posAmountUnits: number): number {
  const kes = posAmountUnitsToDarajaKes(posAmountUnits);
  if (kes < 1) {
    throw new Error('POS_STK_AMOUNT_TOO_LOW');
  }
  return kes;
}

/** Callback metadata Amount from Safaricom is whole KES. */
export function darajaKesToBillingCents(kes: number): number {
  return Math.round(kes) * 100;
}

/** @deprecated Use darajaKesToBillingCents. */
export function darajaKesToCents(kes: number): number {
  return darajaKesToBillingCents(kes);
}

export function posCallbackAmountMatchesRecord(callbackKes: number, posAmountUnits: number): boolean {
  return Math.round(callbackKes) === Math.round(posAmountUnits);
}

/** @deprecated Use posCallbackAmountMatchesRecord for POS STK. */
export function callbackAmountMatchesRecord(callbackKes: number, recordAmountCents: number): boolean {
  return posCallbackAmountMatchesRecord(callbackKes, recordAmountCents);
}

export type DarajaStkFailureKind = 'provider_rejection' | 'provider_error' | 'invalid_amount';

export function parseDarajaStkPushFailure(body: {
  ResponseCode?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
}): { kind: DarajaStkFailureKind; message: string } {
  const msg =
    (typeof body.errorMessage === 'string' && body.errorMessage.trim()) ||
    (typeof body.CustomerMessage === 'string' && body.CustomerMessage.trim()) ||
    'M-Pesa STK request failed';

  if (/invalid amount/i.test(msg) || body.errorCode === '400.002.02') {
    return { kind: 'invalid_amount', message: msg };
  }
  if (body.errorCode || body.errorMessage) {
    return { kind: 'provider_rejection', message: msg };
  }
  return { kind: 'provider_error', message: msg };
}
