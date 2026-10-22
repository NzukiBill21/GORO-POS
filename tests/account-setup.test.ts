import { describe, it, expect } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { reconcileMustSetPassword } from '../server/lib/accountSetup.js';
import { login } from '../server/services/authService.js';

describe('account setup reconciliation', () => {
  it('clears mustSetPassword when password was already set', async () => {
    const email = `reconcile-${Date.now()}@example.com`;
    const { provisionBusinessWithOwner } = await import('../server/services/businessProvisioningService.js');
    const { hashPasswordUnsafe } = await import('../server/lib/password.js');
    const { generateSecureToken } = await import('../server/lib/crypto.js');

    const provisioned = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: 'Reconcile Test',
        ownerEmail: email,
        ownerFirstName: 'Re',
        ownerLastName: 'Con',
        ownerPasswordHash: await hashPasswordUnsafe(generateSecureToken(32)),
        mustSetPassword: true,
        emailVerified: true,
      })
    );

    await prisma.user.update({
      where: { id: provisioned.ownerId },
      data: { passwordChangedAt: new Date() },
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: provisioned.ownerId } });
    expect(await reconcileMustSetPassword(user)).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: provisioned.ownerId } });
    expect(after.mustSetPassword).toBe(false);

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });

  it('allows login after reconcile for stuck invitation flag', async () => {
    const email = `login-reconcile-${Date.now()}@example.com`;
    const password = 'ReconcileLogin1!';
    const { provisionBusinessWithOwner } = await import('../server/services/businessProvisioningService.js');
    const { hashPasswordUnsafe } = await import('../server/lib/password.js');

    const provisioned = await prisma.$transaction(async (tx) =>
      provisionBusinessWithOwner(tx, {
        businessName: 'Login Reconcile',
        ownerEmail: email,
        ownerFirstName: 'Lo',
        ownerLastName: 'Gin',
        ownerPasswordHash: await hashPasswordUnsafe(password),
        mustSetPassword: true,
        emailVerified: true,
      })
    );

    await prisma.user.update({
      where: { id: provisioned.ownerId },
      data: { passwordChangedAt: new Date(), mustSetPassword: true },
    });

    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    const session = await login(email, password, fakeReq);
    expect(session.accessToken).toBeTruthy();

    await prisma.business.delete({ where: { id: provisioned.businessId } });
  });
});
