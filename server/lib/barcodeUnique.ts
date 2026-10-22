import { prisma } from './prisma.js';
import { AppError } from './errors.js';

/** One barcode maps to exactly one sellable product or variant within a tenant. */
export async function assertBarcodeUniqueInBusiness(
  businessId: string,
  barcode: string | null | undefined,
  opts?: { excludeProductId?: string; excludeVariantId?: string }
) {
  const code = barcode?.trim();
  if (!code) return;

  const productHit = await prisma.product.findFirst({
    where: {
      businessId,
      barcode: code,
      isActive: true,
      ...(opts?.excludeProductId ? { NOT: { id: opts.excludeProductId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (productHit) {
    throw new AppError(`Barcode already used by product "${productHit.name}"`, 409);
  }

  const variantHit = await prisma.variant.findFirst({
    where: {
      barcode: code,
      isActive: true,
      ...(opts?.excludeVariantId ? { NOT: { id: opts.excludeVariantId } } : {}),
      product: { businessId, isActive: true },
    },
    select: { id: true, name: true, product: { select: { name: true } } },
  });
  if (variantHit) {
    throw new AppError(
      `Barcode already used by variant "${variantHit.name}" (${variantHit.product.name})`,
      409
    );
  }
}

export async function findBarcodeOwner(
  businessId: string,
  barcode: string
): Promise<{ kind: 'product'; id: string } | { kind: 'variant'; id: string } | null> {
  const code = barcode.trim();
  if (!code) return null;

  const product = await prisma.product.findFirst({
    where: { businessId, barcode: code, isActive: true },
    select: { id: true },
  });
  if (product) return { kind: 'product', id: product.id };

  const variant = await prisma.variant.findFirst({
    where: { barcode: code, isActive: true, product: { businessId, isActive: true } },
    select: { id: true },
  });
  if (variant) return { kind: 'variant', id: variant.id };

  return null;
}
