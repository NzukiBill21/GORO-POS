import type { Prisma } from '@prisma/client';

/** Stock rows visible for POS/inventory when a cashier branch is set (includes legacy null branchId). */
export function stockAvailabilityWhere(params: {
  productId: string;
  variantId?: string | null;
  branchId?: string | null;
}): Prisma.StockWhereInput {
  const { productId, variantId, branchId } = params;
  const where: Prisma.StockWhereInput = { productId };

  if (variantId) {
    where.variantId = variantId;
  }

  if (branchId) {
    where.OR = [{ branchId }, { branchId: null }];
  }

  return where;
}
