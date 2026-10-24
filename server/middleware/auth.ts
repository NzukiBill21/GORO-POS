import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../services/authService.js';
import { hasPermission, getPermissionsForUser } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { ensureUserBranchId } from '../lib/branchContext.js';
import { reconcileMustSetPassword } from '../lib/accountSetup.js';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & { permissions?: string[] };
    }
  }
}

type AuthenticateOptions = {
  /** Allow access while mustChangePassword is set (password change / me / logout only). */
  allowPendingPasswordChange?: boolean;
};

function createAuthenticate(options: AuthenticateOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);

    const session = await prisma.session.findUnique({ where: { id: decoded.sessionId } });
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    if (session.businessId !== decoded.businessId) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { role: true, business: { select: { status: true } } },
    });
    if (!user || !user.isActive || user.businessId !== decoded.businessId) {
      return res.status(401).json({ error: 'Account deactivated' });
    }

    if (user.business.status === 'SUSPENDED') {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      return res.status(403).json({ error: 'Organization suspended by platform administrator.', code: 'ORG_SUSPENDED' });
    }

    if (!user.role) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      return res.status(403).json({ error: 'Account role is misconfigured. Contact support.', code: 'ROLE_MISSING' });
    }

    if (await reconcileMustSetPassword(user)) {
      user.mustSetPassword = false;
    }

    if (user.mustSetPassword) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      return res.status(403).json({
        error: 'Complete account setup from your invitation email before using the app.',
        code: 'PASSWORD_SETUP_REQUIRED',
      });
    }

    if (user.mustChangePassword && !options.allowPendingPasswordChange) {
      return res.status(403).json({
        error: 'Change your temporary password before using the app.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    if (user.forceLogoutAt && user.forceLogoutAt > session.createdAt) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      return res.status(401).json({ error: 'Session terminated' });
    }

    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion !== user.tokenVersion) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      return res.status(401).json({ error: 'Session expired' });
    }

    const permissions = await getPermissionsForUser(user.id, user.role.name);
    let branchId = user.branchId ?? undefined;
    if (!branchId) {
      try {
        branchId = await ensureUserBranchId(user.id, user.businessId);
      } catch {
        /* no branch configured — POS routes will return 400 */
      }
    }
    req.user = {
      userId: user.id,
      businessId: user.businessId,
      branchId,
      role: user.role.name,
      sessionId: session.id,
      permissions,
    };

    await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  };
}

export const authenticate = createAuthenticate();
/** Auth routes only — me, logout, change-password while temp password is active. */
export const authenticateAllowPasswordChange = createAuthenticate({ allowPendingPasswordChange: true });

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userPerms = req.user.permissions || [];
    const allowed = permissions.some((p) => hasPermission(req.user!.role, p, userPerms));
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const normalizedRoles = roles.map((r) => r.toLowerCase());
    const userRole = req.user.role.toLowerCase();
    const aliases: Record<string, string[]> = {
      administrator: ['administrator', 'owner', 'admin'],
      manager: ['manager'],
      supervisor: ['supervisor'],
      cashier: ['cashier'],
    };
    const allowed = normalizedRoles.some((r) => {
      const aliasList = aliases[r] || [r];
      return aliasList.includes(userRole);
    });
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

// Legacy exports for backward compatibility
export function generateToken(payload: Omit<TokenPayload, 'sessionId'> & { sessionId?: string }): string {
  throw new AppError('Use authService.generateAccessToken instead', 500);
}
