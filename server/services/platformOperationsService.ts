import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { hashPasswordUnsafe } from '../lib/password.js';
import { generateSecureToken } from '../lib/crypto.js';
import { clearSubscriptionCache } from '../lib/entitlements.js';
import { writePlatformAuditLog } from '../lib/platformAudit.js';
import { billingService } from './billingService.js';
import { grantPilotEntitlement, revokePilotEntitlement } from './pilotService.js';
import { terminateUserSessions } from '../lib/audit.js';
import { assertMpesaMockAllowed } from '../lib/mpesaMockGuard.js';
import { provisionBusinessWithOwner } from './businessProvisioningService.js';
import { createOwnerInvitationForUser } from './onboardingService.js';

function onboardingProgress(business: {
  _count: { users: number; products: number };
  subscriptions: Array<{ status: string }>;
}) {
  const steps: string[] = [];
  if (business._count.users > 0) steps.push('owner');
  if (business.subscriptions.length) steps.push('subscription');
  if (business._count.products > 0) steps.push('catalog');
  return { completed: steps.length, steps, label: `${steps.length}/3 setup steps` };
}

export async function getPlatformHealth() {
  let mpesaMockOk = true;
  try {
    assertMpesaMockAllowed();
  } catch {
    mpesaMockOk = false;
  }

  const [dbOk, orgCount, pendingPayments, failedPayments24h] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.business.count(),
    prisma.billingPayment.count({ where: { status: 'PENDING' } }),
    prisma.billingPayment.count({
      where: {
        status: 'FAILED',
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return {
    dbOk,
    orgCount,
    pendingBillingPayments: pendingPayments,
    failedBillingPayments24h: failedPayments24h,
    billingEnabled: process.env.BILLING_ENABLED !== 'false',
    mpesaEnv: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    mpesaMockEnabled: process.env.MPESA_MOCK === 'true',
    mpesaMockProductionSafe: mpesaMockOk,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}

export async function getPlatformOverviewExtended() {
  const base = await billingService.getPlatformBillingOverview();
  const [pilotActive, paymentsByStatus, recentAttempts] = await Promise.all([
    prisma.businessPilotGrant.count({ where: { active: true, revokedAt: null } }),
    prisma.billingPayment.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.billingPaymentAttempt.findMany({
      orderBy: { attemptedAt: 'desc' },
      take: 15,
      include: {
        payment: {
          select: {
            id: true,
            status: true,
            amountCents: true,
            business: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const row of paymentsByStatus) {
    statusMap[row.status] = row._count.id;
  }

  const verifiedRevenueCents = await prisma.billingPayment.aggregate({
    where: { status: 'SUCCEEDED' },
    _sum: { amountCents: true },
  });

  const mpesaEnv = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  const recentBillingPayments = await prisma.billingPayment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: {
      business: { select: { name: true } },
      providerTx: { take: 1, select: { id: true, providerTransactionId: true } },
    },
  });

  return {
    ...base,
    pilotActiveCount: pilotActive,
    paymentsByStatus: statusMap,
    verifiedRevenueCents: verifiedRevenueCents._sum.amountCents ?? 0,
    recentBillingPayments: recentBillingPayments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      paidAt: p.paidAt,
      failureReason: p.failureReason,
      businessName: p.business.name,
      verifiedCallback: p.status === 'SUCCEEDED' && p.providerTx.length > 0,
      paymentEnvironment: mpesaEnv,
    })),
    recentPaymentAttempts: recentAttempts.map((a) => ({
      id: a.id,
      status: a.status,
      failureReason: a.failureReason,
      attemptedAt: a.attemptedAt,
      paymentId: a.paymentId,
      paymentStatus: a.payment.status,
      amountCents: a.payment.amountCents,
      businessName: a.payment.business?.name,
    })),
    health: await getPlatformHealth(),
  };
}

export async function listOrganizations(params: {
  search?: string;
  status?: string;
  pilotOnly?: boolean;
}) {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }
  if (params.pilotOnly) {
    where.pilotGrant = { active: true, revokedAt: null };
  }

  const orgs = await prisma.business.findMany({
    where,
    include: {
      subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      pilotGrant: { include: { plan: { select: { code: true, name: true } } } },
      _count: { select: { users: true, products: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const ownerIds = orgs.map((o) => o.billingOwnerUserId).filter(Boolean) as string[];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, email: true, firstName: true, lastName: true, lastLoginAt: true },
  });
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  const lastSessions = await prisma.session.groupBy({
    by: ['businessId'],
    where: { businessId: { in: orgs.map((o) => o.id) } },
    _max: { lastActivityAt: true },
  });
  const lastActivityByBiz = new Map(lastSessions.map((s) => [s.businessId, s._max.lastActivityAt]));

  return orgs.map((org) => {
    const owner = org.billingOwnerUserId ? ownerById.get(org.billingOwnerUserId) : null;
    const sub = org.subscriptions[0];
    return {
      id: org.id,
      name: org.name,
      email: org.email,
      status: org.status,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      userCount: org._count.users,
      productCount: org._count.products,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            planCode: sub.plan.code,
            planName: sub.plan.name,
            billingInterval: sub.billingInterval,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      pilot: org.pilotGrant?.active
        ? { planCode: org.pilotGrant.plan?.code, grantedAt: org.pilotGrant.grantedAt }
        : null,
      owner,
      lastActivityAt: lastActivityByBiz.get(org.id) ?? owner?.lastLoginAt ?? null,
      onboarding: onboardingProgress(org),
    };
  });
}

export async function getOrganizationDetail(businessId: string) {
  const org = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      subscriptions: { include: { plan: true, events: { orderBy: { createdAt: 'desc' }, take: 20 } } },
      pilotGrant: { include: { plan: true } },
      billingPayments: {
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { providerTx: { take: 1, select: { id: true, providerTransactionId: true } } },
      },
      billingInvoices: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { users: true, products: true } },
    },
  });
  if (!org) throw new AppError('Organization not found', 404);

  const owner = org.billingOwnerUserId
    ? await prisma.user.findUnique({
        where: { id: org.billingOwnerUserId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          lastLoginAt: true,
          mustSetPassword: true,
          emailVerifiedAt: true,
          role: { select: { name: true } },
        },
      })
    : null;

  const pendingOwnerInvite = owner?.mustSetPassword
    ? await prisma.userInvitation.findFirst({
        where: { businessId, userId: owner.id, inviteType: 'OWNER_SETUP', acceptedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          expiresAt: true,
          emailSentAt: true,
          emailDeliveryError: true,
          createdAt: true,
        },
      })
    : null;

  const lastSession = await prisma.session.aggregate({
    where: { businessId },
    _max: { lastActivityAt: true },
  });

  const mpesaEnv = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  const subscription = org.subscriptions[0] ?? null;

  const platformAudit = await prisma.platformAuditLog.findMany({
    where: { targetBusinessId: businessId },
    orderBy: { createdAt: 'desc' },
    take: 40,
    include: { platformUser: { select: { email: true, firstName: true, lastName: true } } },
  });

  return {
    id: org.id,
    name: org.name,
    email: org.email,
    status: org.status,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    owner,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          planCode: subscription.plan.code,
          planName: subscription.plan.name,
          billingInterval: subscription.billingInterval,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          currentPeriodStart: subscription.currentPeriodStart,
        }
      : null,
    pilot: org.pilotGrant?.active
      ? {
          planCode: org.pilotGrant.plan?.code,
          planName: org.pilotGrant.plan?.name,
          grantedAt: org.pilotGrant.grantedAt,
          notes: org.pilotGrant.notes,
        }
      : null,
    onboarding: onboardingProgress(org),
    lastActivityAt: lastSession._max.lastActivityAt,
    userCount: org._count.users,
    productCount: org._count.products,
    ownerInvitation: pendingOwnerInvite
      ? {
          inviteId: pendingOwnerInvite.id,
          expiresAt: pendingOwnerInvite.expiresAt,
          emailSentAt: pendingOwnerInvite.emailSentAt,
          emailDeliveryError: pendingOwnerInvite.emailDeliveryError,
          pendingSetup: true,
        }
      : owner?.mustSetPassword
        ? { pendingSetup: true, emailDeliveryError: 'No active invitation token' }
        : null,
    billingPayments: org.billingPayments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      paidAt: p.paidAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      verifiedCallback: p.status === 'SUCCEEDED' && p.providerTx.length > 0,
      paymentEnvironment: mpesaEnv,
    })),
    billingInvoices: org.billingInvoices,
    subscriptionEvents: subscription?.events ?? [],
    platformAudit,
  };
}

export async function createTenantWithOwner(params: {
  businessName: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  planCode?: string;
  platformUserId: string;
  ipAddress?: string;
  /** Local provision: skip email invite; owner signs in with temp password and must change it. */
  ownerInitialPassword?: string;
}) {
  const email = params.ownerEmail.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Owner email already in use', 409);

  const localPassword = params.ownerInitialPassword?.trim();
  if (localPassword) {
    const { isLocalTenantProvisioningEnabled } = await import('../lib/localProvisioning.js');
    const { validatePasswordComplexity } = await import('../lib/password.js');
    if (!isLocalTenantProvisioningEnabled()) {
      throw new AppError(
        'Local owner provisioning is disabled. Use email invitation or set ALLOW_LOCAL_TENANT_PROVISION=true for desktop installs.',
        403,
        'LOCAL_PROVISION_DISABLED'
      );
    }
    const complexity = validatePasswordComplexity(localPassword);
    if (!complexity.valid) throw new AppError(complexity.errors.join('. '), 400);

    const ownerPasswordHash = await hashPasswordUnsafe(localPassword);
    const result = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: params.businessName,
        ownerEmail: email,
        ownerFirstName: params.ownerFirstName,
        ownerLastName: params.ownerLastName,
        ownerPasswordHash,
        planCode: params.planCode ?? 'REGULAR',
        emailVerified: true,
        mustSetPassword: false,
        mustChangePassword: true,
      })
    );

    await writePlatformAuditLog({
      platformUserId: params.platformUserId,
      action: 'TENANT_CREATE',
      targetBusinessId: result.businessId,
      details: `Created tenant ${params.businessName} owner ${email} (local temp password)`,
      ipAddress: params.ipAddress,
    });

    return {
      businessId: result.businessId,
      ownerId: result.ownerId,
      ownerEmail: email,
      invitation: null,
      message:
        'Tenant created. Give the owner their email and temporary password — they must change it on first sign-in.',
    };
  }

  const placeholderHash = await hashPasswordUnsafe(generateSecureToken(32));

  const result = await prisma.$transaction(async (tx) =>
    provisionBusinessWithOwner(tx, {
      businessName: params.businessName,
      ownerEmail: email,
      ownerFirstName: params.ownerFirstName,
      ownerLastName: params.ownerLastName,
      ownerPasswordHash: placeholderHash,
      planCode: params.planCode ?? 'REGULAR',
      emailVerified: true,
      mustSetPassword: true,
    })
  );

  const invitation = await createOwnerInvitationForUser({
    userId: result.ownerId,
    businessId: result.businessId,
    email,
    invitedByPlatformUserId: params.platformUserId,
  });

  await writePlatformAuditLog({
    platformUserId: params.platformUserId,
    action: 'TENANT_CREATE',
    targetBusinessId: result.businessId,
    details: `Created tenant ${params.businessName} owner ${email} (invitation sent)`,
    ipAddress: params.ipAddress,
  });

  const message =
    invitation.deliveryStatus === 'SENT'
      ? 'Tenant created. Owner invitation email sent — they must set a password before signing in.'
      : invitation.deliveryStatus === 'FAILED'
        ? `Tenant created but invitation email failed: ${invitation.emailDeliveryError ?? 'unknown error'}. Use Resend invitation from the organization detail view.`
        : invitation.deliveryStatus === 'DEV_LOGGED'
          ? 'Tenant created. Invitation logged server-side (development only).'
          : 'Tenant created. Configure SMTP to email the owner invitation, or resend from organization detail.';

  return {
    businessId: result.businessId,
    ownerId: result.ownerId,
    ownerEmail: email,
    invitation,
    message,
  };
}

export async function suspendOrganization(params: {
  businessId: string;
  platformUserId: string;
  reason: string;
  ipAddress?: string;
}) {
  if (!params.reason?.trim() || params.reason.trim().length < 3) {
    throw new AppError('Suspension reason is required', 400);
  }

  const org = await prisma.business.update({
    where: { id: params.businessId },
    data: { status: 'SUSPENDED' },
  });

  const sub = await prisma.organizationSubscription.findFirst({
    where: { businessId: org.id },
    orderBy: { createdAt: 'desc' },
  });
  if (sub) {
    await prisma.organizationSubscription.update({
      where: { id: sub.id },
      data: { status: 'SUSPENDED' },
    });
    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        eventType: 'PLATFORM_SUSPENDED',
        previousStatus: sub.status,
        newStatus: 'SUSPENDED',
        metadata: JSON.stringify({ reason: params.reason.trim(), platformUserId: params.platformUserId }),
      },
    });
  }

  const users = await prisma.user.findMany({ where: { businessId: org.id }, select: { id: true } });
  for (const u of users) {
    await terminateUserSessions(u.id);
  }

  clearSubscriptionCache(org.id);

  await writePlatformAuditLog({
    platformUserId: params.platformUserId,
    action: 'ORG_SUSPEND',
    targetBusinessId: org.id,
    reason: params.reason.trim(),
    ipAddress: params.ipAddress,
  });

  return org;
}

export async function reactivateOrganization(params: {
  businessId: string;
  platformUserId: string;
  reason?: string;
  ipAddress?: string;
}) {
  const org = await prisma.business.update({
    where: { id: params.businessId },
    data: { status: 'ACTIVE' },
  });

  const sub = await prisma.organizationSubscription.findFirst({
    where: { businessId: org.id },
    orderBy: { createdAt: 'desc' },
  });
  if (sub && (sub.status === 'SUSPENDED' || sub.status === 'EXPIRED')) {
    const newStatus = sub.trialEndsAt && sub.trialEndsAt > new Date() ? 'TRIALING' : 'ACTIVE';
    await prisma.organizationSubscription.update({
      where: { id: sub.id },
      data: { status: newStatus },
    });
    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        eventType: 'PLATFORM_REACTIVATED',
        previousStatus: sub.status,
        newStatus,
        metadata: JSON.stringify({ platformUserId: params.platformUserId }),
      },
    });
  }

  clearSubscriptionCache(org.id);

  await writePlatformAuditLog({
    platformUserId: params.platformUserId,
    action: 'ORG_REACTIVATE',
    targetBusinessId: org.id,
    reason: params.reason,
    ipAddress: params.ipAddress,
  });

  return org;
}

export async function changeOrganizationPlan(params: {
  businessId: string;
  planCode: string;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  platformUserId: string;
  reason?: string;
  ipAddress?: string;
}) {
  const owner = await prisma.user.findFirst({
    where: { businessId: params.businessId, role: { name: 'manager' } },
    select: { id: true },
  });
  if (!owner) throw new AppError('No owner user found for tenant', 404);

  const updated = await billingService.changePlan(
    params.businessId,
    owner.id,
    params.planCode,
    params.billingInterval
  );

  await writePlatformAuditLog({
    platformUserId: params.platformUserId,
    action: 'PLAN_CHANGE',
    targetBusinessId: params.businessId,
    reason: params.reason,
    details: `${params.planCode} ${params.billingInterval}`,
    ipAddress: params.ipAddress,
  });

  clearSubscriptionCache(params.businessId);
  return updated;
}

export async function listPlatformAuditLogs(limit = 50) {
  return prisma.platformAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: {
      platformUser: { select: { email: true, firstName: true, lastName: true } },
    },
  });
}

export { grantPilotEntitlement, revokePilotEntitlement };
