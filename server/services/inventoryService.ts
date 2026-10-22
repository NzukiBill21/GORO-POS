import { prisma } from '../lib/prisma.js';

import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';

import { logActivity, writeAuditLog } from '../lib/audit.js';

import { requiresManagerApproval } from '../lib/permissions.js';

import { AppError } from '../lib/errors.js';

import { assertProductInBusiness, assertWarehouseInBusiness, safeOrderBy } from '../lib/tenant.js';

import { Prisma } from '@prisma/client';



export class InventoryService {

  async listStock(businessId: string, params: PaginationParams & { lowStock?: boolean; categoryId?: string }) {

    const { page = 1, limit = 20, search, lowStock, sortBy, sortOrder = 'asc' } = params;



    const products = await prisma.product.findMany({

      where: {

        businessId,

        isActive: true,

        trackStock: true,

        ...(search && { OR: [{ name: { contains: search } }, { sku: { contains: search } }] }),

      },

      include: {

        category: { select: { name: true } },

        stocks: { include: { warehouse: { select: { name: true } } } },

      },

      orderBy: safeOrderBy('inventory', sortBy, sortOrder),

    });



    let data = products.map((p) => ({

      id: p.id,

      name: p.name,

      sku: p.sku,

      category: p.category?.name,

      costPrice: p.costPrice,

      sellingPrice: p.sellingPrice,

      minStock: p.minStock,

      stock: p.stocks.reduce((sum, s) => sum + s.quantity, 0),

      value: p.stocks.reduce((sum, s) => sum + s.quantity, 0) * p.costPrice,

      warehouses: p.stocks.map((s) => ({ name: s.warehouse.name, quantity: s.quantity })),

    }));



    if (lowStock) data = data.filter((p) => p.stock <= p.minStock);



    const total = data.length;

    const start = (page - 1) * limit;

    return paginateResult(data.slice(start, start + limit), total, page, limit);

  }



  async getMovements(productId: string, businessId: string, params: PaginationParams) {

    await assertProductInBusiness(productId, businessId);

    const { page = 1, limit = 20 } = params;

    const stocks = await prisma.stock.findMany({ where: { productId }, select: { id: true } });

    const stockIds = stocks.map((s) => s.id);



    const [movements, total] = await Promise.all([

      prisma.stockMovement.findMany({

        where: { stockId: { in: stockIds } },

        include: { stock: { include: { product: { select: { name: true } }, warehouse: { select: { name: true } } } } },

        orderBy: { createdAt: 'desc' },

        ...skipTake(page, limit),

      }),

      prisma.stockMovement.count({ where: { stockId: { in: stockIds } } }),

    ]);



    return paginateResult(movements, total, page, limit);

  }



  async adjust(params: {

    productId: string;

    warehouseId: string;

    quantity: number;

    type: 'IN' | 'OUT' | 'ADJUSTMENT';

    reason: string;

    notes?: string;

    userId: string;

    businessId: string;

    userRole: string;

  }) {

    const { productId, warehouseId, quantity, type, reason, notes, userId, businessId, userRole } = params;

    if (!reason || reason.length < 3) throw new AppError('Reason is required for inventory adjustments', 400);



    const product = await assertProductInBusiness(productId, businessId);

    await assertWarehouseInBusiness(warehouseId, businessId);



    if (requiresManagerApproval(userRole) && (type === 'ADJUSTMENT' || type === 'OUT')) {

      const approval = await prisma.inventoryApproval.create({

        data: {

          businessId,

          requesterId: userId,

          type: 'ADJUSTMENT',

          productId,

          reason,

          payload: JSON.stringify({ productId, warehouseId, quantity, type, notes }),

          status: 'PENDING',

        },

      });

      return { pendingApproval: true, approvalId: approval.id, message: 'Adjustment submitted for manager approval' };

    }



    return this.executeAdjust({ productId, warehouseId, quantity, type, reason, notes, userId, businessId, productName: product.name });

  }



  async executeAdjust(params: {

    productId: string; warehouseId: string; quantity: number;

    type: string; reason: string; notes?: string; userId: string; businessId: string; productName: string;

  }) {

    const { productId, warehouseId, quantity, type, reason, notes, userId, productName } = params;



    return prisma.$transaction(async (tx) => {

      let stock = await tx.stock.findFirst({ where: { productId, warehouseId } });

      if (!stock) stock = await tx.stock.create({ data: { productId, warehouseId, quantity: 0 } });



      const previousQty = stock.quantity;

      let newQty: number;



      if (type === 'IN') {

        newQty = previousQty + quantity;

        await tx.stock.update({ where: { id: stock.id }, data: { quantity: { increment: quantity } } });

      } else if (type === 'OUT') {

        const result = await tx.stock.updateMany({

          where: { id: stock.id, quantity: { gte: quantity } },

          data: { quantity: { decrement: quantity } },

        });

        if (result.count === 0) throw new AppError('Insufficient stock', 400);

        newQty = previousQty - quantity;

      } else {

        newQty = quantity;

        await tx.stock.update({ where: { id: stock.id }, data: { quantity: newQty } });

      }



      await tx.stockMovement.create({

        data: { stockId: stock.id, type, quantity, notes: `${reason}${notes ? ': ' + notes : ''}`, reference: type, createdBy: userId },

      });



      await writeAuditLog({

        action: type,

        module: 'INVENTORY',

        entityId: productId,

        previousValues: { quantity: previousQty },

        newValues: { quantity: newQty },

        details: `${type} ${quantity} units of ${productName}. Reason: ${reason}`,

      }, { userId });



      return { ...stock, quantity: newQty };

    });

  }



  async transfer(params: {

    productId: string;

    fromWarehouseId: string;

    toWarehouseId: string;

    quantity: number;

    reason: string;

    userId: string;

    businessId: string;

    userRole: string;

  }) {

    const { productId, fromWarehouseId, toWarehouseId, quantity, reason, userId, businessId, userRole } = params;

    if (!reason || reason.length < 3) throw new AppError('Reason is required for stock transfers', 400);

    if (fromWarehouseId === toWarehouseId) throw new AppError('Source and destination must differ');



    const product = await assertProductInBusiness(productId, businessId);

    await assertWarehouseInBusiness(fromWarehouseId, businessId);

    await assertWarehouseInBusiness(toWarehouseId, businessId);



    if (requiresManagerApproval(userRole)) {

      const approval = await prisma.inventoryApproval.create({

        data: {

          businessId, requesterId: userId, type: 'TRANSFER', productId, reason,

          payload: JSON.stringify({ productId, fromWarehouseId, toWarehouseId, quantity, reason }),

          status: 'PENDING',

        },

      });

      return { pendingApproval: true, approvalId: approval.id };

    }



    return this.executeTransfer({ productId, fromWarehouseId, toWarehouseId, quantity, reason, userId, productName: product.name });

  }



  async executeTransfer(params: {

    productId: string; fromWarehouseId: string; toWarehouseId: string;

    quantity: number; reason: string; userId: string; productName: string;

  }) {

    const { productId, fromWarehouseId, toWarehouseId, quantity, reason, userId, productName } = params;



    return prisma.$transaction(async (tx) => {

      const fromStock = await tx.stock.findFirst({ where: { productId, warehouseId: fromWarehouseId } });

      if (!fromStock) throw new AppError('Insufficient stock', 400);



      const deductResult = await tx.stock.updateMany({

        where: { id: fromStock.id, quantity: { gte: quantity } },

        data: { quantity: { decrement: quantity } },

      });

      if (deductResult.count === 0) throw new AppError('Insufficient stock', 400);



      await tx.stockMovement.create({

        data: { stockId: fromStock.id, type: 'TRANSFER', quantity, notes: reason, createdBy: userId },

      });



      let toStock = await tx.stock.findFirst({ where: { productId, warehouseId: toWarehouseId } });

      if (toStock) {

        await tx.stock.update({ where: { id: toStock.id }, data: { quantity: { increment: quantity } } });

      } else {

        toStock = await tx.stock.create({ data: { productId, warehouseId: toWarehouseId, quantity } });

      }

      await tx.stockMovement.create({

        data: { stockId: toStock.id, type: 'IN', quantity, notes: `Transfer: ${reason}`, createdBy: userId },

      });



      await writeAuditLog({

        action: 'TRANSFER', module: 'INVENTORY', entityId: productId,

        details: `Transferred ${quantity} units of ${productName}. Reason: ${reason}`,

      }, { userId });



      return { success: true };

    });

  }



  async executeApproval(approval: {

    id: string;

    businessId: string;

    requesterId: string;

    type: string;

    productId: string | null;

    payload: string;

  }) {

    const payload = JSON.parse(approval.payload) as Record<string, unknown>;

    const product = approval.productId

      ? await assertProductInBusiness(approval.productId, approval.businessId)

      : null;

    if (!product) throw new AppError('Product not found for approval', 404);



    if (approval.type === 'ADJUSTMENT') {

      return this.executeAdjust({

        productId: payload.productId as string,

        warehouseId: payload.warehouseId as string,

        quantity: payload.quantity as number,

        type: payload.type as string,

        reason: payload.reason as string ?? 'Approved adjustment',

        notes: payload.notes as string | undefined,

        userId: approval.requesterId,

        businessId: approval.businessId,

        productName: product.name,

      });

    }



    if (approval.type === 'TRANSFER') {

      return this.executeTransfer({

        productId: payload.productId as string,

        fromWarehouseId: payload.fromWarehouseId as string,

        toWarehouseId: payload.toWarehouseId as string,

        quantity: payload.quantity as number,

        reason: payload.reason as string ?? 'Approved transfer',

        userId: approval.requesterId,

        productName: product.name,

      });

    }



    throw new AppError('Unknown approval type', 400);

  }



  async getWarehouses(businessId: string) {

    return prisma.warehouse.findMany({ where: { businessId, isActive: true }, orderBy: { name: 'asc' } });

  }



  async getSummary(businessId: string) {

    const products = await prisma.product.findMany({

      where: { businessId, isActive: true, trackStock: true },

      include: { stocks: true },

    });



    const totalItems = products.length;

    const totalUnits = products.reduce((s, p) => s + p.stocks.reduce((ss, st) => ss + st.quantity, 0), 0);

    const totalValue = products.reduce(

      (s, p) => s + p.stocks.reduce((ss, st) => ss + st.quantity, 0) * p.costPrice,

      0

    );

    const lowStock = products.filter(

      (p) => p.stocks.reduce((ss, st) => ss + st.quantity, 0) <= p.minStock

    ).length;



    return { totalItems, totalUnits, totalValue, lowStock };

  }

}



export const inventoryService = new InventoryService();


