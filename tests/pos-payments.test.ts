import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import {
  validateManualMpesaCode,
  createPendingCheckout,
  payCash,
  payMpesaManual,
  paySplit,
  getSaleTotalCents,
  sumCompletedPaymentsCents,
} from '../server/services/pos/posCheckoutService.js';
import {
  processPosStkCallback,
  markStkTimeout,
  releaseUndispatchedStkHolds,
} from '../server/services/pos/posMpesaStkService.js';
import { assertMpesaMockAllowed } from '../server/lib/mpesaMockGuard.js';
import { ensureProductStockForPosTests } from './helpers/posTestStock.js';

const DEMO_BUSINESS_ID = 'demo-business';

describe('manual mpesa code validation', () => {
  it('accepts valid codes', () => {
    expect(validateManualMpesaCode('QGH7ABC12X')).toBe(true);
  });
  it('rejects short codes', () => {
    expect(validateManualMpesaCode('ABC')).toBe(false);
  });
});

describe('MPESA_MOCK production guard', () => {
  it('allows mock in non-production', () => {
    expect(() => assertMpesaMockAllowed()).not.toThrow();
  });
});

describe('POS payment flows', () => {
  let businessId: string;
  let branchId: string;
  let userId: string;
  let productId: string;

  beforeAll(async () => {
    const business = await prisma.business.findUnique({ where: { id: DEMO_BUSINESS_ID } });
    if (!business) throw new Error('Run db:seed — demo-business required for POS payment tests');
    const user = await prisma.user.findFirst({ where: { businessId: business.id } });
    const branch = await prisma.branch.findFirst({ where: { businessId: business.id } });
    const product = await prisma.product.findFirst({
      where: { businessId: business.id, name: { contains: 'Coca-Cola' } },
    });
    businessId = business.id;
    branchId = branch!.id;
    userId = user!.id;
    productId = product!.id;
    await ensureProductStockForPosTests({ businessId, branchId, productId });

    await prisma.tenantPosPaymentConfig.upsert({
      where: { businessId },
      create: { businessId, manualApprovalThresholdCents: 999999 },
      update: { manualApprovalThresholdCents: 999999 },
    });
  });

  it('rejects duplicate manual mpesa code per tenant', async () => {
    const { saleId } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });
    const code = `QGH${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
    await payMpesaManual({
      businessId,
      saleId,
      userId,
      transactionCode: code,
      senderPhone: '254712345678',
      amountCents: await getSaleTotalCents(saleId),
    });

    const { saleId: saleId2 } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    await expect(
      payMpesaManual({
        businessId,
        saleId: saleId2,
        userId,
        transactionCode: code,
        senderPhone: '254712345678',
        amountCents: await getSaleTotalCents(saleId2),
      })
    ).rejects.toThrow(/already used/);
  });

  it('rejects split that does not sum to total', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });
    await expect(
      paySplit({
        businessId,
        saleId,
        userId,
        lines: [{ method: 'CASH', amountCents: totalCents - 1, tenderedCents: totalCents - 1 }],
      })
    ).rejects.toThrow(/must equal sale total/);
  });

  it('ignores duplicate STK callback replay', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: totalCents,
        amountCents: totalCents,
        status: 'PENDING',
        mpesaCheckoutRequestId: `TEST-REPLAY-${Date.now()}`,
      },
    });

    await prisma.posMpesaStkRecord.create({
      data: {
        businessId,
        saleId,
        paymentId: payment.id,
        checkoutRequestId: payment.mpesaCheckoutRequestId!,
        amountCents: totalCents,
        phone: '254712345678',
        status: 'WAITING',
      },
    });

    const body = {
      Body: {
        stkCallback: {
          CheckoutRequestID: payment.mpesaCheckoutRequestId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: totalCents },
              { Name: 'MpesaReceiptNumber', Value: `RPL${Date.now()}` },
            ],
          },
        },
      },
    };

    const first = await processPosStkCallback(body);
    expect(first.processed).toBe(true);

    const second = await processPosStkCallback(body);
    expect(second.duplicate).toBe(true);
  });

  it('completes sale on late callback after STK timeout', async () => {
    const checkoutId = `TEST-LATE-${Date.now()}`;
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: totalCents,
        amountCents: totalCents,
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
        amountCents: totalCents,
        phone: '254712345678',
        status: 'WAITING',
      },
    });

    await markStkTimeout(payment.id, businessId);

    const body = {
      Body: {
        stkCallback: {
          CheckoutRequestID: checkoutId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: totalCents },
              { Name: 'MpesaReceiptNumber', Value: `LATE${Date.now()}` },
            ],
          },
        },
      },
    };

    const result = await processPosStkCallback(body);
    expect(result.lateCallback).toBe(true);
    expect(result.status).toBe('PAID');
    const paid = await sumCompletedPaymentsCents(saleId);
    expect(paid).toBe(totalCents);
  });

  it('allows cash after undispatched STK left a WAITING hold', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: totalCents,
        amountCents: totalCents,
        status: 'PENDING',
        mpesaCheckoutRequestId: `TEST-HOLD-${Date.now()}`,
      },
    });

    await prisma.posMpesaStkRecord.create({
      data: {
        businessId,
        saleId,
        paymentId: payment.id,
        checkoutRequestId: payment.mpesaCheckoutRequestId!,
        amountCents: totalCents,
        phone: '254712345678',
        status: 'WAITING',
      },
    });

    const result = await payCash({
      businessId,
      saleId,
      userId,
      amountCents: totalCents,
      tenderedCents: totalCents,
    });
    expect(result.saleStatus).toBe('COMPLETED');

    const released = await prisma.posMpesaStkRecord.findUnique({
      where: { checkoutRequestId: payment.mpesaCheckoutRequestId! },
    });
    expect(released?.status).toBe('FAILED');
  });

  it('releaseUndispatchedStkHolds clears WAITING without affecting SENT', async () => {
    const checkoutId = `TEST-SENT-${Date.now()}`;
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: totalCents,
        amountCents: totalCents,
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
        amountCents: totalCents,
        phone: '254712345678',
        status: 'SENT',
      },
    });

    await releaseUndispatchedStkHolds(saleId, businessId);
    const rec = await prisma.posMpesaStkRecord.findUnique({ where: { checkoutRequestId: checkoutId } });
    expect(rec?.status).toBe('SENT');
  });

  it('rejects wrong callback amount', async () => {
    const checkoutId = `TEST-WRONG-${Date.now()}`;
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });

    const payment = await prisma.payment.create({
      data: {
        saleId,
        businessId,
        method: 'MPESA_STK',
        amount: totalCents,
        amountCents: totalCents,
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
        amountCents: totalCents,
        phone: '254712345678',
        status: 'WAITING',
      },
    });

    const result = await processPosStkCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: checkoutId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: totalCents + 1 },
              { Name: 'MpesaReceiptNumber', Value: 'WRONGAMT1' },
            ],
          },
        },
      },
    });

    expect(result.rejected).toBe(true);
    const paid = await sumCompletedPaymentsCents(saleId);
    expect(paid).toBe(0);
  });
});
