import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { saleCreateSchema } from '../lib/schemas.js';
import { salesController } from '../controllers/salesController.js';
import { strictRateLimit } from '../middleware/rateLimit.js';

export const salesRouter = Router();
salesRouter.use(authenticate);

salesRouter.get('/', requirePermission('sales.view'), salesController.list);
salesRouter.get('/held', requirePermission('sales.view'), salesController.held);
salesRouter.get('/:id', requirePermission('sales.view'), salesController.get);
salesRouter.post('/', requirePermission('sales.create'), validate(saleCreateSchema), salesController.create);
salesRouter.post('/hold', requirePermission('sales.create'), validate(saleCreateSchema), salesController.hold);
salesRouter.post('/:id/resume', requirePermission('sales.create'), salesController.resume);
salesRouter.post('/:id/cancel', requirePermission('sales.void'), salesController.cancel);
salesRouter.post('/:id/refund', requirePermission('sales.refund'), strictRateLimit, salesController.refund);
