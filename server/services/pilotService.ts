import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { clearSubscriptionCache } from '../lib/entitlements.js';
import { writeAuditLog } from '../lib/audit.js';

export async function getActivePilotGrant(businessId: string) {
  return prisma.businessPilotGrant.findFirst({
    where: { businessId, active: true, revokedAt: null },
    include: { plan: { include: { features: true } } },
  });
}

export async function isPilotSponsored(businessId: string): Promise<boolean> {
  return !!(await getActivePilotGrant(businessId));
}

export async function grantPilotEntitlement(params: {
  businessId: string;
  planCode: string;
  platformUserId: string;
  notes?: string;
}) {
  const business = await prisma.business.findUnique({ where: { id: params.businessId } });
  if (!business) throw new AppError('Organization not found', 404);

  const plan = await prisma.plan.findUnique({ where: { code: params.planCode } });
  if (!plan) throw new AppError('Plan not found', 404);

  const grant = await prisma.businessPilotGrant.upsert({
    where: { businessId: params.businessId },
    create: {
      businessId: params.businessId,
      planId: plan.id,
      active: true,
      notes: params.notes,
      grantedByPlatformUserId: params.platformUserId,
    },
    update: {
      planId: plan.id,
      active: true,
      notes: params.notes,
      grantedAt: new Date(),
      grantedByPlatformUserId: params.platformUserId,
      revokedAt: null,
      revokedByPlatformUserId: null,
    },
    include: { plan: true },
  });

  await prisma.organizationSubscription.updateMany({
    where: { businessId: params.businessId },
    data: { autoRenew: false },
  });

  clearSubscriptionCache(params.businessId);

  await writeAuditLog({
    action: 'PILOT_GRANT',
    module: 'PLATFORM',
    entityId: grant.id,
    details: `${business.name} → ${plan.code} (platformUser:${params.platformUserId})`,
  });

  return grant;
}

export async function revokePilotEntitlement(params: {
  businessId: string;
  platformUserId: string;
  reason?: string;
}) {
  const grant = await prisma.businessPilotGrant.findUnique({ where: { businessId: params.businessId } });
  if (!grant?.active) throw new AppError('No active pilot grant', 404);

  const updated = await prisma.businessPilotGrant.update({
    where: { id: grant.id },
    data: {
      active: false,
      revokedAt: new Date(),
      revokedByPlatformUserId: params.platformUserId,
      notes: params.reason ?? grant.notes,
    },
    include: { plan: true, business: { select: { name: true } } },
  });

  clearSubscriptionCache(params.businessId);

  await writeAuditLog({
    action: 'PILOT_REVOKE',
    module: 'PLATFORM',
    entityId: grant.id,
    details: `${params.reason ?? 'Revoked'} (platformUser:${params.platformUserId})`,
  });

  return updated;
}
