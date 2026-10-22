import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import {
  getSubscriptionContext,
  requireOperationalSubscription,
  clearSubscriptionCache,
} from '../server/lib/entitlements.js';
import { grantPilotEntitlement, revokePilotEntitlement, isPilotSponsored } from '../server/services/pilotService.js';
import { SalesService } from '../server/services/salesService.js';

const IMAN_ID = 'iman-highstreet-business';
const DEMO_ID = 'demo-business';

describe('founder pilot entitlement', () => {
  let platformUserId: string;
  let branchId: string;
  let productId: string;

  beforeAll(async () => {
    const platform = await prisma.platformUser.findFirst({ where: { isActive: true } });
    platformUserId = platform!.id;

    const demoBiz = await prisma.business.findUnique({ where: { id: DEMO_ID }, select: { status: true } });
    if (demoBiz?.status === 'SUSPENDED') {
      const { reactivateOrganization } = await import('../server/services/platformOperationsService.js');
      await reactivateOrganization({
        businessId: DEMO_ID,
        platformUserId: platform!.id,
        reason: 'pilot-entitlement test baseline',
      });
      clearSubscriptionCache(DEMO_ID);
    }

    // Demo store should not carry pilot from other integration tests (e.g. lifecycle-security).
    if (await isPilotSponsored(DEMO_ID)) {
      await revokePilotEntitlement({
        businessId: DEMO_ID,
        platformUserId: platform!.id,
        reason: 'pilot-entitlement test baseline reset',
      });
      clearSubscriptionCache(DEMO_ID);
    }

    const iman = await prisma.business.findUnique({ where: { id: IMAN_ID } });
    if (!iman) {
      console.warn('Run: npx tsx scripts/seed-iman-pilot.ts — skipping Iman-specific assertions');
    }

    const branch = await prisma.branch.findFirst({ where: { businessId: DEMO_ID } });
    branchId = branch!.id;
    const product = await prisma.product.findFirst({ where: { businessId: DEMO_ID } });
    productId = product!.id;
  });

  it('demo store is not pilot sponsored by default', async () => {
    expect(await isPilotSponsored(DEMO_ID)).toBe(false);
  });

  it('pilot org is operational via grant even if subscription suspended', async () => {
    const iman = await prisma.business.findUnique({ where: { id: IMAN_ID } });
    if (!iman) return;

    await grantPilotEntitlement({
      businessId: IMAN_ID,
      planCode: 'PRO',
      platformUserId,
      notes: 'test grant',
    });

    await prisma.organizationSubscription.updateMany({
      where: { businessId: IMAN_ID },
      data: { status: 'SUSPENDED' },
    });
    clearSubscriptionCache(IMAN_ID);

    const ctx = await getSubscriptionContext(IMAN_ID);
    expect(ctx?.pilotSponsored).toBe(true);
    expect(ctx?.isOperational).toBe(true);
    await expect(requireOperationalSubscription(IMAN_ID)).resolves.toBeUndefined();
  });

  it('revoking pilot restores subscription enforcement', async () => {
    const iman = await prisma.business.findUnique({ where: { id: IMAN_ID } });
    if (!iman) return;

    await revokePilotEntitlement({ businessId: IMAN_ID, platformUserId, reason: 'test revoke' });
    clearSubscriptionCache(IMAN_ID);

    await expect(requireOperationalSubscription(IMAN_ID)).rejects.toMatchObject({ statusCode: 402 });

    await grantPilotEntitlement({
      businessId: IMAN_ID,
      planCode: 'PRO',
      platformUserId,
      notes: 'restore after test',
    });
    clearSubscriptionCache(IMAN_ID);
  });

  it('blocks legacy COMPLETED sale create', async () => {
    const sales = new SalesService();
    const user = await prisma.user.findFirst({ where: { businessId: DEMO_ID } });
    await expect(
      sales.create({
        branchId,
        userId: user!.id,
        items: [
          {
            productId,
            name: 'Test',
            quantity: 1,
            unitPrice: 100,
            total: 100,
          },
        ],
        status: 'COMPLETED',
        payments: [{ method: 'CASH', amount: 100 }],
      })
    ).rejects.toThrow(/Direct completed sales are disabled/);
  });
});
