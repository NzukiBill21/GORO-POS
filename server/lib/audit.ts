import crypto from 'crypto';
import { prisma } from './prisma.js';
import { hashToken } from './crypto.js';

const GENESIS_HASH = '0'.repeat(64);

function computeEntryHash(prevHash: string, payload: string): string {
  return crypto.createHash('sha256').update(`${prevHash}|${payload}`, 'utf8').digest('hex');
}

export async function getLatestAuditHash(): Promise<string> {
  const last = await prisma.auditLog.findFirst({
    where: { entryHash: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { entryHash: true },
  });
  return last?.entryHash ?? GENESIS_HASH;
}

export interface AuditContext {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  device?: string;
}

export interface AuditEntry {
  action: string;
  module: string;
  entityId?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  details?: string;
}

/** Immutable audit log — append only, never update or delete */
export async function writeAuditLog(entry: AuditEntry, ctx: AuditContext = {}) {
  try {
    const prevHash = await getLatestAuditHash();
    const at = new Date();
    const payload = JSON.stringify({
      prevHash,
      action: entry.action,
      module: entry.module,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
      userId: ctx.userId ?? null,
      at: at.toISOString(),
    });
    const entryHash = computeEntryHash(prevHash, payload);

    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        action: entry.action,
        module: entry.module,
        entityId: entry.entityId,
        previousValues: entry.previousValues ? JSON.stringify(entry.previousValues) : null,
        newValues: entry.newValues ? JSON.stringify(entry.newValues) : null,
        details: entry.details,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        device: ctx.device,
        prevHash,
        entryHash,
        createdAt: at,
      },
    });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}

export async function logSecurityEvent(params: {
  businessId: string;
  userId?: string;
  type: string;
  severity?: string;
  message: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  await prisma.securityEvent.create({
    data: {
      businessId: params.businessId,
      userId: params.userId,
      type: params.type,
      severity: params.severity ?? 'INFO',
      message: params.message,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress,
    },
  });
}

export async function logLoginAttempt(params: {
  userId?: string;
  email: string;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  device?: string;
  reason?: string;
}) {
  await prisma.loginHistory.create({ data: params });
}

/** Legacy activity log — kept for backward compatibility */
export async function logActivity(params: {
  userId?: string;
  action: string;
  module: string;
  entityId?: string;
  details?: string;
  ipAddress?: string;
}) {
  await writeAuditLog(
    { action: params.action, module: params.module, entityId: params.entityId, details: params.details },
    { userId: params.userId, ipAddress: params.ipAddress }
  );
  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        module: params.module,
        entityId: params.entityId,
        details: params.details,
        ipAddress: params.ipAddress,
      },
    });
  } catch {
    // non-critical
  }
}

export async function createNotification(params: {
  businessId?: string;
  recipientUserId?: string;
  userId?: string; // legacy alias
  type: string;
  title: string;
  message: string;
  severity?: string;
  entityType?: string;
  entityId?: string;
  data?: string;
}) {
  return prisma.notification.create({
    data: {
      businessId: params.businessId,
      recipientUserId: params.recipientUserId ?? params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      severity: params.severity ?? 'INFO',
      entityType: params.entityType,
      entityId: params.entityId,
      data: params.data,
    },
  });
}

export async function terminateUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: {
      userId,
      isActive: true,
      ...(exceptSessionId && { id: { not: exceptSessionId } }),
    },
    data: { isActive: false },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { forceLogoutAt: new Date() },
  });
}

export async function validateSession(sessionId: string, refreshToken: string): Promise<boolean> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || !session.isActive) return false;
  if (session.expiresAt < new Date()) return false;
  return session.refreshTokenHash === hashToken(refreshToken);
}

export function extractRequestMeta(req: { ip?: string; headers: Record<string, unknown>; get?: (h: string) => string | undefined }) {
  return {
    ipAddress: req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 'unknown',
    userAgent: req.get?.('user-agent') || (req.headers['user-agent'] as string) || 'unknown',
    device: req.get?.('x-device-id') || (req.headers['x-device-id'] as string) || 'desktop',
  };
}
