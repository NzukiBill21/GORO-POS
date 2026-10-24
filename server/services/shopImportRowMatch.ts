import { prisma } from '../lib/prisma.js';
import type { ParsedProductRow } from './shopImportExcelParser.js';

export type ResolvedImportRow = {
  product: { id: string; sku: string | null; name: string } | null;
  variant: { id: string; productId: string; sku: string | null } | null;
};

/** Same lookup order as commitProductImport: variant SKU globally, else product by SKU, else product by name. */
export async function resolveImportRowTarget(
  businessId: string,
  row: ParsedProductRow
): Promise<ResolvedImportRow> {
  const vSku = row.variantSku?.trim();
  const pSku = row.productSku?.trim();

  if (vSku) {
    const variant = await prisma.variant.findFirst({
      where: { sku: vSku, product: { businessId, isActive: true } },
      select: { id: true, productId: true, sku: true, product: { select: { id: true, sku: true, name: true } } },
    });
    if (variant) {
      return {
        variant: { id: variant.id, productId: variant.productId, sku: variant.sku },
        product: variant.product,
      };
    }
  }

  let product = pSku
    ? await prisma.product.findFirst({
        where: { businessId, sku: pSku, isActive: true },
        select: { id: true, sku: true, name: true },
      })
    : await prisma.product.findFirst({
        where: { businessId, name: row.productName.trim(), isActive: true },
        select: { id: true, sku: true, name: true },
      });

  if (!product) return { product: null, variant: null };

  if (vSku) {
    const variant = await prisma.variant.findFirst({
      where: { productId: product.id, sku: vSku, isActive: true },
      select: { id: true, productId: true, sku: true },
    });
    return {
      product,
      variant: variant
        ? { id: variant.id, productId: variant.productId, sku: variant.sku }
        : null,
    };
  }

  return { product, variant: null };
}

/** Row matches an existing catalogue line (create-only skip). */
export function rowMatchesExisting(target: ResolvedImportRow, row: ParsedProductRow): boolean {
  const vSku = row.variantSku?.trim();
  if (vSku) return target.variant != null;
  const pSku = row.productSku?.trim();
  if (pSku && !vSku) return target.product != null && target.product.sku === pSku;
  return false;
}

export async function assertVariantSkuProductConsistency(
  businessId: string,
  row: ParsedProductRow
): Promise<string | null> {
  const vSku = row.variantSku?.trim();
  const pSku = row.productSku?.trim();
  if (!vSku || !pSku) return null;

  const variant = await prisma.variant.findFirst({
    where: { sku: vSku, product: { businessId } },
    select: { productId: true, product: { select: { sku: true } } },
  });
  if (!variant) return null;

  const productBySku = await prisma.product.findFirst({
    where: { businessId, sku: pSku },
    select: { id: true },
  });
  if (productBySku && productBySku.id !== variant.productId) {
    return 'Variant SKU already belongs to a different product';
  }
  if (variant.product.sku && variant.product.sku !== pSku) {
    return 'Variant SKU already belongs to a different product';
  }
  return null;
}
