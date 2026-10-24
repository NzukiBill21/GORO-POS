import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { authenticatePlatform, requirePlatformPermission } from '../middleware/platformAuth.js';
import { platformLogin } from '../services/platformAuthService.js';
import { PLATFORM_PERMISSIONS } from '../lib/permissionRegistry.js';
import { processSubscriptionLifecycle } from '../services/subscriptionLifecycleService.js';
import { extractRequestMeta } from '../lib/audit.js';
import { writePlatformAuditLog } from '../lib/platformAudit.js';
import {
  getPlatformOverviewExtended,
  getPlatformHealth,
  listOrganizations,
  getOrganizationDetail,
  createTenantWithOwner,
  suspendOrganization,
  reactivateOrganization,
  changeOrganizationPlan,
  listPlatformAuditLogs,
  grantPilotEntitlement,
  revokePilotEntitlement,
} from '../services/platformOperationsService.js';
import { resendOwnerInvitation } from '../services/onboardingService.js';
export const platformRouter = Router();

platformRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    res.json(await platformLogin(req.body.email, req.body.password, req));
  })
);

platformRouter.use(authenticatePlatform);

platformRouter.get(
  '/health',
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  asyncHandler(async (_req, res) => {
    res.json(await getPlatformHealth());
  })
);

platformRouter.get(
  '/billing/overview',
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  asyncHandler(async (_req, res) => {
    res.json(await getPlatformOverviewExtended());
  })
);

platformRouter.get(
  '/organizations',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW),
  asyncHandler(async (req, res) => {
    res.json(
      await listOrganizations({
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        pilotOnly: req.query.pilotOnly === 'true',
      })
    );
  })
);

platformRouter.get(
  '/organizations/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW),
  asyncHandler(async (req, res) => {
    res.json(await getOrganizationDetail(req.params.id));
  })
);

platformRouter.post(
  '/organizations/:id/owner-invitation/resend',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    const invitation = await resendOwnerInvitation({
      businessId: req.params.id,
      platformUserId: req.platformUser!.platformUserId,
    });
    await writePlatformAuditLog({
      platformUserId: req.platformUser!.platformUserId,
      action: 'OWNER_INVITE_RESEND',
      targetBusinessId: req.params.id,
      details: invitation.deliveryStatus,
      ipAddress: meta.ipAddress,
    });
    res.json(invitation);
  })
);

platformRouter.post(
  '/organizations',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    res.status(201).json(
      await createTenantWithOwner({
        businessName: req.body.businessName,
        ownerEmail: req.body.ownerEmail,
        ownerFirstName: req.body.ownerFirstName,
        ownerLastName: req.body.ownerLastName,
        planCode: req.body.planCode,
        ownerInitialPassword: req.body.ownerInitialPassword,
        platformUserId: req.platformUser!.platformUserId,
        ipAddress: meta.ipAddress,
      })
    );
  })
);

platformRouter.post(
  '/organizations/:id/suspend',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    res.json(
      await suspendOrganization({
        businessId: req.params.id,
        platformUserId: req.platformUser!.platformUserId,
        reason: req.body.reason,
        ipAddress: meta.ipAddress,
      })
    );
  })
);

platformRouter.post(
  '/organizations/:id/reactivate',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    res.json(
      await reactivateOrganization({
        businessId: req.params.id,
        platformUserId: req.platformUser!.platformUserId,
        reason: req.body.reason,
        ipAddress: meta.ipAddress,
      })
    );
  })
);

platformRouter.post(
  '/organizations/:id/plan',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    res.json(
      await changeOrganizationPlan({
        businessId: req.params.id,
        planCode: req.body.planCode,
        billingInterval: req.body.billingInterval ?? 'MONTHLY',
        platformUserId: req.platformUser!.platformUserId,
        reason: req.body.reason,
        ipAddress: meta.ipAddress,
      })
    );
  })
);

platformRouter.post(
  '/organizations/:id/pilot/grant',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    const grant = await grantPilotEntitlement({
      businessId: req.params.id,
      planCode: req.body.planCode ?? 'PRO',
      platformUserId: req.platformUser!.platformUserId,
      notes: req.body.notes,
    });
    await writePlatformAuditLog({
      platformUserId: req.platformUser!.platformUserId,
      action: req.body.extend === true ? 'PILOT_EXTEND' : 'PILOT_GRANT',
      targetBusinessId: req.params.id,
      reason: req.body.reason,
      details: `${grant.plan.code}${req.body.notes ? `: ${req.body.notes}` : ''}`,
      ipAddress: meta.ipAddress,
    });
    res.json(grant);
  })
);

platformRouter.post(
  '/organizations/:id/pilot/revoke',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    const revoked = await revokePilotEntitlement({
      businessId: req.params.id,
      platformUserId: req.platformUser!.platformUserId,
      reason: req.body.reason,
    });
    await writePlatformAuditLog({
      platformUserId: req.platformUser!.platformUserId,
      action: 'PILOT_REVOKE',
      targetBusinessId: req.params.id,
      reason: req.body.reason,
      ipAddress: meta.ipAddress,
    });
    res.json(revoked);
  })
);

platformRouter.get(
  '/audit-logs',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW),
  asyncHandler(async (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '50'), 10);
    res.json(await listPlatformAuditLogs(limit));
  })
);

platformRouter.post(
  '/billing/process-lifecycle',
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  asyncHandler(async (req, res) => {
    const meta = extractRequestMeta(req);
    const result = await processSubscriptionLifecycle();
    await writePlatformAuditLog({
      platformUserId: req.platformUser!.platformUserId,
      action: 'BILLING_LIFECYCLE_RUN',
      details: JSON.stringify(result),
      ipAddress: meta.ipAddress,
    });
    res.json(result);
  })
);
