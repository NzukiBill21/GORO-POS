import type { Request, Response, NextFunction } from 'express';
import { API_PORT, DEV_UI_PORT, isDesktopStaticUi, resolveCorsOrigins } from '../lib/listenHost.js';
import { AppError } from '../lib/errors.js';

const EXEMPT_PREFIXES = [
  '/api/health',
  '/api/auth',
  '/api/onboarding',
  '/api/setup',
  '/api/pos/webhooks',
  '/api/billing/webhooks',
];

/** Reject cross-origin or wrong Host on local API (desktop + dev). */
export function hostOriginGuard() {
  const allowedOrigins = new Set(resolveCorsOrigins());
  const allowedHosts = new Set([`127.0.0.1:${API_PORT}`, `localhost:${API_PORT}`]);

  if (!isDesktopStaticUi()) {
    allowedHosts.add(`127.0.0.1:${DEV_UI_PORT}`);
    allowedHosts.add(`localhost:${DEV_UI_PORT}`);
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return next(new AppError('Invalid origin', 403));
    }

    const host = req.headers.host;
    if (host && !allowedHosts.has(host)) {
      return next(new AppError('Invalid host', 403));
    }

    next();
  };
}
