import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { hashToken, generateSecureToken } from '../lib/crypto.js';
import { verifyPassword, validatePasswordComplexity, hashPasswordUnsafe } from '../lib/password.js';
import {
  writeAuditLog,
  logLoginAttempt,
  logSecurityEvent,
  terminateUserSessions,
  extractRequestMeta,
  createNotification,
} from '../lib/audit.js';
import { bumpUserTokenVersion } from '../lib/tokenVersion.js';
import { AppError } from '../lib/errors.js';
import { reconcileMustSetPassword } from '../lib/accountSetup.js';
import {
  isSmtpConfigured,
  sendPasswordResetEmail,
  PASSWORD_RESET_EXPIRY_MINUTES,
} from '../lib/mail.js';
import { generatePasswordResetCode } from '../lib/passwordResetCode.js';
import { getPermissionsForUser } from '../lib/permissions.js';
import type { Request } from 'express';

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10);
const MAX_FAILED_ATTEMPTS = 5;

function progressiveLockoutMinutes(failedAttempts: number): number {
  if (failedAttempts < MAX_FAILED_ATTEMPTS) return 0;
  const tier = Math.floor((failedAttempts - MAX_FAILED_ATTEMPTS) / 5);
  return Math.min(15 * 2 ** tier, 24 * 60);
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production (min 32 chars)');
    }
    if (process.env.NODE_ENV !== 'development') {
      console.warn('[SECURITY] JWT_SECRET not set; using development fallback. Set NODE_ENV=development or configure JWT_SECRET.');
    }
    return 'dev-jwt-secret-min-32-characters!!';
  }
  return secret;
}

export interface TokenPayload {
  userId: string;
  businessId: string;
  branchId?: string;
  role: string;
  sessionId: string;
  tokenVersion: number;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' });
}

export async function createSession(userId: string, businessId: string, req: Request) {
  const meta = extractRequestMeta(req);
  const refreshToken = generateSecureToken(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  const session = await prisma.session.create({
    data: {
      userId,
      businessId,
      refreshTokenHash: hashToken(refreshToken),
      device: meta.device,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });

  return { session, refreshToken };
}

export async function login(email: string, password: string, req: Request) {
  const meta = extractRequestMeta(req);
  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { role: true, branch: true, business: { select: { currency: true, status: true } } },
  });

  if (!user) {
    await logLoginAttempt({ email: normalizedEmail, success: false, ...meta, reason: 'User not found' });
    throw new AppError('Invalid credentials', 401);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: false, ...meta, reason: 'Account locked' });
    throw new AppError('Account temporarily locked. Try again later.', 423);
  }

  if (!user.isActive) {
    await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: false, ...meta, reason: 'Account inactive' });
    throw new AppError('Account is deactivated', 403);
  }

  if (user.business.status === 'SUSPENDED') {
    await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: false, ...meta, reason: 'Organization suspended' });
    throw new AppError('Organization suspended. Contact GOROVIAN support.', 403);
  }

  if (await reconcileMustSetPassword(user)) {
    user.mustSetPassword = false;
  }

  if (user.mustSetPassword) {
    await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: false, ...meta, reason: 'Password setup pending' });
    throw new AppError(
      'Set your password using the invitation link we emailed you before signing in.',
      403,
      'PASSWORD_SETUP_REQUIRED'
    );
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts: attempts };

    const lockMinutes = progressiveLockoutMinutes(attempts);
    if (lockMinutes > 0) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + lockMinutes);
      updateData.lockedUntil = lockedUntil;

      await logSecurityEvent({
        businessId: user.businessId,
        userId: user.id,
        type: 'ACCOUNT_LOCKED',
        severity: 'WARNING',
        message: `Account locked for ${lockMinutes} minutes after ${attempts} failed login attempts`,
        ipAddress: meta.ipAddress,
      });

      const managers = await prisma.user.findMany({
        where: { businessId: user.businessId, isActive: true, role: { name: { in: ['manager', 'administrator'] } } },
        select: { id: true },
        take: 20,
      });
      for (const m of managers) {
        await createNotification({
          businessId: user.businessId,
          recipientUserId: m.id,
          type: 'SECURITY',
          title: 'Account lockout',
          message: `${normalizedEmail} was locked after failed login attempts.`,
          severity: 'WARNING',
        });
      }
    }

    await prisma.user.update({ where: { id: user.id }, data: updateData });
    await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: false, ...meta, reason: 'Invalid password' });
    throw new AppError('Invalid credentials', 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), forceLogoutAt: null },
  });

  const { session, refreshToken } = await createSession(user.id, user.businessId, req);
  const permissions = await getPermissionsForUser(user.id, user.role.name);

  const tokenPayload: TokenPayload = {
    userId: user.id,
    businessId: user.businessId,
    branchId: user.branchId ?? undefined,
    role: user.role.name,
    sessionId: session.id,
    tokenVersion: user.tokenVersion,
  };

  const accessToken = generateAccessToken(tokenPayload);

  await logLoginAttempt({ userId: user.id, email: normalizedEmail, success: true, ...meta });
  await writeAuditLog(
    { action: 'LOGIN', module: 'AUTH', details: 'User logged in' },
    { userId: user.id, sessionId: session.id, ...meta }
  );

  return {
    accessToken,
    refreshToken,
    sessionId: session.id,
    expiresIn: ACCESS_TOKEN_EXPIRY,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.name,
      branchId: user.branchId,
      branchName: user.branch?.name,
      avatar: user.avatar,
      permissions,
      currency: user.business.currency,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function refreshAccessToken(refreshToken: string, sessionId: string, req: Request) {
  const meta = extractRequestMeta(req);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { role: true, branch: true, business: { select: { currency: true, status: true } } } } },
  });

  if (!session || !session.isActive) throw new AppError('Invalid session', 401);
  if (session.expiresAt < new Date()) throw new AppError('Session expired', 401);
  if (session.refreshTokenHash !== hashToken(refreshToken)) {
    await terminateUserSessions(session.userId);
    await logSecurityEvent({
      businessId: session.businessId,
      userId: session.userId,
      type: 'SUSPICIOUS_ACTIVITY',
      severity: 'CRITICAL',
      message: 'Invalid refresh token — all sessions terminated',
      ipAddress: meta.ipAddress,
    });
    throw new AppError('Invalid refresh token', 401);
  }

  const user = session.user;
  if (!user.isActive) throw new AppError('Account deactivated', 403);
  if (user.business.status === 'SUSPENDED') {
    await prisma.session.update({ where: { id: sessionId }, data: { isActive: false } });
    throw new AppError('Organization suspended. Contact GOROVIAN support.', 403);
  }
  if (user.forceLogoutAt && user.forceLogoutAt > session.createdAt) {
    await prisma.session.update({ where: { id: sessionId }, data: { isActive: false } });
    throw new AppError('Session terminated by administrator', 401);
  }

  const newRefreshToken = generateSecureToken(48);
  await prisma.session.update({
    where: { id: sessionId },
    data: { refreshTokenHash: hashToken(newRefreshToken), lastActivityAt: new Date() },
  });

  const permissions = await getPermissionsForUser(user.id, user.role.name);
  const tokenPayload: TokenPayload = {
    userId: user.id,
    businessId: user.businessId,
    branchId: user.branchId ?? undefined,
    role: user.role.name,
    sessionId: session.id,
    tokenVersion: user.tokenVersion,
  };

  return {
    accessToken: generateAccessToken(tokenPayload),
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.name,
      branchId: user.branchId,
      branchName: user.branch?.name,
      permissions,
      currency: user.business.currency,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function logout(sessionId: string, userId: string, req: Request) {
  const meta = extractRequestMeta(req);
  await prisma.session.update({ where: { id: sessionId }, data: { isActive: false } });
  await writeAuditLog({ action: 'LOGOUT', module: 'AUTH', details: 'User logged out' }, { userId, sessionId, ...meta });
}

const PASSWORD_RESET_GENERIC_MESSAGE =
  'If an account exists for that email, we sent a password reset code. Check your inbox.';

export function getPasswordResetStatus() {
  return {
    emailRecoveryAvailable: isSmtpConfigured(),
    expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    method: 'code' as const,
  };
}

export async function requestPasswordReset(email: string) {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    return { message: PASSWORD_RESET_GENERIC_MESSAGE };
  }

  if (!user.isActive) {
    return { message: PASSWORD_RESET_GENERIC_MESSAGE };
  }

  const code = generatePasswordResetCode();
  const token = generateSecureToken(32);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + PASSWORD_RESET_EXPIRY_MINUTES);

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      codeHash: hashToken(code),
      expiresAt,
    },
  });

  let resetUrl: string | undefined;
  const baseUrl = process.env.PASSWORD_RESET_BASE_URL?.trim().replace(/\/$/, '');
  if (baseUrl) {
    resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  await sendPasswordResetEmail({
    to: user.email,
    firstName: user.firstName,
    code,
    resetUrl,
  });

  if (process.env.NODE_ENV === 'development' && process.env.PASSWORD_RESET_DEV_LOG === 'true') {
    console.log(`[DEV] Password reset code for ${normalized} (do not use in production): ${code}`);
  }

  return { message: PASSWORD_RESET_GENERIC_MESSAGE };
}

async function findValidResetRecord(params: {
  token?: string;
  email?: string;
  code?: string;
}) {
  if (params.token) {
    return prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(params.token) },
      include: { user: true },
    });
  }
  if (params.email && params.code) {
    const user = await prisma.user.findUnique({
      where: { email: params.email.toLowerCase().trim() },
    });
    if (!user) return null;
    return prisma.passwordResetToken.findFirst({
      where: { userId: user.id, codeHash: hashToken(params.code.trim()) },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });
  }
  return null;
}

export async function resetPassword(
  newPassword: string,
  req: Request,
  creds: { token?: string; email?: string; code?: string }
) {
  const meta = extractRequestMeta(req);
  const validation = validatePasswordComplexity(newPassword);
  if (!validation.valid) throw new AppError(validation.errors.join('. '), 400);

  const resetRecord = await findValidResetRecord(creds);

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < new Date()) {
    throw new AppError('Invalid or expired reset code', 400);
  }

  const passwordHash = await hashPasswordUnsafe(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustSetPassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({ where: { id: resetRecord.id }, data: { usedAt: new Date() } }),
  ]);

  await terminateUserSessions(resetRecord.userId);
  await writeAuditLog(
    { action: 'PASSWORD_RESET', module: 'AUTH', details: 'Password reset completed' },
    { userId: resetRecord.userId, ...meta }
  );

  return { success: true };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, req: Request) {
  const meta = extractRequestMeta(req);
  const validation = validatePasswordComplexity(newPassword);
  if (!validation.valid) throw new AppError(validation.errors.join('. '), 400);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) throw new AppError('Current password is incorrect', 400);

  const passwordHash = await hashPasswordUnsafe(newPassword);

  await bumpUserTokenVersion(userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      mustSetPassword: false,
      mustChangePassword: false,
    },
  });

  await terminateUserSessions(userId);
  await writeAuditLog(
    { action: 'PASSWORD_CHANGE', module: 'AUTH', details: 'Password changed' },
    { userId, ...meta }
  );

  return { success: true };
}

export async function getActiveSessions(businessId: string) {
  return prisma.session.findMany({
    where: { businessId, isActive: true, expiresAt: { gt: new Date() } },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { lastActivityAt: 'desc' },
  });
}

export async function forceLogoutSession(sessionId: string, adminUserId: string, businessId: string, req: Request) {
  const meta = extractRequestMeta(req);
  const session = await prisma.session.findFirst({ where: { id: sessionId, businessId } });
  if (!session) throw new AppError('Session not found', 404);

  await prisma.session.update({ where: { id: sessionId }, data: { isActive: false } });
  await logSecurityEvent({
    businessId: session.businessId,
    userId: session.userId,
    type: 'FORCE_LOGOUT',
    severity: 'WARNING',
    message: `Session terminated by admin ${adminUserId}`,
    ipAddress: meta.ipAddress,
  });

  return { success: true };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: true,
      branch: true,
      business: { select: { currency: true, id: true, billingOwnerUserId: true, name: true } },
    },
  });
  if (!user || !user.isActive) throw new AppError('User not found', 404);

  const permissions = await getPermissionsForUser(user.id, user.role.name);
  const { getOwnerOnboardingChecklist } = await import('./onboardingService.js');
  const checklist = await getOwnerOnboardingChecklist(user.business.id, user.id);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    branchId: user.branchId,
    branchName: user.branch?.name,
    avatar: user.avatar,
    permissions,
    currency: user.business.currency,
    mustSetPassword: user.mustSetPassword,
    mustChangePassword: user.mustChangePassword,
    emailVerified: Boolean(user.emailVerifiedAt),
    isBillingOwner: user.business.billingOwnerUserId === user.id,
    onboarding: checklist,
  };
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as TokenPayload;
}
