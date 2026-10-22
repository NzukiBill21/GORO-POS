import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { deductStock } from '../../lib/stock.js';
import { calculateSaleQuote, centsToMajor, type QuoteLineInput } from './posPricingService.js';
import { requireMethodEnabled } from './posPaymentConfigService.js';
import { writeAuditLog } from '../../lib/audit.js';
import { v4 as uuidv4 } from 'uuid';
import { cashChangeCentsFromPayments } from '../../lib/posCash.js';

const MANUAL_CODE_RE = /^[A-Z0-9]{8,12}$/i;
const COMPLETED_PAYMENT_STATUSES = new Set(['COMPLETED']);

function generateInvoiceNumber(): string {
  const date = new Date();
  const prefix = `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

export function validateManualMpesaCode(code: string): boolean {
  return MANUAL_CODE_RE.test(code.trim());
}

export async function getSaleTotalCents(saleId: string): Promise<number> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw new AppError('Sale not found', 404);
  return Math.round(sale.total);
}

export async function sumCompletedPaymentsCents(saleId: string): Promise<number> {
  const payments = await prisma.payment.findMany({ where: { saleId } });
  return payments
    .filter((p) => COMPLETED_PAYMENT_STATUSES.has(p.status))
    .reduce((s, p) => s + (p.amountCents ?? Math.round(p.amount)), 0);
}

async function getSaleForBusiness(saleId: string, businessId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, branch: { businessId } },
    include: { items: true, payments: true, branch: true },
  });
  if (!sale) throw new AppError('Sale not found', 404);
  return sale;
}

function saleItemsCreateFromQuote(quote: Awaited<ReturnType<typeof calculateSaleQuote>>) {
  return quote.lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    name: l.name,
    sku: l.sku,
    quantity: l.quantity,
    unitPrice: centsToMajor(l.unitPriceCents),
    costPrice: centsToMajor(l.costPriceCents ?? 0),
    total: centsToMajor(l.lineTotalCents),
    taxAmount: centsToMajor(l.taxCents),
  }));
}

export async function createHeldCheckout(params: {
  businessId: string;
  branchId: string;
  userId: string;
  items: QuoteLineInput[];
  discountAmount?: number;
  customerId?: string;
  notes?: string;
}) {
  const quote = await calculateSaleQuote(params.businessId, {
    items: params.items,
    discountAmount: params.discountAmount,
    branchId: params.branchId,
    validateStock: false,
  });

  const sale = await prisma.sale.create({
    data: {
      branchId: params.branchId,
      userId: params.userId,
      customerId: params.customerId,
      invoiceNumber: generateInvoiceNumber(),
      status: 'HELD',
      notes: params.notes,
      subtotal: centsToMajor(quote.subtotalCents),
      discountAmount: centsToMajor(quote.discountCents),
      taxAmount: centsToMajor(quote.taxCents),
      total: centsToMajor(quote.totalCents),
      amountPaid: 0,
      changeAmount: 0,
      items: { create: saleItemsCreateFromQuote(quote) },
    },
  });

  await writeAuditLog(
    { action: 'POS_SALE_HELD', module: 'POS', entityId: sale.id },
    { userId: params.userId }
  );

  return { saleId: sale.id, quote, totalCents: quote.totalCents };
}

export async function createPendingCheckout(params: {
  businessId: string;
  branchId: string;
  userId: string;
  items: QuoteLineInput[];
  discountAmount?: number;
  customerId?: string;
  idempotencyKey?: string;
  heldSaleId?: string;
}) {
  if (!params.branchId) {
    throw new AppError('No store branch assigned. Sign out and sign in again, or ask your manager to set your branch.', 400);
  }

  const quote = await calculateSaleQuote(params.businessId, {
    items: params.items,
    discountAmount: params.discountAmount,
    branchId: params.branchId,
    validateStock: true,
  });

  if (params.idempotencyKey) {
    const existing = await prisma.sale.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) {
      return { saleId: existing.id, quote, totalCents: Math.round(existing.total) };
    }
  }

  if (params.heldSaleId) {
    const held = await getSaleForBusiness(params.heldSaleId, params.businessId);
    if (held.status !== 'HELD') throw new AppError('Sale is not held', 400);

    await prisma.saleItem.deleteMany({ where: { saleId: held.id } });
    const sale = await prisma.sale.update({
      where: { id: held.id },
      data: {
        status: 'PENDING_PAYMENT',
        customerId: params.customerId ?? held.customerId,
        idempotencyKey: params.idempotencyKey,
        subtotal: centsToMajor(quote.subtotalCents),
        discountAmount: centsToMajor(quote.discountCents),
        taxAmount: centsToMajor(quote.taxCents),
        total: centsToMajor(quote.totalCents),
        amountPaid: 0,
        changeAmount: 0,
        items: { create: saleItemsCreateFromQuote(quote) },
      },
    });
    return { saleId: sale.id, quote, totalCents: quote.totalCents };
  }

  const sale = await prisma.sale.create({
    data: {
      branchId: params.branchId,
      userId: params.userId,
      customerId: params.customerId,
      invoiceNumber: generateInvoiceNumber(),
      idempotencyKey: params.idempotencyKey,
      status: 'PENDING_PAYMENT',
      subtotal: centsToMajor(quote.subtotalCents),
      discountAmount: centsToMajor(quote.discountCents),
      taxAmount: centsToMajor(quote.taxCents),
      total: centsToMajor(quote.totalCents),
      amountPaid: 0,
      changeAmount: 0,
      items: { create: saleItemsCreateFromQuote(quote) },
    },
  });

  return { saleId: sale.id, quote, totalCents: quote.totalCents };
}

export async function completeSaleIfFullyPaid(saleId: string, businessId: string, userId?: string) {
  const sale = await getSaleForBusiness(saleId, businessId);
  const totalCents = Math.round(sale.total);
  const paidCents = await sumCompletedPaymentsCents(saleId);

  if (paidCents < totalCents) return sale;
  if (sale.status === 'COMPLETED') return sale;

  const allPayments = await prisma.payment.findMany({ where: { saleId } });
  const changeCents = cashChangeCentsFromPayments(allPayments);

  const updated = await prisma.$transaction(async (tx) => {
    const saleRow = await tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'COMPLETED',
        amountPaid: centsToMajor(paidCents),
        changeAmount: centsToMajor(changeCents),
      },
      include: { items: true, payments: true },
    });

    await tx.receipt.create({
      data: { saleId, receiptNumber: saleRow.invoiceNumber },
    });

    for (const item of sale.items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { stocks: true },
      });
      if (product?.trackStock) {
        await deductStock(tx, {
          businessId,
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: item.quantity,
          reference: saleRow.invoiceNumber,
          userId: userId ?? sale.userId,
          branchId: sale.branchId,
        });
      }
    }

    return saleRow;
  });

  if (userId) {
    await writeAuditLog(
      { action: 'SALE_COMPLETED', module: 'POS', entityId: saleId, details: `Paid ${paidCents} cents` },
      { userId }
    );
  }

  return updated;
}

async function assertPaymentSum(saleId: string, businessId: string, newLines: Array<{ amountCents: number }>) {
  const { releaseUndispatchedStkHolds } = await import('./posMpesaStkService.js');
  await releaseUndispatchedStkHolds(saleId, businessId);

  const totalCents = await getSaleTotalCents(saleId);
  const existing = await sumCompletedPaymentsCents(saleId);
  const pending = await prisma.payment.findMany({
    where: { saleId, status: 'PENDING' },
  });
  const pendingSum = pending.reduce((s, p) => s + (p.amountCents ?? Math.round(p.amount)), 0);
  const newSum = newLines.reduce((s, l) => s + l.amountCents, 0);
  if (existing + pendingSum + newSum > totalCents) {
    throw new AppError('Payment total exceeds sale amount', 400);
  }
}

export async function payCash(params: {
  businessId: string;
  saleId: string;
  userId: string;
  amountCents: number;
  tenderedCents: number;
}) {
  await requireMethodEnabled(params.businessId, 'cash');
  const { releaseUndispatchedStkHolds } = await import('./posMpesaStkService.js');
  await releaseUndispatchedStkHolds(
    params.saleId,
    params.businessId,
    'Cash payment — cancelled undispatched M-Pesa attempt'
  );
  const sale = await getSaleForBusiness(params.saleId, params.businessId);
  const totalCents = Math.round(sale.total);
  const remaining = totalCents - (await sumCompletedPaymentsCents(params.saleId));
  const payCents = params.amountCents || remaining;
  if (payCents <= 0) throw new AppError('Nothing to pay', 400);
  if (params.tenderedCents < payCents) {
    throw new AppError('Cash received is less than the amount due', 400);
  }

  await assertPaymentSum(params.saleId, params.businessId, [{ amountCents: payCents }]);

  const changeCents = params.tenderedCents - payCents;
  const payment = await prisma.payment.create({
    data: {
      saleId: params.saleId,
      businessId: params.businessId,
      method: 'CASH',
      amount: payCents,
      amountCents: payCents,
      tenderedCents: params.tenderedCents,
      status: 'COMPLETED',
      verificationStatus: 'VERIFIED',
      notes: `Tendered ${params.tenderedCents}, change ${changeCents}`,
    },
  });

  const completed = await completeSaleIfFullyPaid(params.saleId, params.businessId, params.userId);
  return {
    payment,
    changeCents: params.tenderedCents - payCents,
    saleStatus: completed.status,
  };
}

export async function payCard(params: {
  businessId: string;
  saleId: string;
  userId: string;
  amountCents: number;
  terminalRef: string;
  last4: string;
}) {
  await requireMethodEnabled(params.businessId, 'card');
  if (!/^\d{4}$/.test(params.last4)) throw new AppError('Last 4 digits required', 400);
  if (!params.terminalRef?.trim()) throw new AppError('Terminal reference required', 400);

  const sale = await getSaleForBusiness(params.saleId, params.businessId);
  const remaining = Math.round(sale.total) - (await sumCompletedPaymentsCents(params.saleId));
  const payCents = params.amountCents || remaining;
  await assertPaymentSum(params.saleId, params.businessId, [{ amountCents: payCents }]);

  const payment = await prisma.payment.create({
    data: {
      saleId: params.saleId,
      businessId: params.businessId,
      method: 'CARD',
      amount: payCents,
      amountCents: payCents,
      status: 'COMPLETED',
      verificationStatus: 'VERIFIED',
      cardTerminalRef: params.terminalRef.trim(),
      cardLast4: params.last4,
    },
  });

  const completed = await completeSaleIfFullyPaid(params.saleId, params.businessId, params.userId);
  return { payment, saleStatus: completed.status };
}

export async function payMpesaManual(params: {
  businessId: string;
  saleId: string;
  userId: string;
  transactionCode: string;
  senderPhone: string;
  amountCents: number;
}) {
  await requireMethodEnabled(params.businessId, 'mpesa_manual');
  const code = params.transactionCode.trim().toUpperCase();
  if (!validateManualMpesaCode(code)) throw new AppError('Invalid M-Pesa transaction code format', 400);
  if (!isValidKenyanPhoneManual(params.senderPhone)) throw new AppError('Invalid sender phone', 400);

  const sale = await getSaleForBusiness(params.saleId, params.businessId);
  const remaining = Math.round(sale.total) - (await sumCompletedPaymentsCents(params.saleId));
  const payCents = params.amountCents || remaining;
  await assertPaymentSum(params.saleId, params.businessId, [{ amountCents: payCents }]);

  const existing = await prisma.payment.findFirst({
    where: { businessId: params.businessId, manualTransactionCode: code },
  });
  if (existing) throw new AppError('Transaction code already used for this store', 409);

  const needsApproval = true;
  const payment = await prisma.payment.create({
    data: {
      saleId: params.saleId,
      businessId: params.businessId,
      method: 'MPESA_MANUAL',
      amount: payCents,
      amountCents: payCents,
      status: 'MANUAL_UNVERIFIED',
      verificationStatus: 'UNVERIFIED',
      manualTransactionCode: code,
      manualSenderPhone: params.senderPhone,
    },
  });

  const saleStatus = sale.status;

  await writeAuditLog(
    { action: 'POS_MPESA_MANUAL', module: 'POS', entityId: payment.id, details: code },
    { userId: params.userId }
  );

  return { payment, needsApproval, saleStatus };
}

function isValidKenyanPhoneManual(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return /^2547\d{8}$/.test(digits.startsWith('254') ? digits : `254${digits.replace(/^0/, '')}`);
}

export async function paySplit(params: {
  businessId: string;
  saleId: string;
  userId: string;
  lines: Array<{
    method: 'CASH' | 'CARD' | 'MPESA_MANUAL' | 'MPESA_STK';
    amountCents: number;
    phone?: string;
    transactionCode?: string;
    terminalRef?: string;
    last4?: string;
    tenderedCents?: number;
  }>;
}) {
  await requireMethodEnabled(params.businessId, 'split');
  const sale = await getSaleForBusiness(params.saleId, params.businessId);
  const totalCents = Math.round(sale.total);
  const sum = params.lines.reduce((s, l) => s + l.amountCents, 0);
  if (sum !== totalCents) {
    throw new AppError(`Split payments must equal sale total (${totalCents} != ${sum})`, 400);
  }

  const splitGroupId = uuidv4();
  const results = [];

  for (const line of params.lines) {
    if (line.method === 'CASH') {
      results.push(await payCash({
        businessId: params.businessId,
        saleId: params.saleId,
        userId: params.userId,
        amountCents: line.amountCents,
        tenderedCents: line.tenderedCents ?? line.amountCents,
      }));
    } else if (line.method === 'CARD') {
      results.push(await payCard({
        businessId: params.businessId,
        saleId: params.saleId,
        userId: params.userId,
        amountCents: line.amountCents,
        terminalRef: line.terminalRef ?? '',
        last4: line.last4 ?? '0000',
      }));
    } else if (line.method === 'MPESA_MANUAL') {
      results.push(await payMpesaManual({
        businessId: params.businessId,
        saleId: params.saleId,
        userId: params.userId,
        transactionCode: line.transactionCode ?? '',
        senderPhone: line.phone ?? '',
        amountCents: line.amountCents,
      }));
    } else if (line.method === 'MPESA_STK') {
      if (!line.phone) throw new AppError('Phone required for M-Pesa STK split', 400);
      results.push(
        await initiateStkForSale({
          businessId: params.businessId,
          saleId: params.saleId,
          userId: params.userId,
          phone: line.phone,
          amountCents: line.amountCents,
        })
      );
    } else {
      throw new AppError('Unsupported split payment method', 400);
    }
    await prisma.payment.updateMany({
      where: { saleId: params.saleId, splitGroupId: null },
      data: { splitGroupId },
    });
  }

  return { splitGroupId, results, saleStatus: (await getSaleForBusiness(params.saleId, params.businessId)).status };
}

export async function listManualPaymentsForReview(businessId: string) {
  return prisma.payment.findMany({
    where: {
      businessId,
      method: 'MPESA_MANUAL',
      verificationStatus: 'UNVERIFIED',
      status: 'MANUAL_UNVERIFIED',
    },
    include: { sale: { select: { invoiceNumber: true, total: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function reviewManualPayment(params: {
  businessId: string;
  paymentId: string;
  reviewerUserId: string;
  action: 'verify' | 'reject';
}) {
  const payment = await prisma.payment.findFirst({
    where: { id: params.paymentId, businessId: params.businessId, method: 'MPESA_MANUAL' },
  });
  if (!payment) throw new AppError('Payment not found', 404);

  if (params.action === 'reject') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', verificationStatus: 'REJECTED', approvedByUserId: params.reviewerUserId },
    });
    await writeAuditLog(
      { action: 'MANUAL_PAYMENT_REJECTED', module: 'POS', entityId: payment.id },
      { userId: params.reviewerUserId }
    );
    return { rejected: true };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'COMPLETED',
      verificationStatus: 'VERIFIED',
      approvedByUserId: params.reviewerUserId,
    },
  });

  const sale = payment.saleId
    ? await completeSaleIfFullyPaid(payment.saleId, params.businessId, params.reviewerUserId)
    : null;

  await writeAuditLog(
    { action: 'MANUAL_PAYMENT_VERIFIED', module: 'POS', entityId: payment.id },
    { userId: params.reviewerUserId }
  );

  return { verified: true, saleStatus: sale?.status };
}

export async function openCashShift(businessId: string, branchId: string, userId: string, openingFloatCents: number) {
  return prisma.cashShift.create({
    data: { businessId, branchId, userId, openingFloatCents, status: 'OPEN' },
  });
}

export async function closeCashShift(params: {
  shiftId: string;
  businessId: string;
  userId: string;
  countedCashCents: number;
  expectedCashCents?: number;
}) {
  const shift = await prisma.cashShift.findFirst({
    where: { id: params.shiftId, businessId: params.businessId, userId: params.userId, status: 'OPEN' },
  });
  if (!shift) throw new AppError('Shift not found', 404);

  const z = await buildCashShiftZReport(shift.id, params.businessId);
  const expected = params.expectedCashCents ?? z.expectedCashCents;
  const variance = params.countedCashCents - expected;
  const closed = await prisma.cashShift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      countedCashCents: params.countedCashCents,
      expectedCashCents: expected,
      varianceCents: variance,
    },
  });

  if (process.env.DESKTOP_MODE === 'true') {
    try {
      const { securityService } = await import('../securityService.js');
      await securityService.createBackup(params.businessId, 'MANUAL', params.userId);
    } catch (err) {
      console.error('[backup] shift-close backup failed:', err instanceof Error ? err.message : err);
    }
  }

  return closed;
}

export async function getOpenCashShift(businessId: string, branchId: string, userId: string) {
  return prisma.cashShift.findFirst({
    where: { businessId, branchId, userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  });
}

export async function buildCashShiftZReport(shiftId: string, businessId: string) {
  const shift = await prisma.cashShift.findFirst({ where: { id: shiftId, businessId } });
  if (!shift) throw new AppError('Shift not found', 404);

  const end = shift.closedAt ?? new Date();
  const sales = await prisma.sale.findMany({
    where: {
      branchId: shift.branchId,
      status: 'COMPLETED',
      createdAt: { gte: shift.openedAt, lte: end },
    },
    include: { payments: true, items: true },
  });

  const byPayment: Record<string, number> = {};
  let cashSalesCents = 0;
  let cogsCents = 0;
  let revenueCents = 0;

  for (const sale of sales) {
    revenueCents += Math.round(sale.total);
    cogsCents += sale.items.reduce((s, i) => s + Math.round(i.costPrice * i.quantity), 0);
    for (const p of sale.payments) {
      if (p.status !== 'COMPLETED') continue;
      const amt = p.amountCents ?? Math.round(p.amount);
      byPayment[p.method] = (byPayment[p.method] ?? 0) + amt;
      if (p.method === 'CASH') cashSalesCents += amt;
    }
  }

  const expectedCashCents = shift.openingFloatCents + cashSalesCents;

  return {
    shift,
    salesCount: sales.length,
    revenueCents,
    cogsCents,
    grossProfitCents: revenueCents - cogsCents,
    byPayment,
    cashSalesCents,
    expectedCashCents,
  };
}

export async function initiateStkForSale(params: {
  businessId: string;
  saleId: string;
  userId: string;
  phone: string;
  amountCents?: number;
  idempotencyKey?: string;
}) {
  const { initiatePosStkPush, assertNoInFlightStk, getStkStatus, assertLiveStkPreconditions } =
    await import('./posMpesaStkService.js');
  await requireMethodEnabled(params.businessId, 'mpesa_stk');

  if (params.idempotencyKey) {
    const existing = await prisma.payment.findUnique({
      where: { mpesaStkIdempotencyKey: params.idempotencyKey },
    });
    if (existing && existing.saleId === params.saleId && existing.businessId === params.businessId) {
      const st = await getStkStatus(params.saleId, params.businessId, params.userId);
      const rec = st.records.find((r) => r.paymentId === existing.id);
      return {
        checkoutRequestId: existing.mpesaCheckoutRequestId ?? rec?.checkoutRequestId,
        status: rec?.status ?? existing.status,
        mock: false,
        idempotentReplay: true,
      };
    }
  }

  await assertNoInFlightStk(params.saleId, params.businessId, params.userId);

  const sale = await getSaleForBusiness(params.saleId, params.businessId);
  if (sale.status === 'COMPLETED') {
    throw new AppError('This sale is already paid. Start a new checkout.', 400);
  }
  if (sale.status !== 'PENDING_PAYMENT') {
    throw new AppError('Sale is not open for payment', 400);
  }
  const remaining = Math.round(sale.total) - (await sumCompletedPaymentsCents(params.saleId));
  let payCents = params.amountCents ?? remaining;
  if (payCents > remaining) payCents = remaining;
  if (payCents <= 0) throw new AppError('Nothing to pay', 400);
  const { requirePosStkDarajaKes } = await import('../../lib/posStkAmount.js');
  requirePosStkDarajaKes(payCents);
  await assertLiveStkPreconditions(params.businessId);
  await assertPaymentSum(params.saleId, params.businessId, [{ amountCents: payCents }]);

  const payment = await prisma.payment.create({
    data: {
      saleId: params.saleId,
      businessId: params.businessId,
      method: 'MPESA_STK',
      amount: payCents,
      amountCents: payCents,
      status: 'PENDING',
      mpesaStkIdempotencyKey: params.idempotencyKey,
    },
  });

  try {
    return await initiatePosStkPush({
      businessId: params.businessId,
      saleId: params.saleId,
      paymentId: payment.id,
      phone: params.phone,
      amountCents: payCents,
      accountReference: sale.invoiceNumber,
      userId: params.userId,
    });
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        notes: err instanceof Error ? err.message : 'STK initiation failed',
      },
    });
    throw err;
  }
}

export async function reconcileMpesaCsv(params: {
  businessId: string;
  userId: string;
  filename: string;
  rows: Array<{ transactionCode: string; amountCents: number; phone?: string }>;
}) {
  const batch = await prisma.mpesaReconciliationBatch.create({
    data: { businessId: params.businessId, uploadedBy: params.userId, filename: params.filename },
  });

  let matched = 0;
  for (const row of params.rows) {
    const code = row.transactionCode.trim().toUpperCase();
    const payment = await prisma.payment.findFirst({
      where: { businessId: params.businessId, manualTransactionCode: code },
    });
    const matchStatus =
      payment && (payment.amountCents ?? Math.round(payment.amount)) === row.amountCents ? 'MATCHED' : 'UNMATCHED';
    if (matchStatus === 'MATCHED') matched++;
    await prisma.mpesaReconciliationLine.create({
      data: {
        batchId: batch.id,
        transactionCode: code,
        amountCents: row.amountCents,
        phone: row.phone,
        matchedPaymentId: payment?.id,
        matchStatus,
      },
    });
  }

  return prisma.mpesaReconciliationBatch.update({
    where: { id: batch.id },
    data: { matched, unmatched: params.rows.length - matched },
    include: { lines: true },
  });
}
