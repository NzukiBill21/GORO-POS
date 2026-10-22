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

export type ImportRowError = { rowNumber: number; message: string };

export type ImportPreviewMeta = {
  sheetUsed: string;
  sheetNames: string[];
  hint?: string;
};

export type ProductPreviewResult = {
  valid: ParsedProductRow[];
  errors: ImportRowError[];
  stats: { totalRows: number; validCount: number; errorCount: number };
  meta?: ImportPreviewMeta;
};

export type OpeningStockPreviewResult = {
  valid: ParsedOpeningStockRow[];
  errors: ImportRowError[];
  stats: { totalRows: number; validCount: number; errorCount: number };
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
  buffer: Buffer
): Promise<ProductPreviewResult> {
  const preferred = ['PRODUCTS', 'Products', 'products', 'Product catalogue', 'Catalogue'];
  const { sheetName, rows, sheetNames } = readWorkbookSheet(buffer, preferred, (r) =>
    parseProductSheetRows(r).length
  );
  const parsed = parseProductSheetRows(rows);
  const meta: ImportPreviewMeta = { sheetUsed: sheetName, sheetNames };
  const result = await validateProductRows(businessId, parsed);
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
  const { sheetName, rows, sheetNames } = readWorkbookSheet(buffer, preferred, (r) =>
    parseOpeningStockSheetRows(r).length
  );
  const parsed = parseOpeningStockSheetRows(rows);
  const meta: ImportPreviewMeta = { sheetUsed: sheetName, sheetNames };
  const result = await validateOpeningStockRows(businessId, parsed);
  if (result.stats.totalRows === 0) {
    meta.hint = zeroRowHint('opening-stock', meta);
  }
  return { ...result, meta };
}

export async function validateProductRows(
  businessId: string,
  rows: ParsedProductRow[]
): Promise<ProductPreviewResult> {
  const errors: ImportRowError[] = [];
  const valid: ParsedProductRow[] = [];
  const skuInFile = new Map<string, number>();
  const barcodeInFile = new Map<string, number>();

  for (const row of rows) {
    const rowErrors: string[] = [];
    if (!row.productName.trim()) rowErrors.push('Product name is required');
    if (row.sellingPrice < 0) rowErrors.push('Selling price cannot be negative');
    if (row.costPrice < 0) rowErrors.push('Cost price cannot be negative');

    const vSku = row.variantSku?.trim();
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

    const bc = row.barcode?.trim();
    if (bc) {
      const prev = barcodeInFile.get(bc);
      if (prev) rowErrors.push(`Duplicate barcode in file (also on row ${prev})`);
      else barcodeInFile.set(bc, row.rowNumber);
      const owner = await findBarcodeOwner(businessId, bc);
      if (owner) rowErrors.push('Barcode already exists in catalogue');
    }

    if (vSku) {
      const existingV = await prisma.variant.findFirst({
        where: { sku: vSku, product: { businessId } },
        select: { id: true },
      });
      if (existingV && bc) {
        const owner = await findBarcodeOwner(businessId, bc);
        if (owner && owner.kind === 'variant' && owner.id !== existingV.id) {
          rowErrors.push('Barcode conflicts with another variant');
        }
      }
    }

    if (rowErrors.length) {
      errors.push({ rowNumber: row.rowNumber, message: rowErrors.join('; ') });
    } else {
      valid.push(row);
    }
  }

  return {
    valid,
    errors,
    stats: { totalRows: rows.length, validCount: valid.length, errorCount: errors.length },
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
  const valid: ParsedOpeningStockRow[] = [];

  for (const row of rows) {
    if (!row.variantSku && !row.productSku && !row.productName) {
      errors.push({ rowNumber: row.rowNumber, message: 'Variant SKU, product SKU, or product name is required' });
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
    valid.push(row);
  }

  return {
    valid,
    errors,
    stats: { totalRows: rows.length, validCount: valid.length, errorCount: errors.length },
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

export async function commitProductImport(params: {
  businessId: string;
  userId: string;
  idempotencyKey: string;
  filename?: string;
  rows: ParsedProductRow[];
}) {
  const { businessId, userId, idempotencyKey, rows } = params;
  if (!idempotencyKey?.trim()) throw new AppError('idempotencyKey is required', 400);
  if (!rows.length) throw new AppError('No valid rows to import', 400);

  const idem = await assertIdempotency(businessId, 'PRODUCTS', idempotencyKey.trim());
  if (idem.replay) {
    return { idempotentReplay: true, ...(idem.summary as Record<string, unknown>) };
  }

  const preview = await validateProductRows(businessId, rows);
  if (preview.errors.length) {
    throw new AppError(`Fix ${preview.errors.length} row error(s) before importing`, 400);
  }

  const grouped = new Map<string, ParsedProductRow[]>();
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
      const categoryId = await getOrCreateCategory(tx, businessId, head.category);
      const sku = head.productSku?.trim();

      let product = sku
        ? await tx.product.findFirst({ where: { businessId, sku } })
        : await tx.product.findFirst({ where: { businessId, name: head.productName } });

      const productPayload: Prisma.ProductUpdateInput = {
        name: head.productName,
        sku: sku || undefined,
        costPrice: head.costPrice,
        sellingPrice: head.sellingPrice,
        minStock: head.minStock,
        trackStock: head.trackStock,
        unit: head.unit?.trim() || 'pcs',
        isActive: true,
        ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
      };

      if (product) {
        product = await tx.product.update({
          where: { id: product.id },
          data: productPayload,
        });
        productsUpdated++;
      } else {
        product = await tx.product.create({
          data: { ...(productPayload as Prisma.ProductCreateInput), business: { connect: { id: businessId } } },
        });
        productsCreated++;
      }

      const hasVariants = groupRows.some((r) => r.variantSku || r.variantName || r.size || r.color);
      if (!hasVariants && groupRows.length === 1 && head.barcode) {
        const bc = head.barcode.trim();
        const owner = await findBarcodeOwner(businessId, bc);
        if (!owner) {
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

          const vData = {
            name: vName,
            sku: vSku || undefined,
            size: row.size,
            color: row.color,
            costPrice: row.costPrice || head.costPrice,
            sellingPrice: row.sellingPrice || head.sellingPrice,
            barcode: row.barcode?.trim() || undefined,
            isActive: true,
          };

          if (variant) {
            await tx.variant.update({ where: { id: variant.id }, data: vData });
            variantsUpdated++;
          } else {
            variant = await tx.variant.create({ data: { ...vData, productId: product.id } });
            variantsCreated++;
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
    details: `Shop Excel products: +${productsCreated} / ~${productsUpdated}`,
  });

  return { productsCreated, productsUpdated, variantsCreated, variantsUpdated, idempotentReplay: false };
}

export async function commitOpeningStockImport(params: {
  businessId: string;
  userId: string;
  branchId?: string;
  idempotencyKey: string;
  filename?: string;
  rows: ParsedOpeningStockRow[];
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

    const summary = { linesApplied, linesSkipped, unitsAdded, rowCount: preview.valid.length };
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

  return { linesApplied, linesSkipped, unitsAdded, idempotentReplay: false };
}
