import { Request, Response } from 'express';
import { parsePagination } from '../lib/pagination.js';
import { inventoryService } from '../services/inventoryService.js';
import { asyncHandler } from '../lib/errors.js';

export const inventoryController = {
  listStock: asyncHandler(async (req: Request, res: Response) => {
    const result = await inventoryService.listStock(req.user!.businessId, {
      ...parsePagination(req.query as Record<string, unknown>),
      lowStock: req.query.lowStock === 'true',
    });
    res.json(result);
  }),

  movements: asyncHandler(async (req: Request, res: Response) => {
    const result = await inventoryService.getMovements(
      req.params.productId,
      req.user!.businessId,
      parsePagination(req.query as Record<string, unknown>)
    );
    res.json(result);
  }),

  adjust: asyncHandler(async (req: Request, res: Response) => {
    const result = await inventoryService.adjust({
      ...req.body,
      userId: req.user!.userId,
      businessId: req.user!.businessId,
      userRole: req.user!.role,
    });
    res.json(result);
  }),

  transfer: asyncHandler(async (req: Request, res: Response) => {
    const result = await inventoryService.transfer({
      ...req.body,
      userId: req.user!.userId,
      businessId: req.user!.businessId,
      userRole: req.user!.role,
    });
    res.json(result);
  }),

  warehouses: asyncHandler(async (req: Request, res: Response) => {
    const warehouses = await inventoryService.getWarehouses(req.user!.businessId);
    res.json(warehouses);
  }),

  summary: asyncHandler(async (req: Request, res: Response) => {
    const summary = await inventoryService.getSummary(req.user!.businessId);
    res.json(summary);
  }),
};
