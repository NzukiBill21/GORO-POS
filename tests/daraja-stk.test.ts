import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  billingCentsToDarajaKes,
  posAmountUnitsToDarajaKes,
  posCallbackAmountMatchesRecord,
  parseDarajaStkPushFailure,
} from '../server/lib/mpesaAmount.js';
import { clearMpesaOAuthCacheForTests, getDarajaOAuthToken } from '../server/lib/mpesaOAuthCache.js';
import { processPosStkCallback } from '../server/services/pos/posMpesaStkService.js';
import { prisma } from '../server/lib/prisma.js';

describe('Daraja amount normalization', () => {
  it('converts billing cents to whole KES for STK push', () => {
    expect(billingCentsToDarajaKes(24050)).toBe(241);
    expect(billingCentsToDarajaKes(24000)).toBe(240);
  });

  it('maps POS whole-KES units to Daraja Amount (1 KES sale → Amount 1, not 0)', () => {
    expect(posAmountUnitsToDarajaKes(1)).toBe(1);
    expect(posAmountUnitsToDarajaKes(60)).toBe(60);
  });

  it('matches POS callback KES to stored sale units', () => {
    expect(posCallbackAmountMatchesRecord(1, 1)).toBe(true);
    expect(posCallbackAmountMatchesRecord(60, 60)).toBe(true);
    expect(posCallbackAmountMatchesRecord(59, 60)).toBe(false);
  });

  it('classifies Daraja invalid amount rejection', () => {
    const f = parseDarajaStkPushFailure({
      errorCode: '400.002.02',
      errorMessage: 'Bad Request - Invalid Amount',
      requestId: 'abc',
    });
    expect(f.kind).toBe('invalid_amount');
    expect(f.message).toMatch(/Invalid Amount/i);
  });
});

describe('OAuth token cache', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearMpesaOAuthCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reuses token until near expiry', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ access_token: 'tok-a', expires_in: 3600 }),
      } as Response;
    });

    const t1 = await getDarajaOAuthToken('sandbox', 'key-a', 'secret');
    const t2 = await getDarajaOAuthToken('sandbox', 'key-a', 'secret');
    expect(t1).toBe('tok-a');
    expect(t2).toBe('tok-a');
    expect(calls).toBe(1);
  });
});

describe('STK callback amount mismatch (KES)', () => {
  it('rejects when provider KES does not match sale cents', async () => {
    const business = await prisma.business.findFirst();
    const branch = await prisma.branch.findFirst({ where: { businessId: business!.id } });
    const product = await prisma.product.findFirst({ where: { businessId: business!.id } });
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });

    const sale = await prisma.sale.create({
      data: {
        branchId: branch!.id,
        userId: user!.id,
        invoiceNumber: `TST-${Date.now()}`,
        subtotal: 10000,
        total: 10000,
        status: 'PENDING_PAYMENT',
        items: {
          create: [
            {
              productId: product!.id,
              name: product!.name,
              quantity: 1,
              unitPrice: 10000,
              total: 10000,
            },
          ],
        },
      },
    });

    const checkoutId = `KES-MISMATCH-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        saleId: sale.id,
        businessId: business!.id,
        method: 'MPESA_STK',
        amount: 10000,
        amountCents: 10000,
        status: 'PENDING',
        mpesaCheckoutRequestId: checkoutId,
      },
    });

    await prisma.posMpesaStkRecord.create({
      data: {
        businessId: business!.id,
        saleId: sale.id,
        paymentId: payment.id,
        checkoutRequestId: checkoutId,
        amountCents: 10000,
        phone: '254712345678',
        status: 'SENT',
      },
    });

    const result = await processPosStkCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: checkoutId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 999 },
              { Name: 'MpesaReceiptNumber', Value: 'BADKES1' },
            ],
          },
        },
      },
    });

    expect(result.rejected).toBe(true);
    const pay = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(pay?.status).toBe('FAILED');
  });
});
