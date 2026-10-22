import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import {
  createPendingCheckout,
  payCash,
} from '../server/services/pos/posCheckoutService.js';
import { resolveBranchIdForBusiness } from '../server/lib/branchContext.js';
import { cashChangeCentsFromPayments } from '../server/lib/posCash.js';
import { assertNoInFlightStk } from '../server/services/pos/posMpesaStkService.js';
import { AppError } from '../server/lib/errors.js';
import { resolveStkCallbackUrl } from '../server/lib/mpesaDarajaConfig.js';
import { ensureProductStockForPosTests } from './helpers/posTestStock.js';

const DEMO_BUSINESS_ID = 'demo-business';

describe('POS checkout regression', () => {
  let businessId: string;
  let branchId: string;
  let userId: string;
  let productId: string;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeAll(async () => {
    const business = await prisma.business.findUnique({ where: { id: DEMO_BUSINESS_ID } });
    if (!business) throw new Error('Run db:seed — demo-business required for POS regression tests');
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
  });

  it('prefers MPESA_POS_CALLBACK_URL over tenant loopback callback', async () => {
    const prev = process.env.MPESA_POS_CALLBACK_URL;
    process.env.MPESA_POS_CALLBACK_URL = 'https://tunnel.example/api/pos/webhooks/mpesa/stk';
    const url = await resolveStkCallbackUrl(businessId, 'http://127.0.0.1:3001/api/pos/webhooks/mpesa/stk');
    expect(url).toBe('https://tunnel.example/api/pos/webhooks/mpesa/stk');
    if (prev === undefined) delete process.env.MPESA_POS_CALLBACK_URL;
    else process.env.MPESA_POS_CALLBACK_URL = prev;
  });

  it('resolves default branch for business', async () => {
    const id = await resolveBranchIdForBusiness(businessId);
    expect(id).toBeTruthy();
  });

  it('rejects checkout without branchId', async () => {
    await expect(
      createPendingCheckout({
        businessId,
        branchId: '',
        userId,
        items: [{ productId, quantity: 1 }],
      })
    ).rejects.toThrow(/branch/i);
  });

  it('cash exact payment completes with zero change', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });
    const result = await payCash({
      businessId,
      saleId,
      userId,
      amountCents: totalCents,
      tenderedCents: totalCents,
    });
    expect(result.changeCents).toBe(0);
    expect(result.saleStatus).toBe('COMPLETED');
    const sale = await prisma.sale.findUnique({ where: { id: saleId } });
    expect(sale?.changeAmount).toBe(0);
  });

  it('cash overpayment records change on sale and payment tender', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });
    const tendered = totalCents + 40;
    const result = await payCash({
      businessId,
      saleId,
      userId,
      amountCents: totalCents,
      tenderedCents: tendered,
    });
    expect(result.changeCents).toBe(40);
    const sale = await prisma.sale.findUnique({ where: { id: saleId } });
    expect(sale?.changeAmount).toBe(40);
    const payment = await prisma.payment.findFirst({ where: { saleId, method: 'CASH' } });
    expect(payment?.amountCents).toBe(totalCents);
    expect(payment?.tenderedCents).toBe(tendered);
  });

  it('rejects insufficient cash tender', async () => {
    const { saleId, totalCents } = await createPendingCheckout({
      businessId,
      branchId,
      userId,
      items: [{ productId, quantity: 1 }],
    });
    await expect(
      payCash({
        businessId,
        saleId,
        userId,
        amountCents: totalCents,
        tenderedCents: totalCents - 1,
      })
    ).rejects.toThrow(/less than the amount due/i);
  });

  it('cashChangeCentsFromPayments ignores non-cash', () => {
    const change = cashChangeCentsFromPayments([
      { method: 'CASH', status: 'COMPLETED', amount: 100, amountCents: 100, tenderedCents: 150 },
      { method: 'MPESA_STK', status: 'COMPLETED', amount: 50, amountCents: 50, tenderedCents: null },
    ]);
    expect(change).toBe(50);
  });

  it('assertNoInFlightStk blocks when STK is SENT', async () => {
    vi.stubEnv('MPESA_MOCK', 'true');
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
        mpesaCheckoutRequestId: `REG-SENT-${Date.now()}`,
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
        status: 'SENT',
      },
    });
    await expect(assertNoInFlightStk(saleId, businessId)).rejects.toBeInstanceOf(AppError);
  });
});
