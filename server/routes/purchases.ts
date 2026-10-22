import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { purchaseController } from '../controllers/moduleControllers.js';

export const purchasesRouter = Router();
purchasesRouter.use(authenticate);

purchasesRouter.get('/', requirePermission('purchases.view'), purchaseController.list);
purchasesRouter.post('/', requirePermission('purchases.create'), purchaseController.create);
purchasesRouter.post('/:id/receive', requirePermission('purchases.edit'), purchaseController.receive);
purchasesRouter.get('/suppliers/list', requirePermission('purchases.view'), purchaseController.listSuppliers);
purchasesRouter.post('/suppliers', requirePermission('purchases.create'), purchaseController.createSupplier);
