import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { findBarcodeOwner } from '../lib/barcodeUnique.js';
import { logActivity } from '../lib/audit.js';
import {
  parseOpeningStockSheetRows,
  parseProductSheetRows,
  readWorkbookSheet,
  type ParsedOpeningStockRow,
  type ParsedProductRow,
} from './shopImportExcelParser.js';
import {
  assertVariantSkuProductConsistency,
  resolveImportRowTarget,
  rowMatchesExisting,
} from './shopImportRowMatch.js';

export type ImportMode = 'create-only' | 'create-and-update';

export function normalizeImportMode(value: unknown): ImportMode {
  return value === 'create-and-update' ? 'create-and-update' : 'create-only';
}

export type ProductImportRow = ParsedProductRow & { disposition: 'new' | 'update' };

export type ImportRowError = { rowNumber: number; message: string };

export type ImportPreviewMeta = {
  sheetUsed: string;
  sheetNames: string[];
  hint?: string;
};

export type ProductPreviewResult = {
  valid: ProductImportRow[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  skipped: ImportRowError[];
  importMode: ImportMode;
  stats: {
    totalRows: number;
    validCount: number;
    errorCount: number;
    warningCount: number;
    newCount: number;
    updateCount: number;
    skippedCount: number;
  };
  meta?: ImportPreviewMeta;
};

export type OpeningStockPreviewResult = {
  valid: ParsedOpeningStockRow[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  stats: { totalRows: number; validCount: number; errorCount: number; warningCount: number };
  meta?: ImportPreviewMeta;
};

function zeroRowHint(kind: 'products' | 'opening-stock', meta: ImportPreviewMeta): string {
  const sheets = meta.sheetNames.length ? meta.sheetNames.join(', ') : '(none)';
  if (kind === 'products') {
    return `No product rows found on sheet "${meta.sheetUsed || '?'}". Use a tab named PRODUCTS (or similar) with a header row containing "Product name" and "Selling price". Workbook tabs: ${sheets}.`;
  }
  return `No opening stock rows on sheet "${meta.sheetUsed || '?'}". Use OPENING STOCK with Quantity plus Variant SKU or Product SKU. Tabs: ${sheets}.`;
}

function productKey(r: ParsedProductRow): string {
  return (r.productSku || r.productName).toLowerCase();
}

export async function previewProductsFromBuffer(
  businessId: string,
  buffer: Buffer,
  options?: { importMode?: ImportMode }
): Promise<ProductPreviewResult> {
  const importMode = normalizeImportMode(options?.importMode);
  const preferred = ['PRODUCTS', 'Products', 'products', 'Product catalogue', 'Catalogue'];
  const { sheetName, rows, sheetNames } = readWorkbookSheet(buffer, preferred, (r) => r.length);
  const parsed = parseProductSheetRows(rows);
  const meta: ImportPreviewMeta = { sheetUsed: sheetName, sheetNames };
  const result = await validateProductRows(businessId, parsed, { importMode });
  if (result.stats.totalRows === 0) {
    meta.hint = zeroRowHint('products', meta);
  }
  return { ...result, meta };
}

export async function previewOpeningStockFromBuffer(
  businessId: string,
  buffer: Buffer
): Promise<OpeningStockPreviewResult> {
  const preferred = ['OPENING STOCK', 'Opening Stock', 'opening stock'];
  const { sheetName, rows, sheetNames } = readWorkbookSheet(buffer, preferred, (r) => r.length);
  const parsed = parseOpeningStockSheetRows(rows);
  const meta: ImportPreviewMeta = { sheetUsed: sheetName, sheetNames };
  const result = await validateOpeningStockRows(businessId, parsed);
  if (result.stats.totalRows === 0) {
    meta.hint = zeroRowHint('opening-stock', meta);
  }
  return { ...result, meta };
}

function parseNumericCell(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

async function barcodeConflictsWithCatalogue(
  businessId: string,
  barcode: string,
  allow: { productId?: string; variantId?: string }
): Promise<boolean> {
  const owner = await findBarcodeOwner(businessId, barcode);
  if (!owner) return false;
  if (owner.kind === 'variant' && allow.variantId === owner.id) return false;
  if (owner.kind === 'product' && allow.productId === owner.id) return false;
  return true;
}

export async function validateProductRows(
  businessId: string,
  rows: ParsedProductRow[],
  options?: { importMode?: ImportMode }
): Promise<ProductPreviewResult> {
  const importMode = normalizeImportMode(options?.importMode);
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  const skipped: ImportRowError[] = [];
  const valid: ProductImportRow[] = [];
  const skuInFile = new Map<string, number>();
  const barcodeInFile = new Map<string, number>();
  let newCount = 0;
  let updateCount = 0;

  for (const row of rows) {
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (!row.productName.trim()) rowErrors.push('Product name is required');

    const sellingParsed = parseNumericCell(row.sellingPriceRaw);
    if (!row.sellingPriceRaw.trim()) {
      rowErrors.push('Selling price must be a number');
    } else if (sellingParsed === undefined) {
      rowErrors.push('Selling price must be a number');
    } else if (sellingParsed < 0) {
      rowErrors.push('Selling price cannot be negative');
    } else if (sellingParsed === 0) {
      rowWarnings.push('Selling price is 0');
    }

    if (row.costPriceRaw.trim()) {
      const costParsed = parseNumericCell(row.costPriceRaw);
      if (costParsed === undefined) {
        rowErrors.push('Cost price must be a number');
      } else if (costParsed < 0) {
        rowErrors.push('Cost price cannot be negative');
      } else if (costParsed === 0) {
        rowWarnings.push('Cost price is 0');
      }
    }

    if (row.minStockRaw.trim()) {
      const minParsed = parseNumericCell(row.minStockRaw);
      if (minParsed === undefined) {
        rowErrors.push('Min stock must be a number');
      } else if (minParsed < 0) {
        rowErrors.push('Min stock cannot be negative');
      }
    }

    if (!row.category?.trim()) {
      rowWarnings.push('Category is empty');
    }

    const vSku = row.variantSku?.trim();
    const hasVariantIdentity = Boolean(
      row.size?.trim() || row.color?.trim() || row.variantName?.trim()
    );
    if (vSku && !hasVariantIdentity) {
      rowWarnings.push('No size, colour, or variant name — item will be saved as “Default”');
    }

    const pSku = row.productSku?.trim();
    if (vSku) {
      const prev = skuInFile.get(`v:${vSku.toLowerCase()}`);
      if (prev) rowErrors.push(`Duplicate variant SKU in file (also on row ${prev})`);
      else skuInFile.set(`v:${vSku.toLowerCase()}`, row.rowNumber);
    }
    if (pSku && !vSku) {
      const prev = skuInFile.get(`p:${pSku.toLowerCase()}`);
      if (prev) rowErrors.push(`Duplicate product SKU in file (also on row ${prev})`);
      else skuInFile.set(`p:${pSku.toLowerCase()}`, row.rowNumber);
    }

    const skuProductConflict = await assertVariantSkuProductConsistency(businessId, row);
    if (skuProductConflict) rowErrors.push(skuProductConflict);

    const target = await resolveImportRowTarget(businessId, row);

    const bc = row.barcode?.trim();
    if (bc) {
      const prev = barcodeInFile.get(bc);
      if (prev) rowErrors.push(`Duplicate barcode in file (also on row ${prev})`);
      else barcodeInFile.set(bc, row.rowNumber);
      if (
        await barcodeConflictsWithCatalogue(businessId, bc, {
          productId: target.product?.id,
          variantId: target.variant?.id,
        })
      ) {
        rowErrors.push('Barcode already exists in catalogue');
      }
    }

    if (rowErrors.length) {
      errors.push({ rowNumber: row.rowNumber, message: rowErrors.join('; ') });
      continue;
    }

    const costParsed = row.costPriceRaw.trim() ? parseNumericCell(row.costPriceRaw) : 0;
    const minParsed = row.minStockRaw.trim() ? parseNumericCell(row.minStockRaw) : 0;
    const normalized: ParsedProductRow = {
      ...row,
      sellingPrice: sellingParsed ?? 0,
      costPrice: costParsed ?? 0,
      minStock: minParsed != null ? Math.max(0, Math.round(minParsed)) : 0,
    };

    const exists = rowMatchesExisting(target, row);
    if (importMode === 'create-only' && exists) {
      skipped.push({
        rowNumber: row.rowNumber,
        message: 'Already in catalogue — skipped (create-only mode)',
      });
      continue;
    }

    const disposition: 'new' | 'update' = exists ? 'update' : 'new';
    if (disposition === 'new') newCount++;
    else updateCount++;

    valid.push({ ...normalized, disposition });
    for (const w of rowWarnings) {
      warnings.push({ rowNumber: row.rowNumber, message: w });
    }
  }

  return {
    valid,
    errors,
    warnings,
    skipped,
    importMode,
    stats: {
      totalRows: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      newCount,
      updateCount,
      skippedCount: skipped.length,
    },
  };
}

async function resolveVariantForStock(
  businessId: string,
  row: ParsedOpeningStockRow
): Promise<{ productId: string; variantId: string | null } | null> {
  if (row.variantSku) {
    const v = await prisma.variant.findFirst({
      where: { sku: row.variantSku, product: { businessId, isActive: true } },
      select: { id: true, productId: true },
    });
    if (v) return { productId: v.productId, variantId: v.id };
  }
  if (row.productSku) {
    const p = await prisma.product.findFirst({
      where: { businessId, sku: row.productSku, isActive: true },
      include: { variants: { where: { isActive: true } } },
    });
    if (!p) return null;
    if (p.variants.length === 0) return { productId: p.id, variantId: null };
    const match = p.variants.find(
      (v) =>
        (row.size && v.size === row.size) ||
        (row.color && v.color === row.color) ||
        (row.size && v.name.includes(row.size))
    );
    if (match) return { productId: p.id, variantId: match.id };
    if (p.variants.length === 1) return { productId: p.id, variantId: p.variants[0].id };
    return null;
  }
  if (row.productName) {
    const p = await prisma.product.findFirst({
      where: { businessId, name: row.productName, isActive: true },
      include: { variants: { where: { isActive: true } } },
    });
    if (!p) return null;
    if (p.variants.length === 0) return { productId: p.id, variantId: null };
    const match = p.variants.find(
      (v) =>
        (row.size && v.size === row.size) ||
        (row.color && v.color === row.color)
    );
    if (match) return { productId: p.id, variantId: match.id };
  }
  return null;
}

export async function validateOpeningStockRows(
  businessId: string,
  rows: ParsedOpeningStockRow[]
): Promise<OpeningStockPreviewResult> {
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  const valid: ParsedOpeningStockRow[] = [];

  for (const row of rows) {
    if (!row.variantSku && !row.productSku && !row.productName) {
      errors.push({ rowNumber: row.rowNumber, message: 'Variant SKU, product SKU, or product name is required' });
      continue;
    }

    const qtyRaw = row.quantityRaw.trim();
    const qtyParsed = parseNumericCell(qtyRaw);
    if (!qtyRaw) {
      errors.push({ rowNumber: row.rowNumber, message: 'Quantity must be a positive whole number' });
      continue;
    }
    if (qtyParsed === undefined) {
      errors.push({ rowNumber: row.rowNumber, message: 'Quantity must be a positive whole number' });
      continue;
    }
    if (qtyParsed <= 0) {
      errors.push({
        rowNumber: row.rowNumber,
        message:
          qtyParsed === 0
            ? 'Quantity must be greater than zero'
            : 'Quantity must be a positive whole number',
      });
      continue;
    }
    if (!Number.isInteger(qtyParsed) && Math.round(qtyParsed) !== qtyParsed) {
      errors.push({ rowNumber: row.rowNumber, message: 'Quantity must be a positive whole number' });
      continue;
    }

    const resolved = await resolveVariantForStock(businessId, row);
    if (!resolved) {
      errors.push({
        rowNumber: row.rowNumber,
        message: 'No matching product/variant — import products first',
      });
      continue;
    }

    const priorOpening = await prisma.stockMovement.findFirst({
      where: {
        reference: { startsWith: 'OPENING_IMPORT:' },
        stock: {
          productId: resolved.productId,
          variantId: resolved.variantId,
        },
      },
      select: { id: true },
    });
    if (priorOpening) {
      warnings.push({
        rowNumber: row.rowNumber,
        message:
          'Opening stock was already imported for this item — importing again will add the quantities twice',
      });
    }

    valid.push({ ...row, quantity: Math.round(qtyParsed) });
  }

  return {
    valid,
    errors,
    warnings,
    stats: {
      totalRows: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}

async function getOrCreateCategory(
  tx: Prisma.TransactionClient,
  businessId: string,
  name?: string
) {
  if (!name?.trim()) return undefined;
  const n = name.trim();
  const existing = await tx.category.findFirst({ where: { businessId, name: n } });
  if (existing) return existing.id;
  const created = await tx.category.create({
    data: { businessId, name: n, isActive: true },
  });
  return created.id;
}

async function getOrCreateBrand(tx: Prisma.TransactionClient, businessId: string, name?: string) {
  if (!name?.trim()) return undefined;
  const n = name.trim();
  const existing = await tx.brand.findFirst({ where: { businessId, name: n } });
  if (existing) return existing.id;
  const created = await tx.brand.create({
    data: { businessId, name: n, isActive: true },
  });
  return created.id;
}

async function assertIdempotency(
  businessId: string,
  type: string,
  idempotencyKey: string
): Promise<{ replay: true; summary: unknown } | { replay: false }> {
  const existing = await prisma.shopImportBatch.findUnique({
    where: { businessId_type_idempotencyKey: { businessId, type, idempotencyKey } },
  });
  if (existing?.summaryJson) {
    return { replay: true, summary: JSON.parse(existing.summaryJson) };
  }
  if (existing) {
    throw new AppError('Import already in progress for this idempotency key', 409);
  }
  return { replay: false };
}

function productCreatePayload(
  head: ParsedProductRow,
  businessId: string,
  categoryId?: string,
  brandId?: string
): Prisma.ProductCreateInput {
  return {
    business: { connect: { id: businessId } },
    name: head.productName,
    sku: head.productSku?.trim() || undefined,
    costPrice: head.costPrice,
    sellingPrice: head.sellingPrice,
    minStock: head.minStock,
    trackStock: head.trackStock ?? true,
    unit: head.unit?.trim() || 'pcs',
    isActive: true,
    ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
    ...(brandId ? { brand: { connect: { id: brandId } } } : {}),
  };
}

function productUpdatePayload(
  head: ParsedProductRow,
  categoryId?: string,
  brandId?: string
): Prisma.ProductUpdateInput {
  const data: Prisma.ProductUpdateInput = {
    name: head.productName,
    isActive: true,
  };
  if (head.productSku?.trim()) data.sku = head.productSku.trim();
  if (head.sellingPriceRaw.trim()) data.sellingPrice = head.sellingPrice;
  if (head.costPriceRaw.trim()) data.costPrice = head.costPrice;
  if (head.minStockRaw.trim()) data.minStock = head.minStock;
  if (head.unit?.trim()) data.unit = head.unit.trim();
  if (head.trackStock !== undefined) data.trackStock = head.trackStock;
  if (categoryId) data.category = { connect: { id: categoryId } };
  if (brandId) data.brand = { connect: { id: brandId } };
  return data;
}

function variantCreateData(row: ParsedProductRow, head: ParsedProductRow) {
  const vName = row.variantName || [row.size, row.color].filter(Boolean).join(' / ') || 'Default';
  return {
    name: vName,
    sku: row.variantSku?.trim() || undefined,
    size: row.size,
    color: row.color,
    costPrice: row.costPriceRaw.trim() ? row.costPrice : head.costPrice,
    sellingPrice: row.sellingPriceRaw.trim() ? row.sellingPrice : head.sellingPrice,
    barcode: row.barcode?.trim() || undefined,
    isActive: true,
  };
}

function variantUpdateData(row: ParsedProductRow, head: ParsedProductRow) {
  const data: Prisma.VariantUpdateInput = { isActive: true };
  const vName = row.variantName || [row.size, row.color].filter(Boolean).join(' / ');
  if (vName) data.name = vName;
  if (row.variantSku?.trim()) data.sku = row.variantSku.trim();
  if (row.size) data.size = row.size;
  if (row.color) data.color = row.color;
  if (row.sellingPriceRaw.trim()) data.sellingPrice = row.sellingPrice;
  else if (head.sellingPriceRaw.trim()) data.sellingPrice = head.sellingPrice;
  if (row.costPriceRaw.trim()) data.costPrice = row.costPrice;
  else if (head.costPriceRaw.trim()) data.costPrice = head.costPrice;
  if (row.barcode?.trim()) data.barcode = row.barcode.trim();
  return data;
}

export async function commitProductImport(params: {
  businessId: string;
  userId: string;
  idempotencyKey: string;
  filename?: string;
  rows: ParsedProductRow[];
  importMode?: ImportMode;
  partial?: boolean;
}) {
  const { businessId, userId, idempotencyKey, rows } = params;
  const importMode = normalizeImportMode(params.importMode);
  if (!idempotencyKey?.trim()) throw new AppError('idempotencyKey is required', 400);
  if (!rows.length) throw new AppError('No valid rows to import', 400);

  const idem = await assertIdempotency(businessId, 'PRODUCTS', idempotencyKey.trim());
  if (idem.replay) {
    return { idempotentReplay: true, ...(idem.summary as Record<string, unknown>) };
  }

  const preview = await validateProductRows(businessId, rows, { importMode });
  if (preview.errors.length) {
    throw new AppError(`Fix ${preview.errors.length} row error(s) before importing`, 400);
  }
  if (!preview.valid.length) {
    throw new AppError('No rows to import after validation', 400);
  }

  const grouped = new Map<string, ProductImportRow[]>();
  for (const row of preview.valid) {
    const key = productKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  let productsCreated = 0;
  let productsUpdated = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;

  await prisma.$transaction(async (tx) => {
    await tx.shopImportBatch.create({
      data: {
        businessId,
        type: 'PRODUCTS',
        idempotencyKey: idempotencyKey.trim(),
        filename: params.filename,
        status: 'IN_PROGRESS',
        createdBy: userId,
      },
    });

    for (const [, groupRows] of grouped) {
      const head = groupRows[0];
      const categoryId = head.category?.trim()
        ? await getOrCreateCategory(tx, businessId, head.category)
        : undefined;
      const brandId = head.brand?.trim() ? await getOrCreateBrand(tx, businessId, head.brand) : undefined;
      const sku = head.productSku?.trim();

      let product = sku
        ? await tx.product.findFirst({ where: { businessId, sku } })
        : await tx.product.findFirst({ where: { businessId, name: head.productName } });

      const productIsUpdate = product != null && importMode === 'create-and-update';

      if (!product) {
        product = await tx.product.create({
          data: productCreatePayload(head, businessId, categoryId, brandId),
        });
        productsCreated++;
      } else if (productIsUpdate) {
        product = await tx.product.update({
          where: { id: product.id },
          data: productUpdatePayload(head, categoryId, brandId),
        });
        productsUpdated++;
      }

      const hasVariants = groupRows.some((r) => r.variantSku || r.variantName || r.size || r.color);
      if (!hasVariants && groupRows.length === 1 && head.barcode) {
        const bc = head.barcode.trim();
        if (
          !(await barcodeConflictsWithCatalogue(businessId, bc, {
            productId: product.id,
          }))
        ) {
          await tx.product.update({ where: { id: product.id }, data: { barcode: bc } });
        }
      }

      if (hasVariants) {
        for (const row of groupRows) {
          const vSku = row.variantSku?.trim();
          const vName = row.variantName || [row.size, row.color].filter(Boolean).join(' / ') || 'Default';
          let variant = vSku
            ? await tx.variant.findFirst({ where: { productId: product.id, sku: vSku } })
            : await tx.variant.findFirst({
                where: {
                  productId: product.id,
                  name: vName,
                  ...(row.size ? { size: row.size } : {}),
                  ...(row.color ? { color: row.color } : {}),
                },
              });

          if (variant && row.disposition === 'update' && importMode === 'create-and-update') {
            await tx.variant.update({
              where: { id: variant.id },
              data: variantUpdateData(row, head),
            });
            variantsUpdated++;
          } else if (!variant) {
            variant = await tx.variant.create({
              data: { ...variantCreateData(row, head), productId: product.id },
            });
            variantsCreated++;
          } else if (variant && importMode === 'create-and-update') {
            await tx.variant.update({
              where: { id: variant.id },
              data: variantUpdateData(row, head),
            });
            variantsUpdated++;
          }
        }
      }
    }

    const summary = {
      productsCreated,
      productsUpdated,
      variantsCreated,
      variantsUpdated,
      rowCount: preview.valid.length,
      importMode,
      partial: Boolean(params.partial),
      skippedCount: preview.stats.skippedCount,
      newCount: preview.stats.newCount,
      updateCount: preview.stats.updateCount,
    };

    await tx.shopImportBatch.update({
      where: {
        businessId_type_idempotencyKey: {
          businessId,
          type: 'PRODUCTS',
          idempotencyKey: idempotencyKey.trim(),
        },
      },
      data: { status: 'COMPLETED', summaryJson: JSON.stringify(summary) },
    });
  });

  await logActivity({
    userId,
    action: 'IMPORT',
    module: 'PRODUCTS',
    details: `Shop Excel products: +${productsCreated} / ~${productsUpdated} (${importMode})`,
  });

  return {
    productsCreated,
    productsUpdated,
    variantsCreated,
    variantsUpdated,
    importMode,
    partial: Boolean(params.partial),
    skippedCount: preview.stats.skippedCount,
    idempotentReplay: false,
  };
}

export async function commitOpeningStockImport(params: {
  businessId: string;
  userId: string;
  branchId?: string;
  idempotencyKey: string;
  filename?: string;
  rows: ParsedOpeningStockRow[];
  partial?: boolean;
}) {
  const { businessId, userId, branchId, idempotencyKey, rows } = params;
  if (!idempotencyKey?.trim()) throw new AppError('idempotencyKey is required', 400);

  const idem = await assertIdempotency(businessId, 'OPENING_STOCK', idempotencyKey.trim());
  if (idem.replay) {
    return { idempotentReplay: true, ...(idem.summary as Record<string, unknown>) };
  }

  const preview = await validateOpeningStockRows(businessId, rows);
  if (preview.errors.length) {
    throw new AppError(`Fix ${preview.errors.length} row error(s) before importing stock`, 400);
  }

  const defaultWh = await prisma.warehouse.findFirst({ where: { businessId, isDefault: true } });
  if (!defaultWh) throw new AppError('No default warehouse configured', 400);

  let linesApplied = 0;
  let linesSkipped = 0;
  let unitsAdded = 0;

  const batchId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.shopImportBatch.create({
      data: {
        businessId,
        type: 'OPENING_STOCK',
        idempotencyKey: idempotencyKey.trim(),
        filename: params.filename,
        status: 'IN_PROGRESS',
        createdBy: userId,
      },
    });

    for (const row of preview.valid) {
      const resolved = await resolveVariantForStock(businessId, row);
      if (!resolved) continue;

      const lineKey = `${resolved.variantId ?? 'base'}:${row.variantSku ?? row.productSku ?? row.rowNumber}`;
      const reference = `OPENING_IMPORT:${idempotencyKey.trim()}:${lineKey}`;

      const prior = await tx.stockMovement.findFirst({
        where: { reference, stock: { productId: resolved.productId } },
      });
      if (prior) {
        linesSkipped++;
        continue;
      }

      let stock = await tx.stock.findFirst({
        where: {
          productId: resolved.productId,
          variantId: resolved.variantId,
          warehouseId: defaultWh.id,
          branchId: branchId ?? null,
        },
      });
      if (!stock) {
        stock = await tx.stock.create({
          data: {
            productId: resolved.productId,
            variantId: resolved.variantId,
            warehouseId: defaultWh.id,
            branchId: branchId ?? undefined,
            quantity: 0,
          },
        });
      }

      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { increment: row.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          stockId: stock.id,
          type: 'IN',
          quantity: row.quantity,
          reference,
          notes: `Opening stock import ${batchId}`,
          createdBy: userId,
        },
      });
      linesApplied++;
      unitsAdded += row.quantity;
    }

    const summary = {
      linesApplied,
      linesSkipped,
      unitsAdded,
      rowCount: preview.valid.length,
      partial: Boolean(params.partial),
    };
    await tx.shopImportBatch.update({
      where: {
        businessId_type_idempotencyKey: {
          businessId,
          type: 'OPENING_STOCK',
          idempotencyKey: idempotencyKey.trim(),
        },
      },
      data: { status: 'COMPLETED', summaryJson: JSON.stringify(summary) },
    });
  });

  await logActivity({
    userId,
    action: 'IMPORT',
    module: 'INVENTORY',
    details: `Opening stock: ${linesApplied} lines, ${unitsAdded} units`,
  });

  return {
    linesApplied,
    linesSkipped,
    unitsAdded,
    partial: Boolean(params.partial),
    idempotentReplay: false,
  };
}
