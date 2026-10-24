import { hashPasswordUnsafe, validatePasswordComplexity } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { PaginationParams, paginateResult, skipTake } from '../lib/pagination.js';
import { logActivity } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { getBusinessUserIds, safeOrderBy } from '../lib/tenant.js';
import { ASSIGNABLE_TENANT_ROLES, FORBIDDEN_TENANT_ROLES } from '../lib/permissionRegistry.js';
import { requireWithinLimit } from '../lib/entitlements.js';
import { clearPermissionCache } from '../lib/permissions.js';

async function validateRoleAssignment(roleId: string, actorUserId: string, targetUserId?: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError('Invalid role', 400);
  const name = role.name.toLowerCase();
  if (FORBIDDEN_TENANT_ROLES.includes(name as typeof FORBIDDEN_TENANT_ROLES[number])) {
    throw new AppError('Cannot assign platform or legacy admin roles to organization users', 403);
  }
  if (!ASSIGNABLE_TENANT_ROLES.includes(name as typeof ASSIGNABLE_TENANT_ROLES[number])) {
    throw new AppError('Invalid role for organization user', 400);
  }
  if (targetUserId && targetUserId === actorUserId) {
    throw new AppError('Cannot change your own role', 403);
  }
}

export class EmployeeService {
  async validateInviteRole(roleId: string, actorUserId: string) {
    await validateRoleAssignment(roleId, actorUserId);
  }

  async list(businessId: string, params: PaginationParams) {
    const { page = 1, limit = 20, search, sortBy, sortOrder = 'asc' } = params;

    const where = {
      businessId,
      ...(search && {
        OR: [
          { firstName: { contains: search as string } },
          { lastName: { contains: search as string } },
          { email: { contains: search as string } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { role: true, branch: { select: { name: true } } },
        orderBy: safeOrderBy('employee', sortBy, sortOrder),
        ...skipTake(page, limit),
      }),
      prisma.user.count({ where }),
    ]);

    return paginateResult(
      users.map(({ passwordHash, pin, ...u }) => u),
      total,
      page,
      limit
    );
  }

  async create(businessId: string, userId: string, data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roleId: string;
    branchId?: string;
    phone?: string;
    pin?: string;
  }) {
    await requireWithinLimit(businessId, 'max_users');
    await validateRoleAssignment(data.roleId, userId);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError('Email already in use');

    const complexity = validatePasswordComplexity(data.password);
    if (!complexity.valid) throw new AppError(complexity.errors.join('. '), 400);

    const passwordHash = await hashPasswordUnsafe(data.password);
    const pinHash = data.pin ? await hashPasswordUnsafe(data.pin) : undefined;
    const { resolveBranchIdForBusiness } = await import('../lib/branchContext.js');
    const branchId = data.branchId ?? (await resolveBranchIdForBusiness(businessId));
    const user = await prisma.user.create({
      data: {
        businessId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        roleId: data.roleId,
        branchId,
        phone: data.phone,
        pin: pinHash,
        emailVerifiedAt: new Date(),
        mustSetPassword: false,
        mustChangePassword: true,
      },
      include: { role: true, branch: { select: { name: true } } },
    });

    await logActivity({ userId, action: 'CREATE', module: 'EMPLOYEES', entityId: user.id, details: `Created employee: ${user.firstName} ${user.lastName}` });
    const { passwordHash: _, pin: __, ...safe } = user;
    return safe;
  }

  async update(id: string, businessId: string, userId: string, data: Record<string, unknown>) {
    const existing = await prisma.user.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError('Employee not found', 404);

    const allowedFields = ['firstName', 'lastName', 'roleId', 'branchId', 'phone', 'pin'] as const;
    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    if (data.password) {
      updateData.passwordHash = await hashPasswordUnsafe(data.password as string);
    }
    if (data.pin !== undefined) {
      updateData.pin = data.pin ? await hashPasswordUnsafe(data.pin as string) : null;
    }
    const roleChanged = Boolean(data.roleId && data.roleId !== existing.roleId);
    if (roleChanged) {
      await validateRoleAssignment(data.roleId as string, userId, id);
      updateData.roleId = data.roleId;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true, branch: { select: { name: true } } },
    });

    if (roleChanged || data.password) {
      const { bumpUserTokenVersion } = await import('../lib/tokenVersion.js');
      await bumpUserTokenVersion(id);
    }
    await logActivity({ userId, action: 'UPDATE', module: 'EMPLOYEES', entityId: id, details: `Updated employee: ${user.firstName}` });
    clearPermissionCache(id);
    const { passwordHash: _, pin: __, ...safe } = user;
    return safe;
  }

  async toggleActive(id: string, businessId: string, userId: string) {
    const user = await prisma.user.findFirst({ where: { id, businessId } });
    if (!user) throw new AppError('Employee not found', 404);

    const updated = await prisma.user.update({ where: { id }, data: { isActive: !user.isActive } });
    await logActivity({ userId, action: 'UPDATE', module: 'EMPLOYEES', entityId: id, details: `${updated.isActive ? 'Activated' : 'Deactivated'} employee` });
    return updated;
  }

  async grantPermission(businessId: string, actorUserId: string, targetUserId: string, permissionName: string) {
    const target = await prisma.user.findFirst({ where: { id: targetUserId, businessId } });
    if (!target) throw new AppError('Employee not found', 404);

    const permission = await prisma.permission.findUnique({ where: { name: permissionName } });
    if (!permission) throw new AppError('Invalid permission', 400);

    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: targetUserId, permissionId: permission.id } },
      create: { userId: targetUserId, permissionId: permission.id, grantedBy: actorUserId },
      update: { grantedBy: actorUserId },
    });

    await logActivity({
      userId: actorUserId,
      action: 'PERMISSION_GRANTED',
      module: 'EMPLOYEES',
      entityId: targetUserId,
      details: `Granted ${permissionName} to ${target.firstName} ${target.lastName}`,
    });
    clearPermissionCache(targetUserId);
    return { userId: targetUserId, permission: permissionName };
  }

  async revokePermission(businessId: string, actorUserId: string, targetUserId: string, permissionName: string) {
    const target = await prisma.user.findFirst({ where: { id: targetUserId, businessId } });
    if (!target) throw new AppError('Employee not found', 404);

    const permission = await prisma.permission.findUnique({ where: { name: permissionName } });
    if (!permission) throw new AppError('Invalid permission', 400);

    await prisma.userPermission.deleteMany({
      where: { userId: targetUserId, permissionId: permission.id },
    });

    await logActivity({
      userId: actorUserId,
      action: 'PERMISSION_REVOKED',
      module: 'EMPLOYEES',
      entityId: targetUserId,
      details: `Revoked ${permissionName} from ${target.firstName} ${target.lastName}`,
    });
    clearPermissionCache(targetUserId);
    return { userId: targetUserId, permission: permissionName };
  }

  async listUserPermissions(businessId: string, targetUserId: string) {
    const target = await prisma.user.findFirst({ where: { id: targetUserId, businessId } });
    if (!target) throw new AppError('Employee not found', 404);

    const grants = await prisma.userPermission.findMany({
      where: { userId: targetUserId },
      include: { permission: true },
    });
    return grants.map((g) => g.permission.name);
  }

  async listRoles() {
    return prisma.role.findMany({
      where: { name: { in: [...ASSIGNABLE_TENANT_ROLES] } },
      orderBy: { name: 'asc' },
    });
  }

  async getActivityLogs(businessId: string, params: PaginationParams & { userId?: string; module?: string }) {
    const { page = 1, limit = 20, userId, module } = params;
    const businessUserIds = await getBusinessUserIds(businessId);

    const where = {
      userId: userId && businessUserIds.includes(userId) ? userId : { in: businessUserIds },
      ...(module && { module }),
    };

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
      }),
      prisma.activityLog.count({ where }),
    ]);

    return paginateResult(logs, total, page, limit);
  }
}

export const employeeService = new EmployeeService();
