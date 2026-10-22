import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { isValidKenyanPhone, normalizeKenyanPhone } from '../payment/types.js';
import { isPosMpesaMockMode } from '../../lib/mpesaMockGuard.js';
import { completeSaleIfFullyPaid, getSaleTotalCents, sumCompletedPaymentsCents } from './posCheckoutService.js';
import { writeAuditLog } from '../../lib/audit.js';
import {
  resolveMpesaEnv,
  resolveDarajaBaseUrl,
  resolvePosMpesaCredentials,
  validateStkCallbackUrlForLiveStk,
} from '../../lib/mpesaDarajaConfig.js';
import { getDarajaOAuthToken } from '../../lib/mpesaOAuthCache.js';
import {
  parseDarajaStkPushFailure,
  posAmountUnitsToDarajaKes,
  posCallbackAmountMatchesRecord,
} from '../../lib/mpesaAmount.js';
import { requirePosStkDarajaKes } from '../../lib/posStkAmount.js';

function mpesaTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function mpesaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** Fail fast before reserving sale balance when live Daraja STK cannot run. */
export async function assertLiveStkPreconditions(businessId: string) {
  const creds = await resolvePosMpesaCredentials(businessId);
  const mock = isPosMpesaMockMode() || !creds?.consumerKey;
  if (!mock && creds) {
    validateStkCallbackUrlForLiveStk(creds.callbackUrl);
  }
}

/** Customer may be approving a push — do not start another STK for this sale. */
const BLOCKING_STK = ['SENT'] as const;

/** STK never left the server (config/validation/network before Daraja accepted) — safe to clear. */
export async function releaseUndispatchedStkHolds(saleId: string, businessId: string, reason?: string) {
  const waiting = await prisma.posMpesaStkRecord.findMany({
    where: { saleId, businessId, status: 'WAITING' },
  });
  for (const rec of waiting) {
    await failStkAttempt(
      rec.paymentId,
      rec.checkoutRequestId,
      reason ?? 'M-Pesa STK was not sent — try again or use another payment method',
      { releaseUndispatched: true }
    );
  }
}

export async function assertNoInFlightStk(
  saleId: string,
  businessId: string,
  actorUserId?: string
) {
  await refreshWaitingStkFromDaraja(saleId, businessId, actorUserId);
  await releaseUndispatchedStkHolds(saleId, businessId);

  const open = await prisma.posMpesaStkRecord.findFirst({
    where: { saleId, businessId, status: { in: [...BLOCKING_STK] } },
  });
  if (open) {
    throw new AppError('An M-Pesa payment is already in progress for this sale', 409);
  }
}

export async function initiatePosStkPush(params: {
  businessId: string;
  saleId: string;
  paymentId: string;
  phone: string;
  amountCents: number;
  accountReference: string;
  userId: string;
}) {
  if (!isValidKenyanPhone(params.phone)) {
    throw new AppError('Invalid M-Pesa phone number', 400);
  }
  const amountKes = requirePosStkDarajaKes(params.amountCents);
  const phone = normalizeKenyanPhone(params.phone);
  const creds = await resolvePosMpesaCredentials(params.businessId);
  const mock = isPosMpesaMockMode() || !creds?.consumerKey;

  if (!mock && creds) {
    validateStkCallbackUrlForLiveStk(creds.callbackUrl);
  }

  const checkoutRequestId = mock
    ? `POS-MOCK-${params.paymentId}-${Date.now()}`
    : crypto.randomUUID().replace(/-/g, '').slice(0, 20);

  await prisma.posMpesaStkRecord.create({
    data: {
      businessId: params.businessId,
      saleId: params.saleId,
      paymentId: params.paymentId,
      checkoutRequestId,
      amountCents: params.amountCents,
      phone,
      status: 'WAITING',
    },
  });

  await prisma.payment.update({
    where: { id: params.paymentId },
    data: {
      mpesaPhone: phone,
      mpesaCheckoutRequestId: checkoutRequestId,
      status: 'PENDING',
    },
  });

  if (!mock && creds) {
    const env = resolveMpesaEnv();
    const baseUrl = resolveDarajaBaseUrl(env);
    try {
      const token = await getDarajaOAuthToken(env, creds.consumerKey, creds.consumerSecret);
      const timestamp = mpesaTimestamp();
      const shortcode = creds.shortcode || creds.till;
      const password = mpesaPassword(shortcode, creds.passkey, timestamp);
      const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: amountKes,
          PartyA: phone,
          PartyB: shortcode,
          PhoneNumber: phone,
          CallBackURL: creds.callbackUrl,
          AccountReference: params.accountReference.slice(0, 12),
          TransactionDesc: 'POS Sale',
        }),
      });
      const body = (await res.json()) as {
        ResponseCode?: string;
        CheckoutRequestID?: string;
        MerchantRequestID?: string;
        CustomerMessage?: string;
        errorCode?: string;
        errorMessage?: string;
        requestId?: string;
      };
      const darajaCheckoutId = body.CheckoutRequestID;
      if (darajaCheckoutId && darajaCheckoutId !== checkoutRequestId) {
        await prisma.posMpesaStkRecord.update({
          where: { checkoutRequestId },
          data: { checkoutRequestId: darajaCheckoutId },
        });
        await prisma.payment.update({
          where: { id: params.paymentId },
          data: { mpesaCheckoutRequestId: darajaCheckoutId },
        });
      }
      if (!res.ok || body.ResponseCode !== '0') {
        const failure = parseDarajaStkPushFailure(body);
        console.warn('[pos-mpesa-stk] Daraja STK push rejected', {
          saleId: params.saleId,
          paymentId: params.paymentId,
          httpStatus: res.status,
          darajaAmountKes: amountKes,
          posAmountUnits: params.amountCents,
          errorCode: body.errorCode,
          requestId: body.requestId,
          kind: failure.kind,
        });
        await failStkAttempt(
          params.paymentId,
          darajaCheckoutId ?? checkoutRequestId,
          failure.message,
          body
        );
        const status = failure.kind === 'invalid_amount' ? 400 : 502;
        throw new AppError(failure.message, status);
      }
      await prisma.posMpesaStkRecord.updateMany({
        where: { paymentId: params.paymentId },
        data: { status: 'SENT' },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[pos-mpesa-stk] STK network or unexpected error', {
        saleId: params.saleId,
        paymentId: params.paymentId,
        error: err instanceof Error ? err.message : String(err),
      });
      await failStkAttempt(params.paymentId, checkoutRequestId, 'STK network or provider error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        'Could not reach M-Pesa. Check your connection and try again; if the customer already approved, wait for confirmation or use STK status.',
        502
      );
    }
  } else {
    schedulePosMockCallback(params.paymentId, checkoutRequestId, params.amountCents, params.businessId, params.userId);
  }

  const finalRecord = await prisma.posMpesaStkRecord.findFirst({
    where: { paymentId: params.paymentId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    checkoutRequestId: finalRecord?.checkoutRequestId ?? checkoutRequestId,
    status: finalRecord?.status ?? 'WAITING',
    mock,
  };
}

async function failStkAttempt(
  paymentId: string,
  checkoutRequestId: string,
  notes: string,
  raw: unknown
) {
  await prisma.posMpesaStkRecord.updateMany({
    where: { paymentId, checkoutRequestId },
    data: { status: 'FAILED', rawPayload: JSON.stringify(raw) },
  });
  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'FAILED', notes },
  });
}

function schedulePosMockCallback(
  paymentId: string,
  checkoutRequestId: string,
  amountCents: number,
  businessId: string,
  userId: string
) {
  const delayMs = parseInt(process.env.MPESA_MOCK_DELAY_MS ?? '3000', 10);
  const amountKes = posAmountUnitsToDarajaKes(amountCents);
  setTimeout(() => {
    void processPosStkCallback(
      {
        Body: {
          stkCallback: {
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: amountKes },
                { Name: 'MpesaReceiptNumber', Value: `MOCK${Date.now()}` },
              ],
            },
          },
        },
      },
      businessId,
      userId
    ).catch(console.error);
  }, delayMs);
}

/** Verified STK callback — idempotent, amount check, late callback after TIMEOUT */
export async function processPosStkCallback(
  rawBody: {
    Body?: {
      stkCallback?: {
        CheckoutRequestID?: string;
        ResultCode?: number;
        ResultDesc?: string;
        CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
      };
    };
  },
  _businessIdHint?: string,
  actorUserId?: string
) {
  const cb = rawBody.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return { processed: false, reason: 'missing_checkout_id' };

  const record = await prisma.posMpesaStkRecord.findUnique({
    where: { checkoutRequestId: cb.CheckoutRequestID },
  });
  if (!record) return { processed: false, reason: 'unknown_checkout' };

  const payment = await prisma.payment.findUnique({ where: { id: record.paymentId } });
  if (payment?.status === 'COMPLETED') {
    return { duplicate: true, processed: false };
  }

  const wasLateAfterTimeout = record.status === 'TIMEOUT';

  const receiptItem = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber');
  const amountItem = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'Amount');
  const providerTxId = receiptItem?.Value != null ? String(receiptItem.Value) : `MPESA-${cb.CheckoutRequestID}`;

  if (providerTxId) {
    const dup = await prisma.posMpesaStkRecord.findFirst({
      where: { providerTransactionId: providerTxId, NOT: { id: record.id } },
    });
    if (dup) return { duplicate: true, processed: false };
  }

  const success = cb.ResultCode === 0;
  const callbackKes =
    amountItem?.Value != null ? Math.round(Number(amountItem.Value)) : posAmountUnitsToDarajaKes(record.amountCents);

  if (success && !posCallbackAmountMatchesRecord(callbackKes, record.amountCents)) {
    await prisma.payment.update({
      where: { id: record.paymentId },
      data: { status: 'FAILED', notes: 'Amount mismatch on callback' },
    });
    await prisma.posMpesaStkRecord.update({
      where: { id: record.id },
      data: { status: 'FAILED', rawPayload: JSON.stringify(rawBody) },
    });
    return { processed: true, rejected: true, reason: 'amount_mismatch' };
  }

  if (record.providerTransactionId && record.status === 'PAID') {
    return { duplicate: true, processed: false };
  }

  if (!success) {
    const cancelled = cb.ResultCode === 1032;
    await prisma.posMpesaStkRecord.update({
      where: { id: record.id },
      data: {
        status: cancelled ? 'CANCELLED' : 'FAILED',
        rawPayload: JSON.stringify(rawBody),
      },
    });
    await prisma.payment.update({
      where: { id: record.paymentId },
      data: { status: cancelled ? 'CANCELLED' : 'FAILED', notes: cb.ResultDesc },
    });
    return { processed: true, status: cancelled ? 'CANCELLED' : 'FAILED' };
  }

  await prisma.posMpesaStkRecord.update({
    where: { id: record.id },
    data: {
      status: 'PAID',
      providerTransactionId: providerTxId,
      rawPayload: JSON.stringify(rawBody),
    },
  });

  await prisma.payment.update({
    where: { id: record.paymentId },
    data: {
      status: 'COMPLETED',
      verificationStatus: 'VERIFIED',
      mpesaReceiptNumber: providerTxId,
      amount: record.amountCents,
      amountCents: record.amountCents,
    },
  });

  const sale = await completeSaleIfFullyPaid(record.saleId, record.businessId, actorUserId);

  await writeAuditLog(
    { action: 'POS_MPESA_STK_PAID', module: 'POS', entityId: record.paymentId, details: providerTxId },
    { userId: actorUserId }
  );

  return {
    processed: true,
    status: 'PAID',
    saleCompleted: sale?.status === 'COMPLETED',
    lateCallback: wasLateAfterTimeout,
  };
}

export async function markStkTimeout(paymentId: string, businessId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, businessId } });
  if (!payment?.mpesaCheckoutRequestId) return;
  await prisma.posMpesaStkRecord.updateMany({
    where: { paymentId, status: { in: ['WAITING', 'SENT'] } },
    data: { status: 'TIMEOUT' },
  });
  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'TIMEOUT' },
  });
}

async function applyStkQueryResult(
  rec: { checkoutRequestId: string },
  body: {
    ResultCode?: string | number;
    ResultDesc?: string;
    CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
  },
  businessId: string,
  actorUserId?: string
) {
  const code = Number(body.ResultCode);
  if (code === 0) {
    await processPosStkCallback(
      {
        Body: {
          stkCallback: {
            CheckoutRequestID: rec.checkoutRequestId,
            ResultCode: 0,
            CallbackMetadata: body.CallbackMetadata,
          },
        },
      },
      businessId,
      actorUserId
    );
    return;
  }
  if (code === 1032) {
    await processPosStkCallback(
      {
        Body: {
          stkCallback: {
            CheckoutRequestID: rec.checkoutRequestId,
            ResultCode: 1032,
            ResultDesc: body.ResultDesc ?? 'Cancelled',
          },
        },
      },
      businessId,
      actorUserId
    );
    return;
  }
  if (code === 1037 || code === 4999) {
    return;
  }
}

/** Poll Safaricom STK Query for in-flight records before returning local status. */
export async function refreshWaitingStkFromDaraja(saleId: string, businessId: string, actorUserId?: string) {
  const waiting = await prisma.posMpesaStkRecord.findMany({
    where: { saleId, businessId, status: { in: ['WAITING', 'SENT'] } },
    take: 3,
  });
  if (waiting.length === 0 || isPosMpesaMockMode()) return;

  const creds = await resolvePosMpesaCredentials(businessId);
  if (!creds?.consumerKey) return;

  const env = resolveMpesaEnv();
  const baseUrl = resolveDarajaBaseUrl(env);
  const token = await getDarajaOAuthToken(env, creds.consumerKey, creds.consumerSecret);
  const shortcode = creds.shortcode || creds.till;

  for (const rec of waiting) {
    try {
      const timestamp = mpesaTimestamp();
      const password = mpesaPassword(shortcode, creds.passkey, timestamp);
      const res = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: rec.checkoutRequestId,
        }),
      });
      const body = (await res.json()) as {
        ResultCode?: string | number;
        ResultDesc?: string;
        CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
      };
      await applyStkQueryResult(rec, body, businessId, actorUserId);
    } catch {
      // network blip — keep polling on next client tick
    }
  }
}

export async function getStkStatus(saleId: string, businessId: string, actorUserId?: string) {
  await refreshWaitingStkFromDaraja(saleId, businessId, actorUserId);
  const records = await prisma.posMpesaStkRecord.findMany({
    where: { saleId, businessId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const paidCents = await sumCompletedPaymentsCents(saleId);
  const totalCents = await getSaleTotalCents(saleId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, branch: { businessId } },
    select: { status: true },
  });
  return {
    records,
    paidCents,
    totalCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    saleStatus: sale?.status ?? null,
  };
}
