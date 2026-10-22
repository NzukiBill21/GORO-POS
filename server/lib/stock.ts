import { Prisma } from '@prisma/client';
import { AppError } from './errors.js';
import { stockAvailabilityWhere } from './stockScope.js';
import { allowsNegativeStock } from './businessSettings.js';

export async function deductStock(
  tx: Prisma.TransactionClient,
  params: {
    businessId: string;
    productId: string;
    variantId?: string | null;
    quantity: number;
    reference: string;
    userId: string;
    branchId?: string;
  }
) {
  const { businessId, productId, variantId, quantity, reference, userId, branchId } = params;

  const stocks = await tx.stock.findMany({
    where: stockAvailabilityWhere({ productId, variantId, branchId }),
    orderBy: { quantity: 'desc' },
  });

  if (stocks.length === 0) {
    throw new AppError('No stock record for product — add inventory before selling', 400);
  }

  const available = stocks.reduce((sum, s) => sum + s.quantity, 0);
  const allowNegative = await allowsNegativeStock(businessId);
  if (!allowNegative && available < quantity) {
    throw new AppError('Insufficient stock for one or more items', 400);
  }

  let remaining = quantity;
  for (const stock of stocks) {
    if (remaining <= 0) break;
    const deduct = allowNegative ? remaining : Math.min(stock.quantity, remaining);
    if (!allowNegative && deduct <= 0) continue;

    const result = await tx.stock.updateMany({
      where: allowNegative
        ? { id: stock.id }
        : { id: stock.id, quantity: { gte: deduct } },
      data: { quantity: { decrement: deduct } },
    });
    if (result.count === 0 && !allowNegative) {
      throw new AppError('Stock update conflict, please retry', 409);
    }
    await tx.stockMovement.create({
      data: { stockId: stock.id, type: 'OUT', quantity: deduct, reference, createdBy: userId },
    });
    remaining -= deduct;
  }

  if (remaining > 0 && allowNegative) {
    const target = stocks[0];
    await tx.stock.update({
      where: { id: target.id },
      data: { quantity: { decrement: remaining } },
    });
    await tx.stockMovement.create({
      data: { stockId: target.id, type: 'OUT', quantity: remaining, reference, createdBy: userId },
    });
  }
}

export async function restoreStock(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    reference: string;
    userId: string;
    movementType?: string;
    branchId?: string;
  }
) {
  const { productId, variantId, quantity, reference, userId, movementType = 'RETURN', branchId } = params;

  const stocks = await tx.stock.findMany({
    where: stockAvailabilityWhere({ productId, variantId, branchId }),
    orderBy: { quantity: 'desc' },
  });

  if (stocks.length === 0) {
    throw new AppError('No stock record found to restore inventory', 400);
  }

  const target = stocks[0];
  await tx.stock.update({
    where: { id: target.id },
    data: { quantity: { increment: quantity } },
  });
  await tx.stockMovement.create({
    data: { stockId: target.id, type: movementType, quantity, reference, createdBy: userId },
  });
}
