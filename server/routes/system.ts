import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { notificationController, settingsController, reportController } from '../controllers/moduleControllers.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', requirePermission('notifications.view'), notificationController.list);
notificationsRouter.get('/unread-count', requirePermission('notifications.view'), notificationController.unreadCount);
notificationsRouter.post('/:id/read', requirePermission('notifications.view'), notificationController.markRead);
notificationsRouter.post('/read-all', requirePermission('notifications.view'), notificationController.markAllRead);

export const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get('/', requirePermission('settings.view'), settingsController.getAll);
settingsRouter.put('/business', requirePermission('settings.edit'), settingsController.updateBusiness);
settingsRouter.post('/setting', requirePermission('settings.edit'), settingsController.setSetting);
settingsRouter.post('/taxes', requirePermission('settings.edit'), settingsController.createTax);

export const reportsRouter = Router();
reportsRouter.use(authenticate);
reportsRouter.get('/sales', requirePermission('reports.view'), reportController.sales);
reportsRouter.get('/inventory', requirePermission('reports.view'), reportController.inventory);
reportsRouter.get('/profit', requirePermission('reports.view'), reportController.profit);
reportsRouter.get('/retail-summary', requirePermission('reports.view'), reportController.retailSummary);
reportsRouter.get('/stock-movements', requirePermission('reports.view'), reportController.stockMovements);
