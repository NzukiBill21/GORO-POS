import { describe, it, expect } from 'vitest';
import { productService } from '../server/services/productService.js';
import { prisma } from '../server/lib/prisma.js';
import { sanitizePrintHtml } from '../src/lib/sanitizePrint.ts';

describe('barcode lookup', () => {
  it('scopes barcode to business', async () => {
    const business = await prisma.business.findFirst();
    const product = await prisma.product.findFirst({
      where: { businessId: business!.id, barcode: { not: null } },
    });
    if (!product?.barcode) return;

    const found = await productService.getByBarcode(product.barcode, business!.id);
    expect(found.id).toBe(product.id);

    await expect(productService.getByBarcode(product.barcode, '00000000-0000-4000-8000-000000000099')).rejects.toThrow(
      /not found/i
    );
  });

  it('trims scan input', async () => {
    const business = await prisma.business.findFirst();
    const product = await prisma.product.findFirst({
      where: { businessId: business!.id, barcode: { not: null } },
    });
    if (!product?.barcode) return;

    const found = await productService.getByBarcode(`  ${product.barcode}  `, business!.id);
    expect(found.id).toBe(product.id);
  });
});

describe('print sanitize', () => {
  it('strips script tags from receipt html', () => {
    const out = sanitizePrintHtml('<p>OK</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('OK');
  });
});
