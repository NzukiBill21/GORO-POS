import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { asyncHandler } from '../lib/errors.js';
import { securityService } from '../services/securityService.js';

export const securityRouter = Router();
securityRouter.use(authenticate);
securityRouter.use(requirePermission('security.view'));

securityRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const result = await securityService.getAuditLogs(req.user!.businessId, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 50,
    module: req.query.module as string,
    userId: req.query.userId as string,
  });
  res.json(result);
}));

securityRouter.get('/login-history', asyncHandler(async (req, res) => {
  const result = await securityService.getLoginHistory(req.user!.businessId, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 50,
  });
  res.json(result);
}));

securityRouter.get('/events', asyncHandler(async (req, res) => {
  const result = await securityService.getSecurityEvents(req.user!.businessId, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 50,
    type: req.query.type as string,
  });
  res.json(result);
}));

securityRouter.get('/backups', asyncHandler(async (req, res) => {
  const backups = await securityService.listBackups(req.user!.businessId);
  res.json(backups);
}));

securityRouter.post('/backups', requirePermission('settings.edit'), asyncHandler(async (req, res) => {
  const backup = await securityService.createBackup(req.user!.businessId, 'MANUAL', req.user!.userId, req);
  res.status(201).json(backup);
}));

securityRouter.post('/backups/:id/restore', requirePermission('settings.edit'), asyncHandler(async (req, res) => {
  const result = await securityService.restoreBackup(req.params.id, req.user!.businessId, req.user!.userId, req);
  res.json(result);
}));

securityRouter.get('/backups/status', asyncHandler(async (req, res) => {
  res.json(await securityService.getBackupStatus(req.user!.businessId));
}));

securityRouter.post('/backups/:id/verify', requirePermission('settings.edit'), asyncHandler(async (req, res) => {
  res.json(await securityService.verifyBackupFile(req.params.id, req.user!.businessId));
}));

securityRouter.get('/approvals', requirePermission('inventory.approve'), asyncHandler(async (req, res) => {
  const approvals = await securityService.getPendingApprovals(req.user!.businessId);
  res.json(approvals);
}));

securityRouter.post('/approvals/:id/review', requirePermission('inventory.approve'), asyncHandler(async (req, res) => {
  const result = await securityService.reviewApproval(
    req.params.id, req.user!.userId, req.body.approved, req.body.notes || '', req.user!.businessId, req
  );
  res.json(result);
}));
