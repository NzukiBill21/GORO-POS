import { Request, Response } from 'express';
import { parsePagination } from '../lib/pagination.js';
import { salesService } from '../services/salesService.js';
import { asyncHandler } from '../lib/errors.js';

export const salesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await salesService.list(req.user!.branchId!, {
      ...parsePagination(req.query as Record<string, unknown>),
      status: req.query.status as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    });
    res.json(result);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    const sale = await salesService.getById(req.params.id, req.user!.branchId!);
    res.json(sale);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const sale = await salesService.create({
      branchId: req.user!.branchId!,
      userId: req.user!.userId,
      sessionId: req.user!.sessionId,
      ...req.body,
    });
    res.status(201).json(sale);
  }),

  held: asyncHandler(async (req: Request, res: Response) => {
    const sales = await salesService.getHeld(req.user!.branchId!);
    res.json(sales);
  }),

  hold: asyncHandler(async (req: Request, res: Response) => {
    const sale = await salesService.holdSale({
      branchId: req.user!.branchId!,
      userId: req.user!.userId,
      ...req.body,
    });
    res.status(201).json(sale);
  }),

  resume: asyncHandler(async (req: Request, res: Response) => {
    const sale = await salesService.resumeSale(req.params.id, req.user!.branchId!, req.user!.userId, req.body.payments);
    res.json(sale);
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const result = await salesService.voidSale(req.params.id, req.user!.branchId!, req.user!.userId, req.user!.sessionId);
    res.json(result);
  }),

  refund: asyncHandler(async (req: Request, res: Response) => {
    const result = await salesService.refund(req.params.id, req.user!.branchId!, req.user!.userId, req.user!.sessionId);
    res.json(result);
  }),
};
