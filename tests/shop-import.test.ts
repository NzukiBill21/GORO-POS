import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseProductSheetRows,
  parseOpeningStockSheetRows,
  readWorkbookSheet,
  type SheetDataRow,
} from '../server/services/shopImportExcelParser.js';
import {
  resetShopImportTestDatabase,
  loadShopImportModules,
  seedShopImportTenant,
  restoreDefaultTestDatabase,
  SHOP_IMPORT_TEST_DB,
} from './helpers/shopImportTestDb.js';
import fs from 'fs';

function sheetRow(excelRowNumber: number, cells: Record<string, string>): SheetDataRow {
  return { excelRowNumber, cells };
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
    const { rows, sheetName } = readWorkbookSheet(buf, ['PRODUCTS'], (r) => r.length);
    expect(sheetName).toBe('Product list');
    const parsed = parseProductSheetRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].productName).toBe('Test Shirt');
    expect(parsed[0].rowNumber).toBe(3);
  });

  it('parses product rows with variant SKU', () => {
    const rows = parseProductSheetRows([
      sheetRow(5, {
        'product name': 'Ladies suit',
        'product sku': 'SUIT-01',
        'variant sku': 'SUIT-01-M-BLK',
        size: 'M',
        color: 'Black',
        'selling price': '4500',
        'cost price': '3000',
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].variantSku).toBe('SUIT-01-M-BLK');
    expect(rows[0].sellingPrice).toBe(4500);
    expect(rows[0].rowNumber).toBe(5);
  });
});

describe('shop import integration (isolated SQLite)', () => {
  let prisma: Awaited<ReturnType<typeof loadShopImportModules>>['prisma'];
  let shopImport: Awaited<ReturnType<typeof loadShopImportModules>>['shopImport'];
  let productService: Awaited<ReturnType<typeof loadShopImportModules>>['productService'];
  let findBarcodeOwner: Awaited<ReturnType<typeof loadShopImportModules>>['findBarcodeOwner'];
  let ctx: Awaited<ReturnType<typeof seedShopImportTenant>>;

  beforeAll(async () => {
    await resetShopImportTestDatabase();
    const mods = await loadShopImportModules();
    prisma = mods.prisma;
    shopImport = mods.shopImport;
    productService = mods.productService;
    findBarcodeOwner = mods.findBarcodeOwner;
    ctx = await seedShopImportTenant(prisma);
  }, 60_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    for (const f of [SHOP_IMPORT_TEST_DB, `${SHOP_IMPORT_TEST_DB}-wal`, `${SHOP_IMPORT_TEST_DB}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await restoreDefaultTestDatabase();
  });

  it('rejects duplicate barcodes in preview file', async () => {
    const parsed = parseProductSheetRows([
      sheetRow(2, { 'product name': 'A', barcode: 'DUP999', 'selling price': '10' }),
      sheetRow(3, { 'product name': 'B', barcode: 'DUP999', 'selling price': '20' }),
    ]);
    const preview = await shopImport.validateProductRows(ctx.businessId, parsed);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('imports products and idempotent opening stock', async () => {
    const key = `test-${Date.now()}`;
    const sku = `IMP-${Date.now()}`;

    const productRows = parseProductSheetRows([
      sheetRow(2, {
        'product name': `Import Test ${sku}`,
        'product sku': sku,
        'variant sku': `${sku}-V1`,
        size: 'M',
        'selling price': '100',
        'cost price': '60',
        brand: 'Test Brand Co',
      }),
    ]);

    const validated = await shopImport.validateProductRows(ctx.businessId, productRows);
    expect(validated.errors).toHaveLength(0);

    const commit1 = await shopImport.commitProductImport({
      businessId: ctx.businessId,
      userId: ctx.userId,
      idempotencyKey: `${key}-prod`,
      rows: validated.valid,
    });
    expect(commit1.productsCreated + commit1.productsUpdated).toBeGreaterThan(0);

    const product = await prisma.product.findFirst({
      where: { businessId: ctx.businessId, sku },
      include: { brand: true },
    });
    expect(product?.brand?.name).toBe('Test Brand Co');

    const stockRows = parseOpeningStockSheetRows([
      sheetRow(2, { 'variant sku': `${sku}-V1`, quantity: '5' }),
    ]);
    const stockPreview = await shopImport.validateOpeningStockRows(ctx.businessId, stockRows);
    expect(stockPreview.errors).toHaveLength(0);

    const stock1 = await shopImport.commitOpeningStockImport({
      businessId: ctx.businessId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      idempotencyKey: `${key}-stock`,
      rows: stockPreview.valid,
    });
    expect(stock1.linesApplied).toBe(1);
    expect(stock1.unitsAdded).toBe(5);

    const stock2 = await shopImport.commitOpeningStockImport({
      businessId: ctx.businessId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      idempotencyKey: `${key}-stock`,
      rows: stockPreview.valid,
    });
    expect(stock2.idempotentReplay).toBe(true);
  });

  it('rejects commit without idempotency key', async () => {
    const rows = parseProductSheetRows([sheetRow(2, { 'product name': 'X', 'selling price': '1' })]);
    const validated = await shopImport.validateProductRows(ctx.businessId, rows);
    await expect(
      shopImport.commitProductImport({
        businessId: ctx.businessId,
        userId: ctx.userId,
        idempotencyKey: '',
        rows: validated.valid,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('partial product commit imports only valid rows from a mixed batch', async () => {
    const sku = `PART-${Date.now()}`;
    const parsed = parseProductSheetRows([
      sheetRow(2, {
        'product name': `Partial OK ${sku}`,
        'product sku': sku,
        'variant sku': `${sku}-V1`,
        'selling price': '50',
      }),
      sheetRow(3, { 'product name': 'Bad row', 'selling price': 'not-a-number' }),
    ]);
    const preview = await shopImport.validateProductRows(ctx.businessId, parsed);
    expect(preview.valid).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);

    const commit = await shopImport.commitProductImport({
      businessId: ctx.businessId,
      userId: ctx.userId,
      idempotencyKey: `partial-${Date.now()}`,
      rows: preview.valid,
      partial: true,
    });
    expect(commit.partial).toBe(true);
    expect(commit.productsCreated).toBeGreaterThan(0);

    const created = await prisma.product.findFirst({ where: { businessId: ctx.businessId, sku } });
    expect(created).toBeTruthy();
  });

  it('errors when variant SKU belongs to a different product', async () => {
    const existing = await prisma.product.create({
      data: {
        businessId: ctx.businessId,
        name: 'Parent A',
        sku: 'PARENT-A',
        sellingPrice: 10,
        costPrice: 5,
        isActive: true,
      },
    });
    await prisma.variant.create({
      data: {
        productId: existing.id,
        name: 'V1',
        sku: 'SHARED-V-SKU',
        sellingPrice: 10,
        isActive: true,
      },
    });
    const parsed = parseProductSheetRows([
      sheetRow(9, {
        'product name': 'Parent B',
        'product sku': 'PARENT-B',
        'variant sku': 'SHARED-V-SKU',
        'selling price': '20',
      }),
    ]);
    const preview = await shopImport.validateProductRows(ctx.businessId, parsed);
    expect(preview.errors[0]?.message).toContain('Variant SKU already belongs to a different product');
    await prisma.variant.deleteMany({ where: { productId: existing.id } });
    await prisma.product.delete({ where: { id: existing.id } });
  });

  it('create-and-update commit updates existing variant without barcode error', async () => {
    const sku = `UPD-${Date.now()}`;
    const bc = `BC${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        businessId: ctx.businessId,
        name: `Update Test ${sku}`,
        sku,
        sellingPrice: 50,
        costPrice: 30,
        isActive: true,
      },
    });
    await prisma.variant.create({
      data: {
        productId: product.id,
        name: 'M',
        sku: `${sku}-V1`,
        barcode: bc,
        sellingPrice: 50,
        isActive: true,
      },
    });

    const parsed = parseProductSheetRows([
      sheetRow(2, {
        'product name': `Update Test ${sku}`,
        'product sku': sku,
        'variant sku': `${sku}-V1`,
        barcode: bc,
        'selling price': '99',
        'cost price': '40',
      }),
    ]);
    const preview = await shopImport.validateProductRows(ctx.businessId, parsed, {
      importMode: 'create-and-update',
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.valid[0]?.disposition).toBe('update');

    const commit = await shopImport.commitProductImport({
      businessId: ctx.businessId,
      userId: ctx.userId,
      idempotencyKey: `upd-${Date.now()}`,
      rows: preview.valid,
      importMode: 'create-and-update',
    });
    expect(commit.variantsUpdated).toBeGreaterThan(0);

    const updated = await prisma.variant.findFirst({ where: { sku: `${sku}-V1` } });
    expect(updated?.sellingPrice).toBe(99);

    await prisma.variant.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('resolves variant barcode via productService', async () => {
    const bc = `TSTBC${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        businessId: ctx.businessId,
        name: `Barcode Test ${bc}`,
        sellingPrice: 50,
        costPrice: 30,
        isActive: true,
      },
    });
    await productService.createVariant(product.id, ctx.businessId, ctx.userId, {
      name: 'Size 39',
      sku: `V-${bc}`,
      barcode: bc,
      sellingPrice: 50,
    });
    const owner = await findBarcodeOwner(ctx.businessId, bc);
    expect(owner?.kind).toBe('variant');
    const hit = await productService.getByBarcode(bc, ctx.businessId);
    expect(hit.matchedVariantId).toBeTruthy();
    await prisma.variant.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });
});
