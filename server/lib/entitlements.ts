import { prisma } from './prisma.js';
import { AppError } from './errors.js';

const subscriptionCache = new Map<string, { data: SubscriptionContext; expires: number }>();
const CACHE_TTL = 30_000;

export interface SubscriptionContext {
  status: string;
  planCode: string;
  features: Record<string, string>;
  isOperational: boolean;
  pilotSponsored?: boolean;
}

const OPERATIONAL_STATUSES = new Set(['TRIALING', 'ACTIVE', 'GRACE_PERIOD']);

export async function getSubscriptionContext(businessId: string): Promise<SubscriptionContext | null> {
  const cached = subscriptionCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.data;

  const { getActivePilotGrant } = await import('../services/pilotService.js');
  const pilot = await getActivePilotGrant(businessId);
  if (pilot) {
    const features: Record<string, string> = {};
    for (const f of pilot.plan.features) {
      features[f.feature] = f.value;
    }
    const ctx: SubscriptionContext = {
      status: 'PILOT_SPONSORED',
      planCode: pilot.plan.code,
      features,
      isOperational: true,
      pilotSponsored: true,
    };
    subscriptionCache.set(businessId, { data: ctx, expires: Date.now() + CACHE_TTL });
    return ctx;
  }

  const sub = await prisma.organizationSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    include: { plan: { include: { features: true } } },
  });

  if (!sub) return null;

  const features: Record<string, string> = {};
  for (const f of sub.plan.features) {
    features[f.feature] = f.value;
  }

  const ctx: SubscriptionContext = {
    status: sub.status,
    planCode: sub.plan.code,
    features,
    isOperational: OPERATIONAL_STATUSES.has(sub.status),
  };

  subscriptionCache.set(businessId, { data: ctx, expires: Date.now() + CACHE_TTL });
  return ctx;
}

export function clearSubscriptionCache(businessId?: string) {
  if (businessId) subscriptionCache.delete(businessId);
  else subscriptionCache.clear();
}

export async function hasFeature(businessId: string, feature: string): Promise<boolean> {
  const ctx = await getSubscriptionContext(businessId);
  if (!ctx) return false;
  const val = ctx.features[feature];
  return val === 'true' || val === '1' || (val !== undefined && val !== 'false' && val !== '0' && Number(val) > 0);
}

export async function getFeatureLimit(businessId: string, feature: string): Promise<number | null> {
  const ctx = await getSubscriptionContext(businessId);
  if (!ctx) return null;
  const val = ctx.features[feature];
  if (val === undefined || val === 'true' || val === 'false') return null;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

export async function getUsageCount(businessId: string, metric: string): Promise<number> {
  if (metric === 'users') {
    return prisma.user.count({ where: { businessId, isActive: true } });
  }
  if (metric === 'branches') {
    return prisma.branch.count({ where: { businessId, isActive: true } });
  }
  if (metric === 'products') {
    return prisma.product.count({ where: { businessId, isActive: true } });
  }
  const periodKey = new Date().toISOString().slice(0, 7);
  const counter = await prisma.usageCounter.findUnique({
    where: { businessId_metric_periodKey: { businessId, metric, periodKey } },
  });
  return counter?.value ?? 0;
}

export async function withinLimit(businessId: string, feature: string): Promise<boolean> {
  const limit = await getFeatureLimit(businessId, feature);
  if (limit === null) return true;
  const usage = await getUsageCount(businessId, feature.replace('max_', ''));
  return usage < limit;
}

export async function requireOperationalSubscription(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { status: true },
  });
  if (business?.status === 'SUSPENDED') {
    throw new AppError('Organization suspended by platform administrator.', 403);
  }
  if (process.env.BILLING_ENABLED === 'false') return;
  const ctx = await getSubscriptionContext(businessId);
  if (!ctx || !ctx.isOperational) {
    throw new AppError('Subscription inactive or suspended. Update billing to restore access.', 402);
  }
}

export async function requireFeature(businessId: string, feature: string) {
  const ok = await hasFeature(businessId, feature);
  if (!ok) throw new AppError(`Feature not available on your plan: ${feature}`, 403);
}

export async function requireWithinLimit(businessId: string, limitFeature: string) {
  const ok = await withinLimit(businessId, limitFeature);
  if (!ok) {
    const limit = await getFeatureLimit(businessId, limitFeature);
    const metric = limitFeature.replace('max_', '');
    const usage = await getUsageCount(businessId, metric);
    throw new AppError(
      `Plan limit exceeded for ${metric}: ${usage} / ${limit}. Upgrade or deactivate resources.`,
      403
    );
  }
}
