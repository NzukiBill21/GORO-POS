import { PrismaClient } from '@prisma/client';
import { ALL_TENANT_PERMISSIONS, ROLE_PERMISSION_MAP } from '../server/lib/permissionRegistry.js';
import { seedPlatformAdmin } from '../server/services/platformAuthService.js';

export async function seedPermissionsAndRoles(prisma: PrismaClient) {
  for (const perm of ALL_TENANT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: { module: perm.module, action: perm.action },
      create: { name: perm.name, module: perm.module, action: perm.action, description: perm.name },
    });
  }

  const roleDefs = [
    { name: 'manager', description: 'Business owner / General Manager' },
    { name: 'supervisor', description: 'Client Manager / Supervisor' },
    { name: 'cashier', description: 'POS Cashier' },
    { name: 'administrator', description: 'Legacy — maps to manager permissions' },
  ];

  const roleIds: Record<string, string> = {};
  for (const r of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isSystem: true },
      create: { name: r.name, description: r.description, isSystem: true },
    });
    roleIds[r.name] = role.id;
  }

  async function assignPerms(roleName: string, permNames: string[]) {
    const roleId = roleIds[roleName];
    for (const permName of permNames) {
      const perm = await prisma.permission.findUnique({ where: { name: permName } });
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId: perm.id } },
          update: {},
          create: { roleId, permissionId: perm.id },
        });
      }
    }
  }

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
    if (perms.length > 0) await assignPerms(roleName, perms);
  }

  return roleIds;
}

const PLAN_DEFS = [
  {
    code: 'REGULAR',
    name: 'Regular',
    description: 'For small businesses',
    sortOrder: 1,
    prices: { MONTHLY: 1100, ANNUAL: 11000 },
    features: {
      max_users: '3',
      max_branches: '1',
      max_products: '500',
      max_monthly_transactions: '2000',
      advanced_reports: 'false',
      multi_branch: 'false',
      advanced_analytics: 'false',
      api_access: 'false',
      audit_logs: 'true',
    },
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'For growing businesses',
    sortOrder: 2,
    prices: { MONTHLY: 2400, ANNUAL: 24000 },
    features: {
      max_users: '15',
      max_branches: '3',
      max_products: '10000',
      max_monthly_transactions: '20000',
      advanced_reports: 'true',
      multi_branch: 'true',
      advanced_analytics: 'false',
      api_access: 'false',
      audit_logs: 'true',
    },
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'For multi-branch / advanced operations',
    sortOrder: 3,
    prices: { MONTHLY: 4300, ANNUAL: 43000 },
    features: {
      max_users: '50',
      max_branches: '10',
      max_products: '50000',
      max_monthly_transactions: '100000',
      advanced_reports: 'true',
      multi_branch: 'true',
      advanced_analytics: 'true',
      api_access: 'true',
      audit_logs: 'true',
      automated_reports: 'true',
    },
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom workflows, integrations and support',
    sortOrder: 4,
    prices: { MONTHLY: 15000, ANNUAL: 150000 },
    features: {
      max_users: '9999',
      max_branches: '9999',
      max_products: '999999',
      max_monthly_transactions: '9999999',
      advanced_reports: 'true',
      multi_branch: 'true',
      advanced_analytics: 'true',
      api_access: 'true',
      custom_integrations: 'true',
      priority_support: 'true',
      audit_logs: 'true',
      automated_reports: 'true',
    },
    isCustom: true,
  },
];

export async function seedPlans(prisma: PrismaClient) {
  const planIds: Record<string, string> = {};
  for (const p of PLAN_DEFS) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: { name: p.name, description: p.description, sortOrder: p.sortOrder, isCustom: p.isCustom ?? false },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        sortOrder: p.sortOrder,
        isCustom: p.isCustom ?? false,
      },
    });
    planIds[p.code] = plan.id;

    for (const [interval, amountCents] of Object.entries(p.prices)) {
      await prisma.planPrice.upsert({
        where: { planId_billingInterval_currency: { planId: plan.id, billingInterval: interval, currency: 'KES' } },
        update: { amountCents },
        create: { planId: plan.id, billingInterval: interval, amountCents, currency: 'KES' },
      });
    }

    for (const [feature, value] of Object.entries(p.features)) {
      await prisma.planFeature.upsert({
        where: { planId_feature: { planId: plan.id, feature } },
        update: { value },
        create: { planId: plan.id, feature, value },
      });
    }
  }
  return planIds;
}

export async function seedOrganizationSubscription(
  prisma: PrismaClient,
  businessId: string,
  planCode: string,
  billingOwnerUserId: string
) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) return;

  await prisma.business.update({
    where: { id: businessId },
    data: { billingOwnerUserId, status: 'ACTIVE', billingPhone: '254712345678' },
  });

  await prisma.billingContact.upsert({
    where: { businessId_userId: { businessId, userId: billingOwnerUserId } },
    update: { role: 'PRIMARY', isActive: true },
    create: { businessId, userId: billingOwnerUserId, role: 'PRIMARY' },
  });

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.organizationSubscription.upsert({
    where: { id: `sub-${businessId}` },
    update: {
      planId: plan.id,
      status: 'ACTIVE',
      billingInterval: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    create: {
      id: `sub-${businessId}`,
      businessId,
      planId: plan.id,
      billingInterval: 'MONTHLY',
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });
}

export async function seedPlatform(prisma: PrismaClient) {
  await seedPlatformAdmin();
}
