import { Request, Response, NextFunction } from 'express';
import { hasPermission } from '../lib/permissions.js';

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
