import { prisma } from '../../server/lib/prisma.js';

/** POS integration tests deplete demo stock; restore a floor without bypassing stock validation logic. */
export async function ensureProductStockForPosTests(params: {
  businessId: string;
  branchId: string;
  productId: string;
  minQuantity?: number;
}) {
  const minQuantity = params.minQuantity ?? 100;
  const warehouse = await prisma.warehouse.findFirst({ where: { businessId: params.businessId } });
  if (!warehouse) throw new Error('No warehouse for POS test tenant');

  const stock = await prisma.stock.findFirst({
    where: {
      productId: params.productId,
      branchId: params.branchId,
      variantId: null,
    },
  });

  if (!stock) {
    await prisma.stock.create({
      data: {
        productId: params.productId,
        warehouseId: warehouse.id,
        branchId: params.branchId,
        quantity: minQuantity,
      },
    });
    return;
  }

  if (stock.quantity < minQuantity) {
    await prisma.stock.update({
      where: { id: stock.id },
      data: { quantity: minQuantity },
    });
  }
}
