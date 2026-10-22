import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { employeeCreateSchema, employeeInviteSchema, employeeUpdateSchema } from '../lib/schemas.js';
import { inviteEmployee } from '../services/onboardingService.js';
import { employeeController } from '../controllers/moduleControllers.js';

export const employeesRouter = Router();
employeesRouter.use(authenticate);

employeesRouter.get('/roles/list', requirePermission('employees.view', 'staff.view'), employeeController.listRoles);
employeesRouter.get('/activity/logs', requirePermission('employees.view', 'staff.view'), employeeController.activityLogs);
employeesRouter.get('/', requirePermission('employees.view', 'staff.view'), employeeController.list);
employeesRouter.post('/', requirePermission('employees.create', 'staff.create'), validate(employeeCreateSchema), employeeController.create);
employeesRouter.post(
  '/invite',
  requirePermission('employees.create', 'staff.create'),
  validate(employeeInviteSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await inviteEmployee({
        businessId: req.user!.businessId,
        invitedByUserId: req.user!.userId,
        ...req.body,
      })
    );
  })
);
employeesRouter.get('/:id/permissions', requirePermission('roles.view', 'staff.view', 'employees.view'), employeeController.listUserPermissions);
employeesRouter.post('/:id/permissions', requirePermission('roles.manage'), employeeController.grantPermission);
employeesRouter.delete('/:id/permissions/:permissionName', requirePermission('roles.manage'), employeeController.revokePermission);
employeesRouter.put('/:id', requirePermission('employees.edit', 'staff.edit'), validate(employeeUpdateSchema), employeeController.update);
employeesRouter.post('/:id/toggle', requirePermission('employees.edit', 'staff.edit'), employeeController.toggleActive);
