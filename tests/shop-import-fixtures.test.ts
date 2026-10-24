/**
 * Runs the REAL shopImportExcelParser + shopImportService preview/validation code against the
 * fixture workbooks in tests/fixtures/shop-import/. Prisma is replaced by a small in-memory fake
 * (no DB is touched), so this verifies parsing + validation rules but NOT the DB commit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

type Row = Record<string, any>;
const store = vi.hoisted(() => ({ products: [] as Row[], variants: [] as Row[] }));
const match = (r: Row, w: Row = {}) =>
  ['barcode', 'sku', 'name'].every((k) => w[k] === undefined || r[k] === w[k]);

vi.mock('../server/lib/prisma.js', () => ({
  prisma: {
    product: {
      findFirst: async ({ where }: Row) => {
        if (where.barcode) {
          const p = store.products.find((x) => x.barcode === where.barcode);
          return p ? { id: p.id } : null;
        }
        if (where.sku) {
          const p = store.products.find((x) => x.sku === where.sku);
          return p ? { id: p.id, sku: p.sku, name: p.name } : null;
        }
        if (where.name) {
          const p = store.products.find((x) => x.name === where.name);
          return p ? { id: p.id, sku: p.sku, name: p.name } : null;
        }
        const p = store.products.find((x) => match(x, where));
        return p ? { ...p, variants: store.variants.filter((v) => v.productId === p.id) } : null;
      },
    },
    variant: {
      findFirst: async ({ where }: Row) => {
        if (where.barcode) {
          const v = store.variants.find((x) => x.barcode === where.barcode);
          return v ? { id: v.id } : null;
        }
        if (where.sku) {
          const v = store.variants.find((x) => x.sku === where.sku);
          if (!v) return null;
          const p = store.products.find((pr) => pr.id === v.productId);
          return {
            id: v.id,
            productId: v.productId,
            sku: v.sku,
            product: p ? { id: p.id, sku: p.sku, name: p.name } : { id: v.productId, sku: null, name: '' },
          };
        }
        if (where.productId && where.sku) {
          return store.variants.find((v) => v.productId === where.productId && v.sku === where.sku) ?? null;
        }
        return store.variants.find((v) => match(v, where)) ?? null;
      },
    },
    stockMovement: { findFirst: async () => null },
  },
}));
vi.mock('../server/lib/audit.js', () => ({ logActivity: async () => {} }));

import { previewProductsFromBuffer, previewOpeningStockFromBuffer } from '../server/services/shopImportService.js';
import { parseProductSheetRows, readWorkbookSheet } from '../server/services/shopImportExcelParser.js';

const dir = path.join(__dirname, 'fixtures', 'shop-import');
const load = (f: string) => fs.readFileSync(path.join(dir, f));
const VALID = 'GOROVIAN_POS_Mock_Products_Valid.xlsx';
const TESTS = 'GOROVIAN_POS_Mock_Products_Validation_Tests.xlsx';
const sheetRows = (f: string, s: string) =>
  XLSX.utils.sheet_to_json<Row>(XLSX.read(load(f), { type: 'buffer' }).Sheets[s], { defval: '' });

function seedCatalogue(buf: Buffer) {
  const { rows } = readWorkbookSheet(buf, ['PRODUCTS'], (r) => r.length);
  const parents = new Map<string, string>();
  for (const r of parseProductSheetRows(rows)) {
    if (!parents.has(r.productSku!)) {
      parents.set(r.productSku!, `p-${parents.size}`);
      store.products.push({ id: parents.get(r.productSku!), sku: r.productSku, name: r.productName });
    }
    store.variants.push({
      id: `v-${store.variants.length}`,
      productId: parents.get(r.productSku!),
      sku: r.variantSku,
      barcode: r.barcode,
    });
  }
}
beforeEach(() => {
  store.products.length = 0;
  store.variants.length = 0;
});

describe('valid fixture', () => {
  it('parses every row with the importer headers and no errors', async () => {
    const res = await previewProductsFromBuffer('biz', load(VALID));
    expect(res.meta?.sheetUsed).toBe('PRODUCTS');
    expect(res.stats).toEqual({
      totalRows: 77,
      validCount: 77,
      errorCount: 0,
      warningCount: 0,
      newCount: 77,
      updateCount: 0,
      skippedCount: 0,
    });
    expect(res.importMode).toBe('create-only');
    expect(res.skipped).toEqual([]);
    const v = res.valid;
    expect(new Set(v.map((r) => r.variantSku)).size).toBe(77);
    expect(new Set(v.map((r) => r.barcode)).size).toBe(77);
    expect(new Set(v.map((r) => r.productSku)).size).toBe(23);
    expect(new Set(v.map((r) => r.category)).size).toBe(11);
    expect(v.every((r) => r.sellingPrice > r.costPrice && r.costPrice > 0 && r.minStock > 0)).toBe(true);
    expect(v.every((r) => r.variantName && r.unit && r.brand)).toBe(true);
  });
  it('opening stock needs products first, then validates cleanly', async () => {
    const before = await previewOpeningStockFromBuffer('biz', load(VALID));
    expect(before.meta?.sheetUsed).toBe('OPENING STOCK');
    expect(before.stats.totalRows).toBe(77);
    expect(before.stats.errorCount).toBe(77);
    seedCatalogue(load(VALID));
    const after = await previewOpeningStockFromBuffer('biz', load(VALID));
    expect(after.stats.errorCount).toBe(0);
    expect(after.stats.validCount).toBe(77);
  });
  it('re-import create-only skips existing rows without errors', async () => {
    seedCatalogue(load(VALID));
    const res = await previewProductsFromBuffer('biz', load(VALID), { importMode: 'create-only' });
    expect(res.stats.errorCount).toBe(0);
    expect(res.stats.skippedCount).toBe(77);
    expect(res.valid).toHaveLength(0);
  });
  it('re-import create-and-update treats rows as updates (own barcode allowed)', async () => {
    seedCatalogue(load(VALID));
    const res = await previewProductsFromBuffer('biz', load(VALID), { importMode: 'create-and-update' });
    expect(res.stats.errorCount).toBe(0);
    expect(res.stats.updateCount).toBe(77);
    expect(res.stats.newCount).toBe(0);
    expect(res.valid.every((r) => r.disposition === 'update')).toBe(true);
  });
});

describe('validation fixture', () => {
  it('rejects exactly the rows documented as rejected', async () => {
    const res = await previewProductsFromBuffer('biz', load(TESTS));
    const exp = sheetRows(TESTS, 'EXPECTED RESULTS');
    const rejected = exp
      .filter((e) => /rejected/i.test(String(e['Expected importer response'])))
      .map((e) => e['Excel row']);
    expect(res.errors.map((e) => e.rowNumber).sort((a, b) => a - b)).toEqual(rejected.sort((a, b) => a - b));
    const msg = (id: string) =>
      res.errors.find((e) => e.rowNumber === exp.find((x) => x['Test ID'] === id)!['Excel row'])!.message;
    expect(msg('E01')).toContain('Duplicate variant SKU in file');
    expect(msg('E02')).toContain('Duplicate barcode in file');
    expect(msg('E03')).toContain('Cost price cannot be negative');
    expect(msg('E04')).toContain('Selling price cannot be negative');
    expect(msg('E05')).toMatch(
      /Duplicate barcode in file.*; .*Selling price cannot be negative|Selling price cannot be negative.*; .*Duplicate barcode/
    );
    expect(msg('E06')).toContain('Duplicate product SKU in file');
    expect(msg('G01')).toContain('Product name is required');
    expect(msg('G03')).toContain('Selling price must be a number');
    expect(msg('G04')).toContain('Selling price must be a number');
    expect(msg('G06')).toContain('Min stock cannot be negative');
    expect(msg('G07')).toContain('Cost price must be a number');
  });
  it('control rows and warning-only gap rows are valid', async () => {
    const res = await previewProductsFromBuffer('biz', load(TESTS));
    const exp = sheetRows(TESTS, 'EXPECTED RESULTS');
    const ctl = exp
      .filter((e) => e['Type'] === 'VALID' && /^V\d+$/.test(e['Test ID']))
      .map((e) => e['Excel row']);
    expect(ctl).toHaveLength(8);
    expect(res.errors.some((e) => ctl.includes(e.rowNumber))).toBe(false);
    const g02 = exp.find((x) => x['Test ID'] === 'G02')!['Excel row'];
    const g05 = exp.find((x) => x['Test ID'] === 'G05')!['Excel row'];
    expect(res.errors.some((e) => e.rowNumber === g02)).toBe(false);
    expect(res.errors.some((e) => e.rowNumber === g05)).toBe(false);
    expect(res.warnings.some((w) => w.rowNumber === g02 && /category/i.test(w.message))).toBe(true);
    expect(res.warnings.some((w) => w.rowNumber === g05 && /Default/i.test(w.message))).toBe(true);
  });
  it('counts all product data rows including G01', async () => {
    const res = await previewProductsFromBuffer('biz', load(TESTS));
    expect(res.stats.totalRows).toBe(22);
  });
  it('supports partial UI commit: valid and error rows coexist', async () => {
    const res = await previewProductsFromBuffer('biz', load(TESTS));
    expect(res.stats.validCount).toBeGreaterThan(0);
    expect(res.stats.errorCount).toBeGreaterThan(0);
    expect(res.valid.length + res.errors.length).toBeLessThanOrEqual(res.stats.totalRows);
  });
  it('opening stock validation: unknown/blank SKU and invalid quantities rejected', async () => {
    seedCatalogue(load(VALID));
    const res = await previewOpeningStockFromBuffer('biz', load(TESTS));
    expect(res.stats.totalRows).toBe(7);
    expect(res.errors.map((e) => e.rowNumber).sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8]);
    expect(res.valid.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});
