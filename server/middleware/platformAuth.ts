import { Request, Response, NextFunction } from 'express';
import { verifyPlatformAccessToken } from '../services/platformAuthService.js';
import { getPlatformPermissions, hasPermission } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';

declare global {
  namespace Express {
    interface Request {
      platformUser?: {
        platformUserId: string;
        role: string;
        sessionId: string;
        permissions: string[];
      };
    }
  }
}

export async function authenticatePlatform(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = verifyPlatformAccessToken(authHeader.slice(7));
    const session = await prisma.platformSession.findUnique({ where: { id: decoded.sessionId } });
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }
    const user = await prisma.platformUser.findUnique({ where: { id: decoded.platformUserId } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account deactivated' });
    }
    req.platformUser = {
      platformUserId: user.id,
      role: user.role,
      sessionId: session.id,
      permissions: getPlatformPermissions(),
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requirePlatformPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.platformUser) {
      return res.status(401).json({ error: 'Platform authentication required' });
    }
    const allowed = permissions.some((p) => hasPermission(req.platformUser!.role, p, req.platformUser!.permissions));
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient platform permissions' });
    }
    next();
  };
}
