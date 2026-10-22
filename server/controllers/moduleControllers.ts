import { Request, Response } from 'express';
import { parsePagination } from '../lib/pagination.js';
import { customerService } from '../services/customerService.js';
import { purchaseService } from '../services/purchaseService.js';
import { financialService } from '../services/financialService.js';
import { employeeService } from '../services/employeeService.js';
import { notificationService, settingsService, reportService } from '../services/systemService.js';
import { asyncHandler } from '../lib/errors.js';

export const customerController = {
  list: asyncHandler(async (req, res) => {
    res.json(await customerService.list(req.user!.businessId, parsePagination(req.query as Record<string, unknown>)));
  }),
  get: asyncHandler(async (req, res) => {
    res.json(await customerService.getById(req.params.id, req.user!.businessId));
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await customerService.create(req.user!.businessId, req.user!.userId, req.body));
  }),
  update: asyncHandler(async (req, res) => {
    res.json(await customerService.update(req.params.id, req.user!.businessId, req.user!.userId, req.body));
  }),
  delete: asyncHandler(async (req, res) => {
    res.json(await customerService.delete(req.params.id, req.user!.businessId, req.user!.userId));
  }),
  addPoints: asyncHandler(async (req, res) => {
    res.json(await customerService.addLoyaltyPoints(req.params.id, req.user!.businessId, req.body.points, req.user!.userId));
  }),
};

export const purchaseController = {
  list: asyncHandler(async (req, res) => {
    res.json(await purchaseService.list(req.user!.businessId, { ...parsePagination(req.query as Record<string, unknown>), status: req.query.status as string }));
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await purchaseService.create({ branchId: req.user!.branchId!, userId: req.user!.userId, ...req.body }));
  }),
  receive: asyncHandler(async (req, res) => {
    res.json(
      await purchaseService.receive(
        req.params.id,
        req.user!.branchId!,
        req.user!.userId,
        req.user!.businessId,
        req.body?.lines
      )
    );
  }),
  listSuppliers: asyncHandler(async (req, res) => {
    res.json(await purchaseService.listSuppliers(req.user!.businessId, parsePagination(req.query as Record<string, unknown>)));
  }),
  createSupplier: asyncHandler(async (req, res) => {
    res.status(201).json(await purchaseService.createSupplier(req.user!.businessId, req.user!.userId, req.body));
  }),
};

export const financialController = {
  listExpenses: asyncHandler(async (req, res) => {
    res.json(await financialService.listExpenses(req.user!.businessId, {
      ...parsePagination(req.query as Record<string, unknown>),
      category: req.query.category as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    }));
  }),
  createExpense: asyncHandler(async (req, res) => {
    res.status(201).json(await financialService.createExpense(req.user!.businessId, req.user!.userId, req.body));
  }),
  deleteExpense: asyncHandler(async (req, res) => {
    res.json(await financialService.deleteExpense(req.params.id, req.user!.businessId, req.user!.userId));
  }),
  summary: asyncHandler(async (req, res) => {
    res.json(await financialService.getSummary(req.user!.businessId, req.user!.branchId));
  }),
  listTaxes: asyncHandler(async (req, res) => {
    res.json(await financialService.listTaxes(req.user!.businessId));
  }),
};

export const employeeController = {
  list: asyncHandler(async (req, res) => {
    res.json(await employeeService.list(req.user!.businessId, parsePagination(req.query as Record<string, unknown>)));
  }),
  create: asyncHandler(async (req, res) => {
    res.status(201).json(await employeeService.create(req.user!.businessId, req.user!.userId, req.body));
  }),
  update: asyncHandler(async (req, res) => {
    res.json(await employeeService.update(req.params.id, req.user!.businessId, req.user!.userId, req.body));
  }),
  toggleActive: asyncHandler(async (req, res) => {
    res.json(await employeeService.toggleActive(req.params.id, req.user!.businessId, req.user!.userId));
  }),
  listRoles: asyncHandler(async (_req, res) => {
    res.json(await employeeService.listRoles());
  }),
  activityLogs: asyncHandler(async (req, res) => {
    res.json(await employeeService.getActivityLogs(req.user!.businessId, {
      ...parsePagination(req.query as Record<string, unknown>),
      userId: req.query.userId as string,
      module: req.query.module as string,
    }));
  }),
  listUserPermissions: asyncHandler(async (req, res) => {
    res.json(await employeeService.listUserPermissions(req.user!.businessId, req.params.id));
  }),
  grantPermission: asyncHandler(async (req, res) => {
    res.status(201).json(
      await employeeService.grantPermission(
        req.user!.businessId,
        req.user!.userId,
        req.params.id,
        req.body.permission
      )
    );
  }),
  revokePermission: asyncHandler(async (req, res) => {
    res.json(
      await employeeService.revokePermission(
        req.user!.businessId,
        req.user!.userId,
        req.params.id,
        req.params.permissionName
      )
    );
  }),
};

export const notificationController = {
  list: asyncHandler(async (req, res) => {
    res.json(await notificationService.list(req.user!.businessId, req.user!.userId, {
      ...parsePagination(req.query as Record<string, unknown>),
      unreadOnly: req.query.unreadOnly === 'true',
    }));
  }),
  markRead: asyncHandler(async (req, res) => {
    res.json(await notificationService.markRead(req.params.id, req.user!.businessId, req.user!.userId));
  }),
  markAllRead: asyncHandler(async (req, res) => {
    res.json(await notificationService.markAllRead(req.user!.businessId, req.user!.userId));
  }),
  unreadCount: asyncHandler(async (req, res) => {
    res.json({ count: await notificationService.getUnreadCount(req.user!.businessId, req.user!.userId) });
  }),
};

export const settingsController = {
  getAll: asyncHandler(async (req, res) => {
    res.json(await settingsService.getAll(req.user!.businessId));
  }),
  updateBusiness: asyncHandler(async (req, res) => {
    res.json(await settingsService.updateBusiness(req.user!.businessId, req.user!.userId, req.body));
  }),
  setSetting: asyncHandler(async (req, res) => {
    res.json(await settingsService.setSetting(req.user!.businessId, req.user!.userId, req.body.key, req.body.value));
  }),
  createTax: asyncHandler(async (req, res) => {
    res.status(201).json(await settingsService.createTax(req.user!.businessId, req.user!.userId, req.body));
  }),
};

export const reportController = {
  sales: asyncHandler(async (req, res) => {
    res.json(await reportService.salesReport(req.user!.businessId, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
    }));
  }),
  inventory: asyncHandler(async (req, res) => {
    res.json(await reportService.inventoryReport(req.user!.businessId));
  }),
  profit: asyncHandler(async (req, res) => {
    res.json(await reportService.profitReport(req.user!.businessId, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      branchId: req.query.branchId as string,
    }));
  }),
  retailSummary: asyncHandler(async (req, res) => {
    res.json(
      await reportService.retailSummary(req.user!.businessId, {
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        branchId: req.query.branchId as string,
      })
    );
  }),
  stockMovements: asyncHandler(async (req, res) => {
    res.json(
      await reportService.stockMovementsReport(req.user!.businessId, {
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      })
    );
  }),
};
