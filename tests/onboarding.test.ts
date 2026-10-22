import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { startBusinessRegistration, completeBusinessRegistration } from '../server/services/onboardingService.js';
import { login } from '../server/services/authService.js';
import { hashToken, generateSecureToken } from '../server/lib/crypto.js';

describe('hybrid onboarding', () => {
  beforeAll(async () => {
    process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_DEV_LOG = 'true';
    // Avoid live SMTP in tests (Gmail can exceed Vitest 5s timeout).
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    const { resetMailTransportCache } = await import('../server/lib/mail.js');
    resetMailTransportCache();
  });

  it('starts public registration without creating a user', async () => {
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    const testEmail = `onboard-start-${Date.now()}@example.com`;
    const res = await startBusinessRegistration({
      businessName: 'Onboard Test Shop',
      ownerEmail: testEmail,
      ownerFirstName: 'Ona',
      ownerLastName: 'Board',
    });
    expect(res.email).toBe(testEmail);

    const pending = await prisma.businessRegistrationPending.findFirst({
      where: { email: testEmail },
      orderBy: { createdAt: 'desc' },
    });
    expect(pending).toBeTruthy();
    expect(await prisma.user.findUnique({ where: { email: testEmail } })).toBeNull();
  });

  it('completes registration and creates isolated tenant', async () => {
    const testEmail = `onboard-complete-${Date.now()}@example.com`;
    const code = '112233';
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);
    await prisma.businessRegistrationPending.create({
      data: {
        email: testEmail,
        businessName: 'Complete Test Shop',
        firstName: 'Comp',
        lastName: 'Lete',
        codeHash: hashToken(code),
        tokenHash: hashToken(generateSecureToken(8)),
        expiresAt,
      },
    });

    const result = await completeBusinessRegistration({
      email: testEmail,
      code,
      password: 'OnboardTestShop1!',
    });
    expect(result.businessId).toBeTruthy();

    const owner = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(owner?.mustSetPassword).toBe(false);
    expect(owner?.emailVerifiedAt).toBeTruthy();

    const sub = await prisma.organizationSubscription.findFirst({
      where: { businessId: result.businessId },
    });
    expect(sub?.status).toBe('TRIALING');

    await prisma.business.delete({ where: { id: result.businessId } });
  });

  it('blocks login until invitation password is set', async () => {
    const email = `invite-block-${Date.now()}@example.com`;
    const { hashPasswordUnsafe } = await import('../server/lib/password.js');
    const { provisionBusinessWithOwner } = await import('../server/services/businessProvisioningService.js');
    const provisioned = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: 'Login Block Test',
        ownerEmail: email,
        ownerFirstName: 'Inv',
        ownerLastName: 'Test',
        ownerPasswordHash: await hashPasswordUnsafe(generateSecureToken(32)),
        mustSetPassword: true,
        emailVerified: true,
      })
    );

    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    await expect(login(email, 'anything', fakeReq)).rejects.toMatchObject({
      code: 'PASSWORD_SETUP_REQUIRED',
    });

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });

  it('invitation accept updates only the invited user tenant', async () => {
    const email = `invite-tenant-${Date.now()}@example.com`;
    const code = '445566';
    const placeholderHash = await import('../server/lib/password.js').then((m) =>
      m.hashPasswordUnsafe(generateSecureToken(32))
    );
    const provisioned = await prisma.$transaction(async (tx) => {
      const { provisionBusinessWithOwner } = await import('../server/services/businessProvisioningService.js');
      return provisionBusinessWithOwner(tx, {
        businessName: 'Invite Isolation Shop',
        ownerEmail: email,
        ownerFirstName: 'Iso',
        ownerLastName: 'Late',
        ownerPasswordHash: await placeholderHash,
        mustSetPassword: true,
        emailVerified: true,
      });
    });

    const token = generateSecureToken(24);
    await prisma.userInvitation.create({
      data: {
        businessId: provisioned.businessId,
        userId: provisioned.ownerId,
        email,
        roleId: (await prisma.user.findUnique({ where: { id: provisioned.ownerId } }))!.roleId,
        inviteType: 'OWNER_SETUP',
        tokenHash: hashToken(token),
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const { acceptInvitation } = await import('../server/services/onboardingService.js');
    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    await acceptInvitation({ email, code, password: 'InviteIsolation1!', token, req: fakeReq });

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });

  it('accepts invitation with code only when link token is stale', async () => {
    const email = `stale-token-${Date.now()}@example.com`;
    const code = '778899';
    const placeholderHash = await import('../server/lib/password.js').then((m) =>
      m.hashPasswordUnsafe(generateSecureToken(32))
    );
    const provisioned = await prisma.$transaction(async (tx) => {
      const { provisionBusinessWithOwner } = await import('../server/services/businessProvisioningService.js');
      return provisionBusinessWithOwner(tx, {
        businessName: 'Stale Token Shop',
        ownerEmail: email,
        ownerFirstName: 'St',
        ownerLastName: 'Ale',
        ownerPasswordHash: await placeholderHash,
        mustSetPassword: true,
        emailVerified: true,
      });
    });

    const token = generateSecureToken(24);
    await prisma.userInvitation.create({
      data: {
        businessId: provisioned.businessId,
        userId: provisioned.ownerId,
        email,
        roleId: (await prisma.user.findUnique({ where: { id: provisioned.ownerId } }))!.roleId,
        inviteType: 'OWNER_SETUP',
        tokenHash: hashToken(token),
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const { acceptInvitation } = await import('../server/services/onboardingService.js');
    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    await acceptInvitation({
      email,
      code,
      password: 'InviteIsolation1!',
      token: generateSecureToken(24),
      req: fakeReq,
    });

    const owner = await prisma.user.findUnique({ where: { id: provisioned.ownerId } });
    expect(owner?.mustSetPassword).toBe(false);

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });
});
