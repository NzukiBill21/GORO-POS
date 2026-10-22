import { Request, Response } from 'express';
import { parsePagination } from '../lib/pagination.js';
import { productService } from '../services/productService.js';
import { asyncHandler, AppError } from '../lib/errors.js';

export const productController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await productService.list(req.user!.businessId, {
      ...parsePagination(req.query as Record<string, unknown>),
      categoryId: req.query.categoryId as string,
      favorites: req.query.favorites === 'true',
    });
    res.json(result);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    const product = await productService.getById(req.params.id, req.user!.businessId);
    res.json(product);
  }),

  getByBarcode: asyncHandler(async (req: Request, res: Response) => {
    const product = await productService.getByBarcode(req.params.code, req.user!.businessId);
    res.json(product);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const product = await productService.create(req.user!.businessId, req.user!.userId, {
      ...req.body,
      branchId: req.user!.branchId,
    });
    res.status(201).json(product);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const product = await productService.update(req.params.id, req.user!.businessId, req.user!.userId, req.body);
    res.json(product);
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const result = await productService.delete(req.params.id, req.user!.businessId, req.user!.userId);
    res.json(result);
  }),

  export: asyncHandler(async (req: Request, res: Response) => {
    const products = await productService.exportAll(req.user!.businessId);
    res.json(products);
  }),

  importProducts: asyncHandler(async (req: Request, res: Response) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError(
        'No product rows in CSV. Required column: Name (or Product name). Optional: SKU, Barcode, Category, Cost price, Selling price, Stock.',
        400
      );
    }
    const result = await productService.importProducts(
      req.user!.businessId,
      req.user!.userId,
      req.user!.branchId,
      rows
    );
    res.json(result);
  }),

  generateInternalBarcode: asyncHandler(async (req: Request, res: Response) => {
    const result = await productService.generateInternalBarcode(
      req.params.id,
      req.user!.businessId,
      req.user!.userId,
      req.body.variantId as string | undefined
    );
    res.json(result);
  }),

  createVariant: asyncHandler(async (req: Request, res: Response) => {
    const variant = await productService.createVariant(
      req.params.id,
      req.user!.businessId,
      req.user!.userId,
      req.body
    );
    res.status(201).json(variant);
  }),

  updateVariant: asyncHandler(async (req: Request, res: Response) => {
    const variant = await productService.updateVariant(
      req.params.id,
      req.params.variantId,
      req.user!.businessId,
      req.user!.userId,
      req.body
    );
    res.json(variant);
  }),
};
