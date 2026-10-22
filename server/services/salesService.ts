import { prisma } from '../lib/prisma.js';

import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';

import { logActivity, createNotification, writeAuditLog } from '../lib/audit.js';

import { AppError } from '../lib/errors.js';

import { deductStock, restoreStock } from '../lib/stock.js';

import { safeOrderBy } from '../lib/tenant.js';

import { Prisma } from '@prisma/client';



function generateInvoiceNumber(): string {

  const date = new Date();

  const prefix = `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

  return `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

}



interface SaleItemInput {

  productId: string;

  variantId?: string;

  name: string;

  sku?: string;

  quantity: number;

  unitPrice: number;

  costPrice?: number;

  discount?: number;

  taxAmount?: number;

  total: number;

}



export class SalesService {

  async list(branchId: string, params: PaginationParams & { status?: string; startDate?: string; endDate?: string }) {

    const { page = 1, limit = 20, search, status, startDate, endDate, sortBy, sortOrder = 'desc' } = params;



    const where: Prisma.SaleWhereInput = {

      branchId,

      isDeleted: false,

      ...(status && { status }),

      ...(search && { invoiceNumber: { contains: search } }),

      ...(startDate || endDate

        ? {

            createdAt: {

              ...(startDate && { gte: new Date(startDate) }),

              ...(endDate && { lte: new Date(endDate) }),

            },

          }

        : {}),

    };



    const orderBy = safeOrderBy('sale', sortBy, sortOrder);



    const [sales, total] = await Promise.all([

      prisma.sale.findMany({

        where,

        include: {

          customer: { select: { firstName: true, lastName: true } },

          user: { select: { firstName: true, lastName: true } },

          items: true,

          payments: true,

        },

        orderBy,

        ...skipTake(page, limit),

      }),

      prisma.sale.count({ where }),

    ]);



    return paginateResult(sales, total, page, limit);

  }



  async getById(id: string, branchId: string) {

    const sale = await prisma.sale.findFirst({

      where: { id, branchId },

      include: {

        customer: true,

        user: { select: { firstName: true, lastName: true } },

        items: { include: { product: { select: { name: true, sku: true } } } },

        payments: true,

        discounts: true,

      },

    });

    if (!sale) throw new AppError('Sale not found', 404);

    return sale;

  }



  async create(params: {

    branchId: string;

    userId: string;

    sessionId?: string;

    customerId?: string;

    items: SaleItemInput[];

    discountAmount?: number;

    taxAmount?: number;

    notes?: string;

    status?: string;

    idempotencyKey?: string;

    payments?: Array<{ method: string; amount: number; reference?: string }>;

  }) {

    const { branchId, userId, sessionId, items, discountAmount = 0, taxAmount = 0, status = 'COMPLETED', payments, idempotencyKey, ...rest } = params;

    if (!items?.length) throw new AppError('Sale must have at least one item');

    if (status === 'COMPLETED') {
      throw new AppError(
        'Direct completed sales are disabled. Use POST /api/pos/checkout and payment endpoints.',
        400
      );
    }



    const subtotal = items.reduce((sum, item) => sum + item.total, 0);

    const total = subtotal - discountAmount + taxAmount;

    const amountPaid = payments?.reduce((sum, p) => sum + p.amount, 0) ?? total;



    return prisma.$transaction(async (tx) => {

      if (idempotencyKey) {

        const existing = await tx.sale.findUnique({ where: { idempotencyKey } });

        if (existing) {

          return tx.sale.findUniqueOrThrow({

            where: { id: existing.id },

            include: { items: true, payments: true, customer: true },

          });

        }

      }



      const sale = await tx.sale.create({

        data: {

          branchId,

          userId,

          sessionId,

          invoiceNumber: generateInvoiceNumber(),

          idempotencyKey,

          status,

          subtotal,

          discountAmount,

          taxAmount,

          total,

          amountPaid,

          changeAmount: Math.max(0, amountPaid - total),

          notes: rest.notes,

          customerId: rest.customerId,

          items: {

            create: items.map((item) => ({

              productId: item.productId,

              variantId: item.variantId,

              name: item.name,

              sku: item.sku,

              quantity: item.quantity,

              unitPrice: item.unitPrice,

              costPrice: item.costPrice ?? 0,

              discount: item.discount ?? 0,

              taxAmount: item.taxAmount ?? 0,

              total: item.total,

            })),

          },

          payments: payments?.length

            ? { create: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })) }

            : { create: [{ method: 'CASH', amount: total }] },

        },

        include: { items: true, payments: true, customer: true },

      });



      if (status === 'COMPLETED') {

        await tx.receipt.create({

          data: { saleId: sale.id, receiptNumber: sale.invoiceNumber },

        });



        for (const item of items) {

          const product = await tx.product.findUnique({ where: { id: item.productId }, include: { stocks: true } });

          if (product?.trackStock) {

            const branchRow = await tx.branch.findUnique({ where: { id: branchId }, select: { businessId: true } });
            await deductStock(tx, {
              businessId: branchRow!.businessId,
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              reference: sale.invoiceNumber,
              userId,
              branchId,
            });



            const totalStock = product.stocks.reduce((s, st) => s + st.quantity, 0) - item.quantity;

            if (totalStock <= product.minStock) {

              await createNotification({
                businessId,
                type: 'LOW_STOCK',
                title: 'Low Stock Alert',
                message: `${product.name} is running low (${totalStock} remaining)`,
                data: JSON.stringify({ productId: product.id }),
              });

            }

          }

        }

      }



      await writeAuditLog({

        action: 'CREATE',

        module: 'SALES',

        entityId: sale.id,

        newValues: { invoiceNumber: sale.invoiceNumber, total, status },

        details: `Sale ${sale.invoiceNumber} - $${total.toFixed(2)}`,

      }, { userId, sessionId });



      return sale;

    });

  }



  async getHeld(branchId: string) {

    return prisma.sale.findMany({

      where: { branchId, status: 'HELD' },

      include: { items: true, customer: true },

      orderBy: { updatedAt: 'desc' },

    });

  }



  async holdSale(params: {

    branchId: string;

    userId: string;

    customerId?: string;

    items: SaleItemInput[];

    discountAmount?: number;

    taxAmount?: number;

    notes?: string;

  }) {

    return this.create({ ...params, status: 'HELD', payments: [] });

  }



  async resumeSale(_id: string, _branchId: string, _userId: string, _payments: Array<{ method: string; amount: number }>) {
    throw new AppError(
      'Resume with client payments is disabled. Load the held sale in POS and checkout via /api/pos/checkout.',
      400
    );
  }



  async voidSale(id: string, branchId: string, userId: string, sessionId?: string) {

    const sale = await prisma.sale.findFirst({

      where: { id, branchId, isDeleted: false },

      include: { items: true },

    });

    if (!sale) throw new AppError('Sale not found', 404);

    if (sale.status === 'VOIDED') throw new AppError('Sale already voided', 400);

    if (sale.status === 'REFUNDED') throw new AppError('Cannot void a refunded sale', 400);



    const previous = { status: sale.status };



    return prisma.$transaction(async (tx) => {

      await tx.sale.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date() } });



      if (sale.status === 'COMPLETED') {

        for (const item of sale.items) {

          const product = await tx.product.findUnique({ where: { id: item.productId } });

          if (product?.trackStock) {

            await restoreStock(tx, {

              productId: item.productId,

              variantId: item.variantId,

              quantity: item.quantity,

              reference: sale.invoiceNumber,

              userId,

              movementType: 'VOID',

            });

          }

        }

      }



      await writeAuditLog({

        action: 'VOID',

        module: 'SALES',

        entityId: id,

        previousValues: previous,

        newValues: { status: 'VOIDED' },

        details: `Voided sale ${sale.invoiceNumber}`,

      }, { userId, sessionId });



      return { success: true };

    });

  }



  async refund(id: string, branchId: string, userId: string, sessionId?: string) {

    const sale = await prisma.sale.findFirst({

      where: { id, branchId, isDeleted: false },

      include: { items: true },

    });

    if (!sale) throw new AppError('Sale not found', 404);

    if (sale.status !== 'COMPLETED') throw new AppError('Only completed sales can be refunded', 400);



    return prisma.$transaction(async (tx) => {

      await tx.sale.update({ where: { id }, data: { status: 'REFUNDED', refundedAt: new Date() } });



      for (const item of sale.items) {

        const product = await tx.product.findUnique({ where: { id: item.productId } });

        if (product?.trackStock) {

          await restoreStock(tx, {

            productId: item.productId,

            variantId: item.variantId,

            quantity: item.quantity,

            reference: sale.invoiceNumber,

            userId,

          });

        }

      }



      await writeAuditLog({

        action: 'REFUND',

        module: 'SALES',

        entityId: id,

        previousValues: { status: 'COMPLETED' },

        newValues: { status: 'REFUNDED' },

        details: `Refunded sale ${sale.invoiceNumber}`,

      }, { userId, sessionId });



      return { success: true };

    });

  }



  /** @deprecated Use voidSale */

  async cancel(id: string, branchId: string, userId: string) {

    return this.voidSale(id, branchId, userId);

  }

}



export const salesService = new SalesService();


