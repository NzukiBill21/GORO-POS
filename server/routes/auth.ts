import { Router } from 'express';
import { authenticate, authenticateAllowPasswordChange } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { authRateLimit, strictRateLimit } from '../middleware/rateLimit.js';
import { asyncHandler } from '../lib/errors.js';
import {
  login,
  refreshAccessToken,
  logout,
  requestPasswordReset,
  resetPassword,
  getPasswordResetStatus,
  changePassword,
  getMe,
  getActiveSessions,
  forceLogoutSession,
} from '../services/authService.js';
import {
  loginSchema, refreshSchema, passwordResetRequestSchema,
  passwordResetSchema, changePasswordSchema,
} from '../lib/schemas.js';

export const authRouter = Router();

authRouter.post('/login', authRateLimit, validate(loginSchema), asyncHandler(async (req, res) => {
  const result = await login(req.body.email, req.body.password, req);
  res.json(result);
}));

authRouter.post('/refresh', authRateLimit, validate(refreshSchema), asyncHandler(async (req, res) => {
  const result = await refreshAccessToken(req.body.refreshToken, req.body.sessionId, req);
  res.json(result);
}));

authRouter.post('/logout', authenticateAllowPasswordChange, asyncHandler(async (req, res) => {
  await logout(req.user!.sessionId, req.user!.userId, req);
  res.json({ success: true });
}));

authRouter.get('/me', authenticateAllowPasswordChange, asyncHandler(async (req, res) => {
  const user = await getMe(req.user!.userId);
  res.json(user);
}));

authRouter.get('/password-reset/status', asyncHandler(async (_req, res) => {
  res.json(getPasswordResetStatus());
}));

authRouter.post('/password-reset/request', authRateLimit, validate(passwordResetRequestSchema), asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body.email);
  res.json(result);
}));

authRouter.post('/password-reset/confirm', strictRateLimit, validate(passwordResetSchema), asyncHandler(async (req, res) => {
  const { password, token, email, code } = req.body;
  const result = await resetPassword(password, req, { token, email, code });
  res.json(result);
}));

authRouter.post('/change-password', authenticateAllowPasswordChange, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const result = await changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword, req);
  res.json(result);
}));

authRouter.get('/sessions', authenticate, requirePermission('security.view'), asyncHandler(async (req, res) => {
  const sessions = await getActiveSessions(req.user!.businessId);
  res.json(sessions);
}));

authRouter.post('/sessions/:id/terminate', authenticate, requirePermission('security.manage'), asyncHandler(async (req, res) => {
  const result = await forceLogoutSession(req.params.id, req.user!.userId, req.user!.businessId, req);
  res.json(result);
}));
