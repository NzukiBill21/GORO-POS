import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { hashToken } from '../server/lib/crypto.js';
import { requestPasswordReset, resetPassword } from '../server/services/authService.js';
import { hashPasswordUnsafe, verifyPassword } from '../server/lib/password.js';
import { resetMailTransportCache } from '../server/lib/mail.js';

const sendSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../server/lib/mail.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/lib/mail.js')>();
  return {
    ...actual,
    isSmtpConfigured: () => true,
    sendPasswordResetEmail: (...args: unknown[]) => sendSpy(...args),
  };
});

describe('password reset email flow', () => {
  let userId: string;
  const testEmail = `reset-test-${Date.now()}@example.com`;
  const newPassword = 'NewSecurePass1!';

  beforeAll(async () => {
    const business = await prisma.business.findFirst();
    const role = await prisma.role.findFirst({ where: { name: 'cashier' } });
    const passwordHash = await hashPasswordUnsafe('OldSecurePass1!');
    const user = await prisma.user.create({
      data: {
        businessId: business!.id,
        roleId: role!.id,
        email: testEmail,
        passwordHash,
        firstName: 'Reset',
        lastName: 'Tester',
        isActive: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(() => {
    sendSpy.mockClear();
    resetMailTransportCache();
  });

  it('returns generic message for unknown email without sending', async () => {
    const res = await requestPasswordReset('nobody@example.com');
    expect(res.message).toMatch(/If an account exists/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('sends email and stores hashed code for valid user', async () => {
    const res = await requestPasswordReset(testEmail);
    expect(res.message).toMatch(/If an account exists/);
    expect(sendSpy).toHaveBeenCalledOnce();
    const call = sendSpy.mock.calls[0][0] as { code: string; to: string };
    expect(call.to).toBe(testEmail);
    expect(call.code).toMatch(/^\d{6}$/);

    const row = await prisma.passwordResetToken.findFirst({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.codeHash).toBe(hashToken(call.code));
  });

  it('rejects expired code', async () => {
    await requestPasswordReset(testEmail);
    const call = sendSpy.mock.calls[0][0] as { code: string };
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const fakeReq = {
      ip: '127.0.0.1',
      headers: {},
      get: (name: string) => (name === 'user-agent' ? 'vitest' : undefined),
    } as import('express').Request;
    await expect(
      resetPassword(newPassword, fakeReq, { email: testEmail, code: call.code })
    ).rejects.toThrow(/Invalid or expired/);
  });

  it('rejects invalid token', async () => {
    const fakeReq = {
      ip: '127.0.0.1',
      headers: {},
      get: (name: string) => (name === 'user-agent' ? 'vitest' : undefined),
    } as import('express').Request;
    await expect(
      resetPassword(newPassword, fakeReq, { email: testEmail, code: '000000' })
    ).rejects.toThrow(/Invalid or expired/);
  });

  it('rejects token reuse', async () => {
    await requestPasswordReset(testEmail);
    const call = sendSpy.mock.calls[0][0] as { code: string };
    const fakeReq = {
      ip: '127.0.0.1',
      headers: {},
      get: (name: string) => (name === 'user-agent' ? 'vitest' : undefined),
    } as import('express').Request;

    await resetPassword(newPassword, fakeReq, { email: testEmail, code: call.code });
    await expect(
      resetPassword('AnotherSecure1!', fakeReq, { email: testEmail, code: call.code })
    ).rejects.toThrow(/Invalid or expired/);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(await verifyPassword(user!.passwordHash, newPassword)).toBe(true);
  });
});
