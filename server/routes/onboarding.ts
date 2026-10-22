import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { authRateLimit, strictRateLimit } from '../middleware/rateLimit.js';
import { authenticate } from '../middleware/auth.js';
import {
  getOnboardingPublicStatus,
  startBusinessRegistration,
  completeBusinessRegistration,
  getInvitationPreview,
  acceptInvitation,
  getOwnerOnboardingChecklist,
} from '../services/onboardingService.js';

export const onboardingRouter = Router();

onboardingRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json(getOnboardingPublicStatus());
  })
);

const registerStartSchema = z.object({
  businessName: z.string().min(2).max(200),
  ownerEmail: z.string().email().max(255),
  ownerFirstName: z.string().min(1).max(100),
  ownerLastName: z.string().min(1).max(100),
});

onboardingRouter.post(
  '/register/start',
  authRateLimit,
  validate(registerStartSchema),
  asyncHandler(async (req, res) => {
    res.json(await startBusinessRegistration(req.body));
  })
);

const registerCompleteSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(12).max(128),
  token: z.string().min(16).max(256).optional(),
});

onboardingRouter.post(
  '/register/complete',
  strictRateLimit,
  validate(registerCompleteSchema),
  asyncHandler(async (req, res) => {
    res.json(await completeBusinessRegistration(req.body));
  })
);

onboardingRouter.get(
  '/invite/preview',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    const email = String(req.query.email ?? '');
    if (!token || !email) {
      return res.status(400).json({ error: 'token and email required' });
    }
    res.json(await getInvitationPreview(token, email));
  })
);

const acceptInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(255),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Invitation code must be exactly 6 digits'),
  password: z.string().min(12).max(128),
  token: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(16).max(256).optional()
  ),
});

onboardingRouter.post(
  '/invite/accept',
  strictRateLimit,
  validate(acceptInviteSchema),
  asyncHandler(async (req, res) => {
    res.json(await acceptInvitation({ ...req.body, req }));
  })
);

onboardingRouter.get(
  '/checklist',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await getOwnerOnboardingChecklist(req.user!.businessId, req.user!.userId));
  })
);
