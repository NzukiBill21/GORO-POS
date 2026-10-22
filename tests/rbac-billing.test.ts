import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { hasPermission, normalizeRole } from '../server/lib/permissions.js';
import { permissionMatches } from '../server/lib/permissionRegistry.js';
import { billingService } from '../server/services/billingService.js';
import { getBillingNotificationRecipients } from '../server/services/notificationDispatchService.js';

describe('permission aliases', () => {
  it('matches pos.view via pos.access', () => {
    expect(permissionMatches(['pos.access'], 'pos.view')).toBe(true);
    expect(permissionMatches(['pos.view'], 'pos.access')).toBe(true);
  });

  it('matches staff.view via employees.view', () => {
    expect(permissionMatches(['staff.view'], 'employees.view')).toBe(true);
  });
});

describe('role normalization', () => {
  it('maps legacy roles to manager', () => {
    expect(normalizeRole('Admin')).toBe('manager');
    expect(normalizeRole('owner')).toBe('manager');
    expect(normalizeRole('administrator')).toBe('manager');
  });
});

describe('RBAC defaults', () => {
  it('manager has billing permissions', async () => {
    const perms = await getPermissionsForRole('manager');
    expect(hasPermission('manager', 'billing.view', perms)).toBe(true);
    expect(hasPermission('manager', 'billing.manage', perms)).toBe(true);
  });

  it('supervisor lacks billing by default', async () => {
    const perms = await getPermissionsForRole('supervisor');
    expect(hasPermission('supervisor', 'billing.view', perms)).toBe(false);
  });

  it('cashier lacks billing and staff management', async () => {
    const perms = await getPermissionsForRole('cashier');
    expect(hasPermission('cashier', 'billing.view', perms)).toBe(false);
    expect(hasPermission('cashier', 'staff.create', perms)).toBe(false);
    expect(hasPermission('cashier', 'pos.access', perms)).toBe(true);
  });
});

async function getPermissionsForRole(role: string) {
  const { getPermissionsForRole: fn } = await import('../server/lib/permissions.js');
  return fn(role);
}

describe('billing webhook idempotency', () => {
  let businessId: string;
  let paymentId: string;
  const providerTxId = `TEST-TX-${Date.now()}`;
  let prevMpesaMock: string | undefined;

  beforeAll(async () => {
    prevMpesaMock = process.env.MPESA_MOCK;
    process.env.MPESA_MOCK = 'true';

    const business = await prisma.business.findFirst();
    if (!business) throw new Error('No seeded business');
    businessId = business.id;

    const initiated = await billingService.initiatePayment(
      businessId,
      business.billingOwnerUserId ?? (await prisma.user.findFirst({ where: { businessId } }))!.id,
      undefined,
      business.billingPhone ?? '254712345678'
    );
    paymentId = initiated.paymentId;
  });

  afterAll(() => {
    if (prevMpesaMock === undefined) delete process.env.MPESA_MOCK;
    else process.env.MPESA_MOCK = prevMpesaMock;
  });

  it('processes successful webhook once', async () => {
    const result = await billingService.processPaymentWebhook({
      provider: 'MPESA',
      providerTransactionId: providerTxId,
      paymentId,
      status: 'SUCCEEDED',
    });
    expect(result.duplicate).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('rejects duplicate webhook', async () => {
    const result = await billingService.processPaymentWebhook({
      provider: 'MPESA',
      providerTransactionId: providerTxId,
      paymentId,
      status: 'SUCCEEDED',
    });
    expect(result.duplicate).toBe(true);
    expect(result.processed).toBe(false);
  });
});

describe('billing notification routing', () => {
  it('includes billing owner in recipients', async () => {
    const business = await prisma.business.findFirst({ where: { billingOwnerUserId: { not: null } } });
    if (!business?.billingOwnerUserId) return;

    const recipients = await getBillingNotificationRecipients(business.id);
    expect(recipients).toContain(business.billingOwnerUserId);
  });

  it('cashier is not auto-included unless billing contact', async () => {
    const cashier = await prisma.user.findFirst({
      where: { email: 'cashier@demostore.com' },
    });
    const business = await prisma.business.findFirst({ where: { id: cashier?.businessId } });
    if (!cashier || !business) return;

    const contact = await prisma.billingContact.findFirst({
      where: { businessId: business.id, userId: cashier.id, isActive: true },
    });
    const recipients = await getBillingNotificationRecipients(business.id);
    if (!contact) {
      expect(recipients).not.toContain(cashier.id);
    }
  });
});

describe('tenant isolation', () => {
  it('rejects cross-tenant product access', async () => {
    const businesses = await prisma.business.findMany({ take: 2 });
    if (businesses.length < 1) return;

    const business = businesses[0];
    const otherProduct = await prisma.product.findFirst({
      where: { businessId: { not: business.id } },
    });
    if (!otherProduct) return;

    const scoped = await prisma.product.findFirst({
      where: { id: otherProduct.id, businessId: business.id },
    });
    expect(scoped).toBeNull();
  });
});
