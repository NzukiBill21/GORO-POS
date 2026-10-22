import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { asyncHandler } from '../lib/errors.js';
import {
  getPublicPaymentConfig,
  savePaymentConfig,
} from '../services/pos/posPaymentConfigService.js';
import {
  calculateSaleQuote,
  type QuoteLineInput,
} from '../services/pos/posPricingService.js';
import {
  createPendingCheckout,
  payCash,
  payCard,
  payMpesaManual,
  paySplit,
  initiateStkForSale,
  listManualPaymentsForReview,
  reviewManualPayment,
  openCashShift,
  closeCashShift,
  getOpenCashShift,
  buildCashShiftZReport,
  reconcileMpesaCsv,
} from '../services/pos/posCheckoutService.js';
import { getStkStatus, markStkTimeout } from '../services/pos/posMpesaStkService.js';
import { assertMpesaMockAllowed } from '../lib/mpesaMockGuard.js';
import { buildSaleReceiptHtml } from '../services/pos/posReceiptService.js';
import { createHeldCheckout } from '../services/pos/posCheckoutService.js';
import { validate } from '../middleware/validate.js';
import {
  checkoutCreateSchema,
  checkoutQuoteSchema,
  payCashSchema,
  payMpesaManualSchema,
  payMpesaStkSchema,
  paySplitSchema,
  saleIdParamSchema,
} from '../lib/schemas/posPaymentsSchemas.js';
import { strictRateLimit } from '../middleware/rateLimit.js';
import { ensureUserBranchId, resolveBranchIdForBusiness } from '../lib/branchContext.js';

async function branchForPosUser(user: { businessId: string; branchId?: string; userId: string }) {
  if (user.branchId) return user.branchId;
  const assigned = await ensureUserBranchId(user.userId, user.businessId);
  if (assigned) return assigned;
  return resolveBranchIdForBusiness(user.businessId);
}

export const posPaymentsRouter = Router();

posPaymentsRouter.use(authenticate);

posPaymentsRouter.get(
  '/settings',
  requirePermission('settings.view', 'settings.manage'),
  asyncHandler(async (req, res) => {
    res.json(await getPublicPaymentConfig(req.user!.businessId));
  })
);

posPaymentsRouter.put(
  '/settings',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    assertMpesaMockAllowed();
    res.json(await savePaymentConfig(req.user!.businessId, req.body));
  })
);

posPaymentsRouter.post(
  '/checkout/quote',
  requirePermission('pos.sell', 'sales.create'),
  validate(checkoutQuoteSchema),
  asyncHandler(async (req, res) => {
    const branchId = await branchForPosUser(req.user!);
    res.json(
      await calculateSaleQuote(req.user!.businessId, {
        items: req.body.items as QuoteLineInput[],
        discountAmount: req.body.discountAmount,
        branchId,
        validateStock: true,
      })
    );
  })
);

posPaymentsRouter.post(
  '/checkout',
  requirePermission('pos.sell', 'sales.create'),
  validate(checkoutCreateSchema),
  asyncHandler(async (req, res) => {
    const branchId = await branchForPosUser(req.user!);
    res.status(201).json(
      await createPendingCheckout({
        businessId: req.user!.businessId,
        branchId,
        userId: req.user!.userId,
        items: req.body.items,
        discountAmount: req.body.discountAmount,
        customerId: req.body.customerId,
        idempotencyKey: req.body.idempotencyKey,
        heldSaleId: req.body.heldSaleId,
      })
    );
  })
);

posPaymentsRouter.post(
  '/hold',
  requirePermission('pos.sell', 'sales.create'),
  asyncHandler(async (req, res) => {
    const branchId = await branchForPosUser(req.user!);
    res.status(201).json(
      await createHeldCheckout({
        businessId: req.user!.businessId,
        branchId,
        userId: req.user!.userId,
        items: req.body.items,
        discountAmount: req.body.discountAmount,
        customerId: req.body.customerId,
        notes: req.body.notes,
      })
    );
  })
);

posPaymentsRouter.get(
  '/sales/:saleId/receipt',
  requirePermission('pos.sell', 'sales.view'),
  asyncHandler(async (req, res) => {
    const html = await buildSaleReceiptHtml(req.params.saleId, req.user!.businessId);
    res.json({ html });
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/receipt/reprint',
  requirePermission('pos.sell', 'sales.view'),
  asyncHandler(async (req, res) => {
    const { writeAuditLog } = await import('../lib/audit.js');
    await writeAuditLog(
      { action: 'RECEIPT_REPRINT', module: 'POS', entityId: req.params.saleId },
      { userId: req.user!.userId }
    );
    const html = await buildSaleReceiptHtml(req.params.saleId, req.user!.businessId);
    res.json({ html });
  })
);

posPaymentsRouter.get(
  '/sales/:saleId/summary',
  requirePermission('pos.sell', 'sales.view'),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findFirst({
      where: { id: req.params.saleId, branch: { businessId: req.user!.businessId } },
      select: {
        invoiceNumber: true,
        total: true,
        changeAmount: true,
        amountPaid: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    if (!sale) throw new AppError('Sale not found', 404);
    res.json(sale);
  })
);

posPaymentsRouter.get(
  '/sales/:saleId/status',
  requirePermission('pos.sell', 'sales.view'),
  validate(saleIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await getStkStatus(req.params.saleId, req.user!.businessId, req.user!.userId));
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/cash',
  requirePermission('pos.sell', 'sales.create'),
  strictRateLimit,
  validate(saleIdParamSchema, 'params'),
  validate(payCashSchema),
  asyncHandler(async (req, res) => {
    res.json(await payCash({ businessId: req.user!.businessId, saleId: req.params.saleId, userId: req.user!.userId, ...req.body }));
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/card',
  requirePermission('pos.sell', 'sales.create'),
  asyncHandler(async (req, res) => {
    res.json(await payCard({ businessId: req.user!.businessId, saleId: req.params.saleId, userId: req.user!.userId, ...req.body }));
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/mpesa-manual',
  requirePermission('pos.sell', 'sales.create'),
  strictRateLimit,
  validate(saleIdParamSchema, 'params'),
  validate(payMpesaManualSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await payMpesaManual({
        businessId: req.user!.businessId,
        saleId: req.params.saleId,
        userId: req.user!.userId,
        transactionCode: req.body.transactionCode,
        senderPhone: req.body.senderPhone,
        amountCents: req.body.amountCents,
      })
    );
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/mpesa-stk',
  requirePermission('pos.sell', 'sales.create'),
  strictRateLimit,
  validate(saleIdParamSchema, 'params'),
  validate(payMpesaStkSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await initiateStkForSale({
        businessId: req.user!.businessId,
        saleId: req.params.saleId,
        userId: req.user!.userId,
        phone: req.body.phone,
        amountCents: req.body.amountCents,
        idempotencyKey: req.body.idempotencyKey,
      })
    );
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/split',
  requirePermission('pos.sell', 'sales.create'),
  strictRateLimit,
  validate(saleIdParamSchema, 'params'),
  validate(paySplitSchema),
  asyncHandler(async (req, res) => {
    res.json(await paySplit({ businessId: req.user!.businessId, saleId: req.params.saleId, userId: req.user!.userId, lines: req.body.lines }));
  })
);

posPaymentsRouter.post(
  '/sales/:saleId/pay/mpesa-stk/timeout',
  requirePermission('pos.sell', 'sales.create'),
  asyncHandler(async (req, res) => {
    await markStkTimeout(req.body.paymentId, req.user!.businessId);
    res.json({ timedOut: true });
  })
);

posPaymentsRouter.get(
  '/manual-payments/review',
  requirePermission('billing.manage', 'reports.financial'),
  asyncHandler(async (req, res) => {
    res.json(await listManualPaymentsForReview(req.user!.businessId));
  })
);

posPaymentsRouter.post(
  '/manual-payments/:paymentId/review',
  requirePermission('billing.manage', 'reports.financial'),
  asyncHandler(async (req, res) => {
    res.json(
      await reviewManualPayment({
        businessId: req.user!.businessId,
        paymentId: req.params.paymentId,
        reviewerUserId: req.user!.userId,
        action: req.body.action,
      })
    );
  })
);

posPaymentsRouter.get(
  '/cash-shifts/current',
  requirePermission('pos.sell'),
  asyncHandler(async (req, res) => {
    const branchId = await branchForPosUser(req.user!);
    const shift = await getOpenCashShift(req.user!.businessId, branchId, req.user!.userId);
    res.json(shift);
  })
);

posPaymentsRouter.get(
  '/cash-shifts/:shiftId/z-report',
  requirePermission('pos.sell', 'reports.view'),
  asyncHandler(async (req, res) => {
    res.json(await buildCashShiftZReport(req.params.shiftId, req.user!.businessId));
  })
);

posPaymentsRouter.post(
  '/cash-shifts/open',
  requirePermission('pos.sell'),
  asyncHandler(async (req, res) => {
    res.json(
      await openCashShift(
        req.user!.businessId,
        await branchForPosUser(req.user!),
        req.user!.userId,
        req.body.openingFloatCents ?? 0
      )
    );
  })
);

posPaymentsRouter.post(
  '/cash-shifts/:shiftId/close',
  requirePermission('pos.sell'),
  asyncHandler(async (req, res) => {
    res.json(
      await closeCashShift({
        shiftId: req.params.shiftId,
        businessId: req.user!.businessId,
        userId: req.user!.userId,
        countedCashCents: req.body.countedCashCents,
        expectedCashCents: req.body.expectedCashCents,
      })
    );
  })
);

posPaymentsRouter.post(
  '/reconciliation/mpesa-csv',
  requirePermission('reports.financial', 'billing.manage'),
  asyncHandler(async (req, res) => {
    res.json(
      await reconcileMpesaCsv({
        businessId: req.user!.businessId,
        userId: req.user!.userId,
        filename: req.body.filename ?? 'upload.csv',
        rows: req.body.rows ?? [],
      })
    );
  })
);
