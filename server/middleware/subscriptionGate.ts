import { Request, Response, NextFunction } from 'express';
import { requireOperationalSubscription } from '../lib/entitlements.js';

const EXEMPT_PREFIXES = ['/api/billing', '/api/auth', '/api/onboarding', '/api/platform', '/api/health', '/api/settings', '/api/notifications'];

export function subscriptionGate() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.BILLING_ENABLED === 'false') {
      return next();
    }
    const path = req.originalUrl.split('?')[0];
    if (EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
      return next();
    }
    if (!req.user?.businessId) return next();
    try {
      await requireOperationalSubscription(req.user.businessId);
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Subscription required';
      res.status(402).json({ error: message, code: 'SUBSCRIPTION_INACTIVE' });
    }
  };
}
