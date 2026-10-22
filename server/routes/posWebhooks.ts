import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { processPosStkCallback } from '../services/pos/posMpesaStkService.js';
import { assertPosWebhookAuthorized } from '../lib/posWebhookAuth.js';

/** Public M-Pesa STK callback — must stay before auth/subscription gate */
export const posWebhooksRouter = Router();

async function handleStkCallback(req: import('express').Request, res: import('express').Response) {
  assertPosWebhookAuthorized(req);
  const result = await processPosStkCallback(req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted', ...result });
}

/** Direct Safaricom callback (when a public URL exists). */
posWebhooksRouter.post('/mpesa/stk', asyncHandler(handleStkCallback));

/** Optional cloud relay — same auth + idempotency; local tills poll status if no inbound URL. */
posWebhooksRouter.post('/mpesa/relay', asyncHandler(handleStkCallback));
