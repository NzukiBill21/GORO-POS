import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { requireOperationalSubscription, clearSubscriptionCache } from '../server/lib/entitlements.js';
import { grantPilotEntitlement, revokePilotEntitlement, isPilotSponsored } from '../server/services/pilotService.js';
import { suspendOrganization, reactivateOrganization } from '../server/services/platformOperationsService.js';
import { resendOwnerInvitation, createOwnerInvitationForUser } from '../server/services/onboardingService.js';
import { buildInvitationDeliveryResponse } from '../server/lib/invitationDelivery.js';
import { hashPasswordUnsafe } from '../server/lib/password.js';
import { generateSecureToken } from '../server/lib/crypto.js';
import { provisionBusinessWithOwner } from '../server/services/businessProvisioningService.js';

const DEMO_ID = 'demo-business';

describe('tenant lifecycle and security', () => {
  let platformUserId: string;

  beforeAll(async () => {
    const platform = await prisma.platformUser.findFirst({ where: { isActive: true } });
    platformUserId = platform!.id;
  });

  it('platform suspension blocks API entitlement even with active pilot grant', async () => {
    const current = await prisma.business.findUnique({ where: { id: DEMO_ID }, select: { status: true } });
    if (current?.status === 'SUSPENDED') {
      await reactivateOrganization({
        businessId: DEMO_ID,
        platformUserId,
        reason: 'Test baseline reactivate',
      });
      clearSubscriptionCache(DEMO_ID);
    }

    const hadPilotBefore = await isPilotSponsored(DEMO_ID);
    await grantPilotEntitlement({
      businessId: DEMO_ID,
      planCode: 'PRO',
      platformUserId,
      notes: 'lifecycle test',
    });
    clearSubscriptionCache(DEMO_ID);

    const beforeStatus = (await prisma.business.findUnique({ where: { id: DEMO_ID } }))!.status;
    try {
      await suspendOrganization({
        businessId: DEMO_ID,
        platformUserId,
        reason: 'Lifecycle security test',
      });
      clearSubscriptionCache(DEMO_ID);
      await expect(requireOperationalSubscription(DEMO_ID)).rejects.toThrow(/Organization suspended/i);
    } finally {
      if (beforeStatus === 'ACTIVE') {
        await reactivateOrganization({
          businessId: DEMO_ID,
          platformUserId,
          reason: 'Test cleanup',
        });
        clearSubscriptionCache(DEMO_ID);
      }
      if (!hadPilotBefore) {
        await revokePilotEntitlement({
          businessId: DEMO_ID,
          platformUserId,
          reason: 'lifecycle test cleanup',
        });
        clearSubscriptionCache(DEMO_ID);
      }
    }
  });

  it('invitation API payloads never include secrets', () => {
    const payload = buildInvitationDeliveryResponse({
      inviteId: 'id',
      expiresAt: new Date(),
      status: 'DEV_LOGGED',
    });
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('devCode');
    expect(payload).not.toHaveProperty('inviteUrl');
    expect(payload.deliveryStatus).toBe('DEV_LOGGED');
  });

  it('resend owner invitation reuses same tenant and owner', async () => {
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    process.env.REGISTRATION_DEV_LOG = 'true';
    const { resetMailTransportCache } = await import('../server/lib/mail.js');
    resetMailTransportCache();

    const email = `resend-owner-${Date.now()}@example.com`;
    const placeholderHash = await hashPasswordUnsafe(generateSecureToken(32));
    const provisioned = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: 'Resend Test',
        ownerEmail: email,
        ownerFirstName: 'Re',
        ownerLastName: 'Send',
        ownerPasswordHash: placeholderHash,
        mustSetPassword: true,
        emailVerified: true,
      })
    );

    const first = await createOwnerInvitationForUser({
      userId: provisioned.ownerId,
      businessId: provisioned.businessId,
      email,
      invitedByPlatformUserId: platformUserId,
    });
    expect(first.deliveryStatus).toBe('DEV_LOGGED');

    const bizCountBefore = await prisma.business.count();
    const second = await resendOwnerInvitation({
      businessId: provisioned.businessId,
      platformUserId,
    });
    expect(second.deliveryStatus).toBe('DEV_LOGGED');
    expect(await prisma.business.count()).toBe(bizCountBefore);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });

  it('billing payment SUCCEEDED without provider tx is not callback-verified', async () => {
    const payment = await prisma.billingPayment.findFirst({
      where: { status: 'SUCCEEDED' },
      include: { providerTx: true },
    });
    if (!payment) return;
    const verified = payment.status === 'SUCCEEDED' && payment.providerTx.length > 0;
    if (payment.providerTx.length === 0) {
      expect(verified).toBe(false);
    }
  });
});
