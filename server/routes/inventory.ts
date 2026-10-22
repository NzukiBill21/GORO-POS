import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { inventoryAdjustSchema, inventoryTransferSchema } from '../lib/schemas.js';

import { inventoryController } from '../controllers/inventoryController.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get('/stock', requirePermission('inventory.view'), inventoryController.listStock);
inventoryRouter.get('/summary', requirePermission('inventory.view'), inventoryController.summary);
inventoryRouter.get('/warehouses', requirePermission('inventory.view'), inventoryController.warehouses);
inventoryRouter.get('/movements/:productId', requirePermission('inventory.view'), inventoryController.movements);
inventoryRouter.post('/adjust', requirePermission('inventory.edit'), validate(inventoryAdjustSchema), inventoryController.adjust);
inventoryRouter.post('/transfer', requirePermission('inventory.edit'), validate(inventoryTransferSchema), inventoryController.transfer);
