import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { financialController } from '../controllers/moduleControllers.js';

export const financialsRouter = Router();
financialsRouter.use(authenticate);

financialsRouter.get('/expenses', requirePermission('financials.view'), financialController.listExpenses);
financialsRouter.post('/expenses', requirePermission('financials.create'), financialController.createExpense);
financialsRouter.delete('/expenses/:id', requirePermission('financials.edit'), financialController.deleteExpense);
financialsRouter.get('/summary', requirePermission('financials.view'), financialController.summary);
financialsRouter.get('/taxes', requirePermission('financials.view'), financialController.listTaxes);
