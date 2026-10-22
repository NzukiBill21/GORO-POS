import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseProductSheetRows,
  parseOpeningStockSheetRows,
  readWorkbookSheet,
} from '../server/services/shopImportExcelParser.js';
import {
  validateProductRows,
  commitProductImport,
  commitOpeningStockImport,
} from '../server/services/shopImportService.js';
import { findBarcodeOwner } from '../server/lib/barcodeUnique.js';
import { prisma } from '../server/lib/prisma.js';
import { productService } from '../server/services/productService.js';

function workbookBuffer(sheets: Record<string, Record<string, string>[]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('shop import parser', () => {
  it('parses products when header is not on row 1', () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      ['Shop catalogue — do not import this title row'],
      ['Product name', 'Product SKU', 'Variant SKU', 'Selling price'],
      ['Test Shirt', 'SH-1', 'SH-1-M', '1200'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Product list');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const { rows, sheetName } = readWorkbookSheet(buf, ['PRODUCTS'], (r: Record<string, string>[]) =>
      parseProductSheetRows(r).length
    );
    expect(sheetName).toBe('Product list');
    const parsed = parseProductSheetRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].productName).toBe('Test Shirt');
  });

  it('parses product rows with variant SKU', () => {
    const rows = parseProductSheetRows([
      {
        'product name': 'Ladies suit',
        'product sku': 'SUIT-01',
        'variant sku': 'SUIT-01-M-BLK',
        size: 'M',
        color: 'Black',
        'selling price': '4500',
        'cost price': '3000',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].variantSku).toBe('SUIT-01-M-BLK');
    expect(rows[0].sellingPrice).toBe(4500);
  });

  it('rejects duplicate barcodes in preview file', async () => {
    const business = await prisma.business.findFirst();
    const parsed = parseProductSheetRows([
      {
        'product name': 'A',
        barcode: 'DUP999',
        'selling price': '10',
      },
      {
        'product name': 'B',
        barcode: 'DUP999',
        'selling price': '20',
      },
    ]);
    const preview = await validateProductRows(business!.id, parsed);
    expect(preview.errors.length).toBeGreaterThan(0);
  });
});

describe('shop import commit', () => {
  it('imports products and idempotent opening stock', async () => {
    const business = await prisma.business.findFirst();
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });
    const branch = await prisma.branch.findFirst({ where: { businessId: business!.id } });
    const key = `test-${Date.now()}`;
    const sku = `IMP-${Date.now()}`;

    const productRows = parseProductSheetRows([
      {
        'product name': `Import Test ${sku}`,
        'product sku': sku,
        'variant sku': `${sku}-V1`,
        size: 'M',
        'selling price': '100',
        'cost price': '60',
      },
    ]);

    const commit1 = await commitProductImport({
      businessId: business!.id,
      userId: user!.id,
      idempotencyKey: `${key}-prod`,
      rows: productRows,
    });
    expect(commit1.productsCreated + commit1.productsUpdated).toBeGreaterThan(0);

    const stockRows = parseOpeningStockSheetRows([
      {
        'variant sku': `${sku}-V1`,
        quantity: '5',
      },
    ]);

    const stock1 = await commitOpeningStockImport({
      businessId: business!.id,
      userId: user!.id,
      branchId: branch!.id,
      idempotencyKey: `${key}-stock`,
      rows: stockRows,
    });
    expect(stock1.linesApplied).toBe(1);
    expect(stock1.unitsAdded).toBe(5);

    const stock2 = await commitOpeningStockImport({
      businessId: business!.id,
      userId: user!.id,
      branchId: branch!.id,
      idempotencyKey: `${key}-stock`,
      rows: stockRows,
    });
    expect(stock2.idempotentReplay).toBe(true);
  });
});

describe('shop import commit validation', () => {
  it('rejects commit without idempotency key', async () => {
    const business = await prisma.business.findFirst();
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });
    const rows = parseProductSheetRows([
      { 'product name': 'X', 'selling price': '1' },
    ]);
    await expect(
      commitProductImport({
        businessId: business!.id,
        userId: user!.id,
        idempotencyKey: '',
        rows,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('barcode lookup', () => {
  it('resolves variant barcode via productService', async () => {
    const business = await prisma.business.findFirst();
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });
    const bc = `TSTBC${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        businessId: business!.id,
        name: `Barcode Test ${bc}`,
        sellingPrice: 50,
        costPrice: 30,
        isActive: true,
      },
    });
    const variant = await productService.createVariant(product.id, business!.id, user!.id, {
      name: 'Size 39',
      sku: `V-${bc}`,
      barcode: bc,
      sellingPrice: 50,
    });
    void variant;
    const owner = await findBarcodeOwner(business!.id, bc);
    expect(owner?.kind).toBe('variant');
    const hit = await productService.getByBarcode(bc, business!.id);
    expect(hit.matchedVariantId).toBeTruthy();
  });
});
