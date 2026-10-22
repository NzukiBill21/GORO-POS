import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';

const EXEMPT = ['/api/health', '/api/setup', '/api/pos/webhooks', '/api/billing/webhooks'];

/** When DESKTOP_MODE + DESKTOP_API_SECRET set, require matching header from Electron shell. */
export function desktopApiSecret() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (process.env.DESKTOP_MODE !== 'true') return next();
    const secret = process.env.DESKTOP_API_SECRET;
    if (!secret) return next();

    if (EXEMPT.some((p) => req.path.startsWith(p))) return next();

    const provided = req.header('x-goro-desktop-secret');
    if (!provided) {
      return next(new AppError('Desktop session required', 403));
    }

    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return next(new AppError('Invalid desktop session', 403));
    }

    next();
  };
}
