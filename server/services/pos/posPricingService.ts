import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { stockAvailabilityWhere } from '../../lib/stockScope.js';
import { allowsNegativeStock } from '../../lib/businessSettings.js';

export interface QuoteLineInput {
  productId: string;
  variantId?: string;
  quantity: number;
  discount?: number;
}

export interface SaleQuote {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  taxRate: number;
  taxName: string;
  lines: Array<{
    productId: string;
    variantId?: string;
    name: string;
    sku?: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    taxCents: number;
    costPriceCents: number;
  }>;
}

function toCents(amount: number): number {
  return Math.round(amount);
}

export async function resolveDefaultTaxRate(businessId: string): Promise<{ rate: number; name: string }> {
  const defaultTax = await prisma.tax.findFirst({
    where: { businessId, isDefault: true, isActive: true },
  });
  if (defaultTax) {
    return { rate: defaultTax.rate / 100, name: defaultTax.name };
  }
  const anyTax = await prisma.tax.findFirst({ where: { businessId, isActive: true } });
  if (anyTax) {
    return { rate: anyTax.rate / 100, name: anyTax.name };
  }
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { country: true },
  });
  const country = (business?.country ?? '').trim().toLowerCase();
  if (country === 'kenya' || country === 'ke') {
    return { rate: 0.16, name: 'VAT' };
  }
  return { rate: 0, name: 'None' };
}

async function availableStock(productId: string, variantId?: string, branchId?: string): Promise<number> {
  const stocks = await prisma.stock.findMany({
    where: stockAvailabilityWhere({ productId, variantId, branchId }),
  });
  return stocks.reduce((s, st) => s + st.quantity, 0);
}

/** Server-side pricing — POS must not trust client totals */
export async function calculateSaleQuote(
  businessId: string,
  params: {
    items: QuoteLineInput[];
    discountAmount?: number;
    taxRate?: number;
    branchId?: string;
    validateStock?: boolean;
  }
): Promise<SaleQuote> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new AppError('Business not found', 404);

  const taxMeta = params.taxRate != null ? { rate: params.taxRate, name: 'Tax' } : await resolveDefaultTaxRate(businessId);
  const taxRate = taxMeta.rate;
  const discountCents = toCents(params.discountAmount ?? 0);

  const lines: SaleQuote['lines'] = [];
  let subtotalCents = 0;

  for (const item of params.items) {
    const product = await prisma.product.findFirst({
      where: { id: item.productId, businessId, isActive: true },
    });
    if (!product) throw new AppError(`Product not found: ${item.productId}`, 400);

    let unitPrice = product.sellingPrice;
    let costPrice = product.costPrice;
    let sku = product.sku ?? undefined;
    let lineName = product.name;

    if (item.variantId) {
      const variant = await prisma.variant.findFirst({
        where: { id: item.variantId, productId: product.id, isActive: true },
      });
      if (!variant) throw new AppError('Variant not found', 400);
      unitPrice = variant.sellingPrice ?? unitPrice;
      costPrice = variant.costPrice ?? costPrice;
      sku = variant.sku ?? sku;
      lineName = `${product.name} (${variant.name})`;
    }

    if (params.validateStock && product.trackStock) {
      const avail = await availableStock(product.id, item.variantId, params.branchId);
      const allowNegative = await allowsNegativeStock(businessId);
      if (!allowNegative && avail < item.quantity) {
        throw new AppError(`Insufficient stock for ${lineName} (available ${avail})`, 400);
      }
    }

    const unitPriceCents = toCents(unitPrice);
    const costPriceCents = toCents(costPrice);
    const lineDiscount = toCents(item.discount ?? 0);
    const lineTotalCents = unitPriceCents * item.quantity - lineDiscount;
    const lineTaxCents = Math.round(lineTotalCents * taxRate);

    subtotalCents += lineTotalCents;
    lines.push({
      productId: product.id,
      variantId: item.variantId,
      name: lineName,
      sku,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents,
      taxCents: lineTaxCents,
      costPriceCents,
    });
  }

  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents + taxCents - discountCents;

  if (totalCents < 0) throw new AppError('Invalid total', 400);

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    currency: business.currency,
    taxRate,
    taxName: taxMeta.name,
    lines,
  };
}

export function centsToMajor(cents: number): number {
  return cents;
}
