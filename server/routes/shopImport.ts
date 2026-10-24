import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { hasPermission } from '../lib/permissions.js';
import { asyncHandler, AppError } from '../lib/errors.js';
import {
  commitOpeningStockImport,
  commitProductImport,
  normalizeImportMode,
  previewOpeningStockFromBuffer,
  previewProductsFromBuffer,
  validateOpeningStockRows,
  validateProductRows,
} from '../services/shopImportService.js';
import type { ParsedOpeningStockRow, ParsedProductRow } from '../services/shopImportExcelParser.js';

export const shopImportRouter = Router();
shopImportRouter.use(authenticate);

function decodeWorkbook(body: { fileBase64?: string }): Buffer {
  const b64 = body.fileBase64?.trim();
  if (!b64) throw new AppError('fileBase64 is required', 400);
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    throw new AppError('Invalid file encoding', 400);
  }
}

shopImportRouter.post(
  '/preview/products',
  requirePermission('products.create'),
  asyncHandler(async (req, res) => {
    const buffer = decodeWorkbook(req.body);
    const importMode = normalizeImportMode(req.body.importMode);
    const preview = await previewProductsFromBuffer(req.user!.businessId, buffer, { importMode });
    res.json(preview);
  })
);

shopImportRouter.post(
  '/preview/opening-stock',
  requirePermission('inventory.edit'),
  asyncHandler(async (req, res) => {
    const buffer = decodeWorkbook(req.body);
    const preview = await previewOpeningStockFromBuffer(req.user!.businessId, buffer);
    res.json(preview);
  })
);

shopImportRouter.post(
  '/commit/products',
  requirePermission('products.create'),
  asyncHandler(async (req, res) => {
    const rows = (req.body.rows ?? []) as ParsedProductRow[];
    const idempotencyKey = String(req.body.idempotencyKey ?? '');
    const filename = req.body.filename as string | undefined;
    const importMode = normalizeImportMode(req.body.importMode);
    const partial = Boolean(req.body.partial);

    if (
      importMode === 'create-and-update' &&
      !hasPermission(req.user!.role, 'products.edit', req.user!.permissions)
    ) {
      throw new AppError('Updating existing products requires products.edit permission', 403);
    }

    if (!idempotencyKey.trim()) {
      throw new AppError('idempotencyKey is required for import commit', 400);
    }
    if (!rows.length) {
      throw new AppError('No product rows to import. Run preview first and fix row errors.', 400);
    }

    const preview = await validateProductRows(req.user!.businessId, rows, { importMode });
    if (preview.errors.length) {
      res.status(400).json({
        error: `Validation failed (${preview.errors.length} row(s))`,
        message: 'Validation failed',
        ...preview,
      });
      return;
    }

    const result = await commitProductImport({
      businessId: req.user!.businessId,
      userId: req.user!.userId,
      idempotencyKey,
      filename,
      rows,
      importMode,
      partial,
    });
    res.json(result);
  })
);

shopImportRouter.post(
  '/commit/opening-stock',
  requirePermission('inventory.edit'),
  asyncHandler(async (req, res) => {
    const rows = (req.body.rows ?? []) as ParsedOpeningStockRow[];
    const idempotencyKey = String(req.body.idempotencyKey ?? '');
    const filename = req.body.filename as string | undefined;
    const partial = Boolean(req.body.partial);
    const preview = await validateOpeningStockRows(req.user!.businessId, rows);
    if (!idempotencyKey.trim()) {
      throw new AppError('idempotencyKey is required for import commit', 400);
    }
    if (preview.errors.length) {
      res.status(400).json({
        error: `Validation failed (${preview.errors.length} row(s))`,
        message: 'Validation failed',
        ...preview,
      });
      return;
    }
    const result = await commitOpeningStockImport({
      businessId: req.user!.businessId,
      userId: req.user!.userId,
      branchId: req.user!.branchId,
      idempotencyKey,
      filename,
      rows: preview.valid,
      partial,
    });
    res.json(result);
  })
);
