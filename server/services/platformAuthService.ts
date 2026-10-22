import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { hashToken, generateSecureToken } from '../lib/crypto.js';
import { verifyPassword, hashPasswordUnsafe } from '../lib/password.js';
import { getPlatformPermissions } from '../lib/permissions.js';
import { AppError } from '../lib/errors.js';
import type { Request } from 'express';

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10);

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return 'dev-jwt-secret-min-32-characters!!';
  }
  return secret;
}

export interface PlatformTokenPayload {
  platformUserId: string;
  role: string;
  sessionId: string;
  scope: 'platform';
}

export function generatePlatformAccessToken(payload: PlatformTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' });
}

export function verifyPlatformAccessToken(token: string): PlatformTokenPayload {
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as PlatformTokenPayload;
}

export async function platformLogin(email: string, password: string, req: Request) {
  const user = await prisma.platformUser.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive) throw new AppError('Invalid credentials', 401);

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) throw new AppError('Invalid credentials', 401);

  const refreshToken = generateSecureToken(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  const session = await prisma.platformSession.create({
    data: {
      platformUserId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      device: req.get('x-device-id') ?? 'desktop',
      userAgent: req.get('user-agent') ?? undefined,
      ipAddress: req.ip,
      expiresAt,
    },
  });

  await prisma.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokenPayload: PlatformTokenPayload = {
    platformUserId: user.id,
    role: user.role,
    sessionId: session.id,
    scope: 'platform',
  };

  return {
    accessToken: generatePlatformAccessToken(tokenPayload),
    refreshToken,
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      scope: 'platform' as const,
      permissions: getPlatformPermissions(),
    },
  };
}

export async function seedPlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@gorovian.com';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'GorovianAdmin123!';
  const hash = await hashPasswordUnsafe(password);
  await prisma.platformUser.upsert({
    where: { email },
    update: { passwordHash: hash, isActive: true },
    create: {
      email,
      passwordHash: hash,
      firstName: 'GOROVIAN',
      lastName: 'Admin',
      role: 'platform_admin',
    },
  });
}
