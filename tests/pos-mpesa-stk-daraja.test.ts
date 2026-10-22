import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import {
  initiatePosStkPush,
  assertNoInFlightStk,
} from '../server/services/pos/posMpesaStkService.js';
import { AppError } from '../server/lib/errors.js';
import { requirePosStkDarajaKes } from '../server/lib/posStkAmount.js';
import { validateStkCallbackUrlForLiveStk } from '../server/lib/mpesaDarajaConfig.js';
import { clearMpesaOAuthCacheForTests } from '../server/lib/mpesaOAuthCache.js';

describe('POS STK Daraja integration', () => {
  const originalFetch = global.fetch;
  let businessId: string;
  let saleId: string;
  let userId: string;

  beforeEach(async () => {
    const business = await prisma.business.findFirst();
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });
    const branch = await prisma.branch.findFirst({ where: { businessId: business!.id } });
    const product = await prisma.product.findFirst({ where: { businessId: business!.id } });
    businessId = business!.id;
    userId = user!.id;

    const sale = await prisma.sale.create({
      data: {
        branchId: branch!.id,
        userId,
        invoiceNumber: `STK-UT-${Date.now()}`,
        subtotal: 1,
        total: 1,
        status: 'PENDING_PAYMENT',
        items: {
          create: [
            {
              productId: product!.id,
              name: product!.name,
              quantity: 1,
              unitPrice: 1,
              total: 1,
            },
          ],
        },
      },
    });
    saleId = sale.id;
    clearMpesaOAuthCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('rejects sub-1 KES POS amounts before Daraja', () => {
    expect(() => requirePosStkDarajaKes(0)).toThrow(AppError);
    try {
      requirePosStkDarajaKes(0);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(400);
    }
  });

  it('rejects localhost callback for live STK', () => {
    expect(() =>
      validateStkCallbackUrlForLiveStk('http://127.0.0.1:3001/api/pos/webhooks/mpesa/stk')
    ).toThrow(/HTTPS|callback/i);
  });

  it('sends Daraja Amount equal to POS whole-KES units', async () => {
    vi.stubEnv('MPESA_MOCK', 'false');
    vi.stubEnv('MPESA_CONSUMER_KEY', 'unit-test-key');
    vi.stubEnv('MPESA_CONSUMER_SECRET', 'unit-test-secret');
    vi.stubEnv('MPESA_PASSKEY', 'unit-test-passkey');
    vi.stubEnv('MPESA_SHORTCODE', '174379');
    vi.stubEnv('MPESA_POS_CALLBACK_URL', 'https://tunnel.example/api/pos/webhooks/mpesa/stk');
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/oauth/v1/generate')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as Response;
      }
      if (u.includes('/stkpush/v1/processrequest')) {
        capturedBody = JSON.parse(String(init?.body));
        return {
          ok: true,
          json: async () => ({
            ResponseCode: '0',
            CustomerMessage: 'Success. Request accepted for processing',
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: 1,
        amountCents: 1,
        status: 'PENDING',
      },
    });

    const result = await initiatePosStkPush({
      businessId,
      saleId,
      paymentId: payment.id,
      phone: '0714455735',
      amountCents: 1,
      accountReference: 'INV1',
      userId,
    });

    expect(result.status).toBe('SENT');
    expect(capturedBody?.Amount).toBe(1);

    const rec = await prisma.posMpesaStkRecord.findFirst({ where: { paymentId: payment.id } });
    expect(rec?.status).toBe('SENT');
  });

  it('surfaces provider rejection without duplicate in-flight STK', async () => {
    vi.stubEnv('MPESA_MOCK', 'false');
    vi.stubEnv('MPESA_CONSUMER_KEY', 'unit-test-key');
    vi.stubEnv('MPESA_CONSUMER_SECRET', 'unit-test-secret');
    vi.stubEnv('MPESA_PASSKEY', 'unit-test-passkey');
    vi.stubEnv('MPESA_SHORTCODE', '174379');
    vi.stubEnv('MPESA_POS_CALLBACK_URL', 'https://tunnel.example/api/pos/webhooks/mpesa/stk');
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/oauth/v1/generate')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          requestId: 'req-fail',
          errorCode: '400.002.02',
          errorMessage: 'Bad Request - Invalid Amount',
        }),
      } as Response;
    }) as typeof fetch;

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: 1,
        amountCents: 1,
        status: 'PENDING',
      },
    });

    await expect(
      initiatePosStkPush({
        businessId,
        saleId,
        paymentId: payment.id,
        phone: '0714455735',
        amountCents: 1,
        accountReference: 'INV1',
        userId,
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const failed = await prisma.posMpesaStkRecord.findFirst({ where: { paymentId: payment.id } });
    expect(failed?.status).toBe('FAILED');

    await expect(assertNoInFlightStk(saleId, businessId)).resolves.toBeUndefined();
  });

  it('returns uncertain-outcome message on network failure', async () => {
    vi.stubEnv('MPESA_MOCK', 'false');
    vi.stubEnv('MPESA_CONSUMER_KEY', 'unit-test-key');
    vi.stubEnv('MPESA_CONSUMER_SECRET', 'unit-test-secret');
    vi.stubEnv('MPESA_PASSKEY', 'unit-test-passkey');
    vi.stubEnv('MPESA_SHORTCODE', '174379');
    vi.stubEnv('MPESA_POS_CALLBACK_URL', 'https://tunnel.example/api/pos/webhooks/mpesa/stk');

    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/oauth/v1/generate')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) } as Response;
      }
      throw new Error('ECONNRESET');
    }) as typeof fetch;

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: 1,
        amountCents: 1,
        status: 'PENDING',
      },
    });

    await expect(
      initiatePosStkPush({
        businessId,
        saleId,
        paymentId: payment.id,
        phone: '0714455735',
        amountCents: 1,
        accountReference: 'INV1',
        userId,
      })
    ).rejects.toThrow(/Could not reach M-Pesa/i);

    await expect(assertNoInFlightStk(saleId, businessId)).resolves.toBeUndefined();
  });

  it('blocks second STK while SENT is in progress', async () => {
    vi.stubEnv('MPESA_MOCK', 'true');
    const checkoutId = `in-flight-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: 1,
        amountCents: 1,
        status: 'PENDING',
        mpesaCheckoutRequestId: checkoutId,
      },
    });
    await prisma.posMpesaStkRecord.create({
      data: {
        businessId,
        saleId,
        paymentId: payment.id,
        checkoutRequestId: checkoutId,
        amountCents: 1,
        phone: '254712345678',
        status: 'SENT',
      },
    });

    await expect(assertNoInFlightStk(saleId, businessId)).rejects.toMatchObject({ statusCode: 409 });
  });
});
