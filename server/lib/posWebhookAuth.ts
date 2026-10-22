import crypto from 'crypto';
import type { Request } from 'express';
import { AppError } from './errors.js';

/** Optional HMAC verification for in-store M-Pesa STK callbacks (POS_WEBHOOK_SECRET). */
export function assertPosWebhookAuthorized(req: Request): void {
  const secret = process.env.POS_WEBHOOK_SECRET;
  if (!secret) return;

  const signature = req.header('x-gorovian-signature') ?? req.header('x-mpesa-signature');
  if (!signature) {
    throw new AppError('Missing webhook signature', 401);
  }

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const normalized = signature.replace(/^sha256=/i, '').trim();

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(normalized, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError('Invalid webhook signature', 401);
  }
}
