import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { safeOrderBy } from '../lib/tenant.js';
import { Prisma } from '@prisma/client';

function generateOrderNumber(): string {
  const date = new Date();
  return `PO-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

export class PurchaseService {
  async listSuppliers(businessId: string, params: PaginationParams) {
    const { page = 1, limit = 20, search } = params;
    const where: Prisma.SupplierWhereInput = {
      businessId,
      isActive: true,
      ...(search && { OR: [{ name: { contains: search } }, { email: { contains: search } }] }),
    };

    const [data, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, ...skipTake(page, limit) }),
      prisma.supplier.count({ where }),
    ]);
    return paginateResult(data, total, page, limit);
  }

  async createSupplier(businessId: string, userId: string, data: Prisma.SupplierCreateInput) {
    const supplier = await prisma.supplier.create({ data: { ...data, business: { connect: { id: businessId } } } });
    await logActivity({ userId, action: 'CREATE', module: 'PURCHASES', entityId: supplier.id, details: `Created supplier: ${supplier.name}` });
    return supplier;
  }

  async list(businessId: string, params: PaginationParams & { status?: string }) {
    const { page = 1, limit = 20, search, status, sortBy, sortOrder = 'desc' } = params;

    const branches = await prisma.branch.findMany({ where: { businessId }, select: { id: true } });
    const branchIds = branches.map((b) => b.id);
    if (branchIds.length === 0) {
      return paginateResult([], 0, page, limit);
    }

    const where: Prisma.PurchaseWhereInput = {
      branchId: { in: branchIds },
      ...(status && { status }),
      ...(search && { orderNumber: { contains: search } }),
    };

    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: {
          supplier: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
          items: true,
        },
        orderBy: safeOrderBy('purchase', sortBy, sortOrder),
        ...skipTake(page, limit),
      }),
      prisma.purchase.count({ where }),
    ]);

    return paginateResult(purchases, total, page, limit);
  }

  async create(params: {
    branchId: string;
    userId: string;
    supplierId: string;
    items: Array<{ productId: string; quantity: number; unitCost: number }>;
    notes?: string;
    expectedDate?: string;
  }) {
    const { branchId, userId, supplierId, items, notes, expectedDate } = params;
    if (!items.length) throw new AppError('Purchase must have items');

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          branchId,
          userId,
          supplierId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          subtotal,
          total: subtotal,
          notes,
          expectedDate: expectedDate ? new Date(expectedDate) : undefined,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitCost: i.unitCost,
              total: i.quantity * i.unitCost,
            })),
          },
        },
        include: { items: true, supplier: true },
      });

      await logActivity({ userId, action: 'CREATE', module: 'PURCHASES', entityId: purchase.id, details: `Created PO ${purchase.orderNumber}` });
      return purchase;
    });
  }

  async receive(
    id: string,
    branchId: string,
    userId: string,
    businessId: string,
    lines?: Array<{ itemId: string; quantity: number }>
  ) {
    const warehouse = await prisma.warehouse.findFirst({ where: { businessId, isDefault: true } });
    if (!warehouse) throw new AppError('No default warehouse configured');

    const lineMap = new Map(lines?.map((l) => [l.itemId, l.quantity]));

    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, branchId, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
        include: { items: true },
      });
      if (!purchase) throw new AppError('Purchase not found or already received', 404);

      let anyReceived = false;

      for (const item of purchase.items) {
        const remaining = item.quantity - item.receivedQty;
        if (remaining <= 0) continue;

        let receiveQty = remaining;
        if (lineMap.size > 0) {
          if (!lineMap.has(item.id)) continue;
          receiveQty = lineMap.get(item.id)!;
        }

        if (receiveQty <= 0) continue;
        if (receiveQty > remaining) {
          throw new AppError(`Cannot receive ${receiveQty} for line — only ${remaining} remaining`, 400);
        }

        anyReceived = true;

        let stock = await tx.stock.findFirst({
          where: {
            productId: item.productId,
            warehouseId: warehouse.id,
            OR: [{ branchId }, { branchId: null }],
          },
        });
        if (stock) {
          if (!stock.branchId) {
            await tx.stock.update({ where: { id: stock.id }, data: { branchId } });
          }
          await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: receiveQty } } });
        } else {
          stock = await tx.stock.create({
            data: { productId: item.productId, warehouseId: warehouse.id, branchId, quantity: receiveQty },
          });
        }
        await tx.stockMovement.create({
          data: { stockId: stock.id, type: 'IN', quantity: receiveQty, reference: purchase.orderNumber, createdBy: userId },
        });
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { receivedQty: item.receivedQty + receiveQty },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { costPrice: item.unitCost },
        });
      }

      if (!anyReceived) throw new AppError('Nothing to receive', 400);

      const refreshedItems = await tx.purchaseItem.findMany({ where: { purchaseId: id } });
      const fullyReceived = refreshedItems.every((i) => i.receivedQty >= i.quantity);
      const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIAL';

      await tx.purchase.update({
        where: { id },
        data: {
          status: newStatus,
          receivedDate: fullyReceived ? new Date() : purchase.receivedDate,
        },
      });

      const updated = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: { items: true, supplier: true },
      });

      await logActivity({
        userId,
        action: 'RECEIVE',
        module: 'PURCHASES',
        entityId: id,
        details: `${fullyReceived ? 'Fully' : 'Partially'} received PO ${purchase.orderNumber}`,
      });
      return updated;
    });
  }
}

export const purchaseService = new PurchaseService();
