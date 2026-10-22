import { prisma } from './prisma.js';

export async function writePlatformAuditLog(params: {
  platformUserId: string;
  action: string;
  targetBusinessId?: string;
  reason?: string;
  details?: string;
  ipAddress?: string;
}) {
  await prisma.platformAuditLog.create({
    data: {
      platformUserId: params.platformUserId,
      action: params.action,
      targetBusinessId: params.targetBusinessId,
      reason: params.reason,
      details: params.details,
      ipAddress: params.ipAddress,
    },
  });
}
