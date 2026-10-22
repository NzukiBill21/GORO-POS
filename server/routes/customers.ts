import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { customerController } from '../controllers/moduleControllers.js';

export const customersRouter = Router();
customersRouter.use(authenticate);

customersRouter.get('/', requirePermission('customers.view'), customerController.list);
customersRouter.get('/:id', requirePermission('customers.view'), customerController.get);
customersRouter.post('/', requirePermission('customers.create'), customerController.create);
customersRouter.put('/:id', requirePermission('customers.edit'), customerController.update);
customersRouter.delete('/:id', requirePermission('customers.delete'), customerController.delete);
customersRouter.post('/:id/points', requirePermission('customers.edit'), customerController.addPoints);
