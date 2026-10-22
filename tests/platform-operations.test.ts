import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { requireOperationalSubscription, clearSubscriptionCache } from '../server/lib/entitlements.js';
import {
  suspendOrganization,
  reactivateOrganization,
  createTenantWithOwner,
} from '../server/services/platformOperationsService.js';
import { grantPilotEntitlement } from '../server/services/pilotService.js';
import { provisionBusinessWithOwner } from '../server/services/businessProvisioningService.js';
import { hashPasswordUnsafe } from '../server/lib/password.js';
import { generateSecureToken } from '../server/lib/crypto.js';

const DEMO_ID = 'demo-business';

describe('platform operations', () => {
  let platformUserId: string;

  beforeAll(async () => {
    const platform = await prisma.platformUser.findFirst({ where: { isActive: true } });
    expect(platform).toBeTruthy();
    platformUserId = platform!.id;
  });

  it('requires reason for platform suspend', async () => {
    await expect(
      suspendOrganization({
        businessId: DEMO_ID,
        platformUserId,
        reason: 'ab',
      })
    ).rejects.toThrow(/reason/i);
  });

  it('platform suspend blocks API entitlement even with active pilot', async () => {
    const placeholderHash = await hashPasswordUnsafe(generateSecureToken(32));
    const email = `suspend-pilot-${Date.now()}@example.com`;
    const provisioned = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: 'Suspend Pilot Test',
        ownerEmail: email,
        ownerFirstName: 'Sp',
        ownerLastName: 'Test',
        ownerPasswordHash: placeholderHash,
        mustSetPassword: false,
        emailVerified: true,
      })
    );

    await grantPilotEntitlement({
      businessId: provisioned.businessId,
      planCode: 'PRO',
      platformUserId,
      notes: 'platform-operations suspend test',
    });
    clearSubscriptionCache(provisioned.businessId);

    await suspendOrganization({
      businessId: provisioned.businessId,
      platformUserId,
      reason: 'Automated test suspension',
    });
    clearSubscriptionCache(provisioned.businessId);
    await expect(requireOperationalSubscription(provisioned.businessId)).rejects.toThrow(
      /Organization suspended/i
    );

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });

  it('creates tenant with owner and subscription', async () => {
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    process.env.REGISTRATION_DEV_LOG = 'true';
    const { resetMailTransportCache } = await import('../server/lib/mail.js');
    resetMailTransportCache();

    const email = `platform-test-${Date.now()}@example.com`;
    const result = await createTenantWithOwner({
      businessName: 'Platform Test Shop',
      ownerEmail: email,
      ownerFirstName: 'Test',
      ownerLastName: 'Owner',
      platformUserId,
    });
    expect(result.businessId).toBeTruthy();
    expect(result.invitation?.deliveryStatus).toBeTruthy();
    expect(result.invitation).not.toHaveProperty('devToken');
    expect(result.invitation).not.toHaveProperty('inviteUrl');
    const owner = await prisma.user.findUnique({ where: { id: result.ownerId } });
    expect(owner?.mustSetPassword).toBe(true);

    const sub = await prisma.organizationSubscription.findFirst({
      where: { businessId: result.businessId },
    });
    expect(sub?.status).toBe('TRIALING');

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'TENANT_CREATE', targetBusinessId: result.businessId },
    });
    expect(audit).toBeTruthy();

    await prisma.business.delete({ where: { id: result.businessId } });
  });
});
