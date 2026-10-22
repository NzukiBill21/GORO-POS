import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../lib/errors.js';
import { completeDesktopSetup, getDesktopSetupStatus } from '../services/desktopSetupService.js';

export const setupRouter = Router();

setupRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json(await getDesktopSetupStatus());
  })
);

const setupBodySchema = z.object({
  businessName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(12).max(128),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  currency: z.string().length(3).optional(),
});

setupRouter.post(
  '/complete',
  asyncHandler(async (req, res) => {
    if (process.env.DESKTOP_MODE !== 'true') {
      throw new AppError('Setup is only available in desktop mode', 403);
    }
    const body = setupBodySchema.parse(req.body);
    res.status(201).json(await completeDesktopSetup(body));
  })
);
