import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { hashToken, generateSecureToken } from '../lib/crypto.js';
import { hashPasswordUnsafe, validatePasswordComplexity } from '../lib/password.js';
import { generatePasswordResetCode } from '../lib/passwordResetCode.js';
import {
  isSmtpConfigured,
  sendBusinessRegistrationEmail,
  sendAccountInvitationEmail,
} from '../lib/mail.js';
import { isPublicRegistrationEnabled, inviteBaseUrl } from '../lib/onboardingConfig.js';
import {
  buildInvitationDeliveryResponse,
  canLogInvitationSecretsInDev,
  type InvitationDeliveryStatus,
} from '../lib/invitationDelivery.js';
import { provisionBusinessWithOwner } from './businessProvisioningService.js';
import { writeAuditLog, logActivity, extractRequestMeta } from '../lib/audit.js';
import type { Request } from 'express';

const REGISTRATION_EXPIRY_MINUTES = 30;
const INVITE_EXPIRY_MINUTES = 72 * 60;

export function getOnboardingPublicStatus() {
  return {
    publicRegistrationEnabled: isPublicRegistrationEnabled(),
    smtpConfigured: isSmtpConfigured(),
    desktopMode: process.env.DESKTOP_MODE === 'true',
  };
}

export async function startBusinessRegistration(input: {
  businessName: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
}) {
  if (!isPublicRegistrationEnabled()) {
    throw new AppError('Public registration is not available on this server', 403, 'REGISTRATION_DISABLED');
  }
  if (process.env.DESKTOP_MODE === 'true') {
    throw new AppError('Use first-time setup on this till instead of web registration', 403);
  }

  const email = input.ownerEmail.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError('An account with this email already exists. Sign in or use password recovery.', 409);
  }

  await prisma.businessRegistrationPending.deleteMany({
    where: { email, expiresAt: { lt: new Date() } },
  });

  const code = generatePasswordResetCode();
  const token = generateSecureToken(24);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + REGISTRATION_EXPIRY_MINUTES);

  await prisma.businessRegistrationPending.create({
    data: {
      email,
      businessName: input.businessName.trim(),
      firstName: input.ownerFirstName.trim(),
      lastName: input.ownerLastName.trim(),
      codeHash: hashToken(code),
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  let verifyUrl: string | undefined;
  const base = inviteBaseUrl();
  if (base) verifyUrl = `${base}/register?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Email verification is not configured. Contact GOROVIAN support.', 503);
    }
    if (process.env.REGISTRATION_DEV_LOG === 'true') {
      console.log(`[DEV] Registration code for ${email}: ${code} token=${token}`);
    }
    return {
      message: canLogInvitationSecretsInDev()
        ? 'Verification code sent (development: check server logs if REGISTRATION_DEV_LOG=true).'
        : 'Verification pending — configure SMTP or enable REGISTRATION_DEV_LOG in development.',
      email,
    };
  }

  await sendBusinessRegistrationEmail({
    to: email,
    firstName: input.ownerFirstName.trim(),
    businessName: input.businessName.trim(),
    code,
    verifyUrl,
  });

  return {
    message: 'We sent a verification code to your email. Enter it to finish creating your shop.',
    email,
  };
}

export async function completeBusinessRegistration(input: {
  email: string;
  code: string;
  password: string;
  token?: string;
}) {
  if (!isPublicRegistrationEnabled()) {
    throw new AppError('Public registration is not available', 403);
  }

  const validation = validatePasswordComplexity(input.password);
  if (!validation.valid) throw new AppError(validation.errors.join('. '), 400);

  const email = input.email.trim().toLowerCase();
  const pending = await prisma.businessRegistrationPending.findFirst({
    where: {
      email,
      expiresAt: { gt: new Date() },
      ...(input.token ? { tokenHash: hashToken(input.token) } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending || pending.codeHash !== hashToken(input.code.trim())) {
    throw new AppError('Invalid or expired verification code', 400);
  }

  const dup = await prisma.user.findUnique({ where: { email } });
  if (dup) throw new AppError('Email already registered', 409);

  const passwordHash = await hashPasswordUnsafe(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const provisioned = await provisionBusinessWithOwner(tx, {
      businessName: pending.businessName,
      ownerEmail: email,
      ownerFirstName: pending.firstName,
      ownerLastName: pending.lastName,
      ownerPasswordHash: passwordHash,
      planCode: 'REGULAR',
      emailVerified: true,
      mustSetPassword: false,
    });

    await tx.businessRegistrationPending.delete({ where: { id: pending.id } });
    return provisioned;
  });

  return {
    businessId: result.businessId,
    message: 'Your shop is ready. Sign in with your email and password.',
  };
}

async function deliverInvitationEmail(params: {
  inviteId: string;
  expiresAt: Date;
  email: string;
  firstName: string;
  businessName: string;
  inviteType: 'OWNER_SETUP' | 'EMPLOYEE';
  code: string;
  token: string;
}) {
  const base = inviteBaseUrl();
  const inviteUrl = base
    ? `${base}/accept-invite?token=${encodeURIComponent(params.token)}&email=${encodeURIComponent(params.email)}`
    : undefined;

  let status: InvitationDeliveryStatus = 'NOT_CONFIGURED';
  let emailSentAt: Date | null = null;
  let emailDeliveryError: string | null = null;

  try {
    if (isSmtpConfigured()) {
      await sendAccountInvitationEmail({
        to: params.email,
        firstName: params.firstName,
        businessName: params.businessName,
        inviteType: params.inviteType,
        code: params.code,
        inviteUrl,
      });
      status = 'SENT';
      emailSentAt = new Date();
    } else if (process.env.NODE_ENV === 'production') {
      status = 'NOT_CONFIGURED';
      emailDeliveryError = 'SMTP is not configured on this server.';
    } else if (canLogInvitationSecretsInDev()) {
      console.log(
        `[DEV] Invitation ${params.inviteId} (${params.inviteType}) for ${params.email}: code=${params.code} token=${params.token}`
      );
      status = 'DEV_LOGGED';
    } else {
      emailDeliveryError = 'SMTP not configured. Set REGISTRATION_DEV_LOG=true in development to log invitation codes server-side.';
    }
  } catch (err) {
    status = 'FAILED';
    emailDeliveryError = err instanceof Error ? err.message : 'Email delivery failed';
  }

  await prisma.userInvitation.update({
    where: { id: params.inviteId },
    data: { emailSentAt, emailDeliveryError },
  });

  return buildInvitationDeliveryResponse({
    inviteId: params.inviteId,
    expiresAt: params.expiresAt,
    status,
    emailSentAt,
    emailDeliveryError,
  });
}

export async function createOwnerInvitationForUser(params: {
  userId: string;
  businessId: string;
  email: string;
  invitedByPlatformUserId?: string;
  invitedByUserId?: string;
}) {
  const token = generateSecureToken(24);
  const code = generatePasswordResetCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + INVITE_EXPIRY_MINUTES);

  await prisma.userInvitation.deleteMany({
    where: { userId: params.userId, acceptedAt: null },
  });

  const invite = await prisma.userInvitation.create({
    data: {
      businessId: params.businessId,
      userId: params.userId,
      email: params.email.trim().toLowerCase(),
      roleId: (await prisma.user.findUnique({ where: { id: params.userId }, select: { roleId: true } }))!.roleId,
      inviteType: 'OWNER_SETUP',
      tokenHash: hashToken(token),
      codeHash: hashToken(code),
      invitedByPlatformUserId: params.invitedByPlatformUserId,
      invitedByUserId: params.invitedByUserId,
      expiresAt,
    },
    include: { business: { select: { name: true } }, user: { select: { firstName: true } } },
  });

  return deliverInvitationEmail({
    inviteId: invite.id,
    expiresAt,
    email: params.email.trim().toLowerCase(),
    firstName: invite.user.firstName,
    businessName: invite.business.name,
    inviteType: 'OWNER_SETUP',
    code,
    token,
  });
}

export async function resendOwnerInvitation(params: {
  businessId: string;
  platformUserId: string;
}) {
  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { billingOwnerUserId: true, name: true },
  });
  if (!business?.billingOwnerUserId) {
    throw new AppError('No billing owner on this organization', 404);
  }

  const owner = await prisma.user.findUnique({
    where: { id: business.billingOwnerUserId },
    select: { id: true, email: true, mustSetPassword: true, isActive: true },
  });
  if (!owner || !owner.isActive) throw new AppError('Owner account not found', 404);
  if (!owner.mustSetPassword) {
    throw new AppError('Owner has already completed account setup', 400);
  }

  return createOwnerInvitationForUser({
    userId: owner.id,
    businessId: params.businessId,
    email: owner.email,
    invitedByPlatformUserId: params.platformUserId,
  });
}

export async function inviteEmployee(params: {
  businessId: string;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  branchId?: string;
}) {
  const { EmployeeService } = await import('./employeeService.js');
  const employeeService = new EmployeeService();
  await employeeService.validateInviteRole(params.roleId, params.invitedByUserId);

  const { requireWithinLimit } = await import('../lib/entitlements.js');
  await requireWithinLimit(params.businessId, 'max_users');

  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Email already in use', 409);

  const placeholderHash = await hashPasswordUnsafe(generateSecureToken(32));
  const { resolveBranchIdForBusiness } = await import('../lib/branchContext.js');
  const branchId = params.branchId ?? (await resolveBranchIdForBusiness(params.businessId));

  const user = await prisma.user.create({
    data: {
      businessId: params.businessId,
      email,
      passwordHash: placeholderHash,
      firstName: params.firstName.trim(),
      lastName: params.lastName.trim(),
      roleId: params.roleId,
      branchId,
      isActive: true,
      mustSetPassword: true,
      emailVerifiedAt: new Date(),
    },
  });

  const token = generateSecureToken(24);
  const code = generatePasswordResetCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + INVITE_EXPIRY_MINUTES);

  const business = await prisma.business.findUnique({ where: { id: params.businessId }, select: { name: true } });

  const invite = await prisma.userInvitation.create({
    data: {
      businessId: params.businessId,
      userId: user.id,
      email,
      roleId: params.roleId,
      inviteType: 'EMPLOYEE',
      tokenHash: hashToken(token),
      codeHash: hashToken(code),
      invitedByUserId: params.invitedByUserId,
      expiresAt,
    },
  });

  const delivery = await deliverInvitationEmail({
    inviteId: invite.id,
    expiresAt,
    email,
    firstName: params.firstName.trim(),
    businessName: business!.name,
    inviteType: 'EMPLOYEE',
    code,
    token,
  });

  if (delivery.deliveryStatus === 'FAILED' || delivery.deliveryStatus === 'NOT_CONFIGURED') {
    if (process.env.NODE_ENV === 'production') {
      await prisma.userInvitation.delete({ where: { id: invite.id } });
      await prisma.user.delete({ where: { id: user.id } });
      throw new AppError(delivery.emailDeliveryError ?? 'Could not send invitation email', 503);
    }
  }

  await logActivity({
    userId: params.invitedByUserId,
    action: 'CREATE',
    module: 'EMPLOYEES',
    entityId: user.id,
    details: `Invited employee ${params.firstName} ${params.lastName} (${email})`,
  });

  return {
    userId: user.id,
    email,
    invitation: delivery,
    message:
      delivery.deliveryStatus === 'SENT'
        ? 'Invitation sent. They must set a password before signing in.'
        : delivery.devHint ?? delivery.emailDeliveryError ?? 'Invitation created; email delivery pending.',
  };
}

export async function getInvitationPreview(token: string, email: string) {
  const invite = await prisma.userInvitation.findFirst({
    where: {
      tokenHash: hashToken(token),
      email: email.trim().toLowerCase(),
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      business: { select: { name: true } },
      user: { select: { firstName: true, mustSetPassword: true } },
    },
  });
  if (!invite) throw new AppError('Invalid or expired invitation', 400);
  return {
    email: invite.email,
    businessName: invite.business.name,
    firstName: invite.user.firstName,
    inviteType: invite.inviteType,
  };
}

export async function acceptInvitation(input: {
  email: string;
  code: string;
  password: string;
  token?: string;
  req: Request;
}) {
  const validation = validatePasswordComplexity(input.password);
  if (!validation.valid) throw new AppError(validation.errors.join('. '), 400);

  const email = input.email.trim().toLowerCase();
  const codeHash = hashToken(input.code.trim());

  const invite = await prisma.userInvitation.findFirst({
    where: {
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      codeHash,
    },
    orderBy: { createdAt: 'desc' },
    include: { user: true },
  });

  if (!invite) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.mustSetPassword) {
      throw new AppError('This invitation was already accepted. Sign in with your email and password.', 400);
    }
    throw new AppError(
      'Invalid or expired invitation code. Use the 6-digit code from your latest invitation email, or ask your admin to resend.',
      400
    );
  }

  // Stale link token in the URL is ignored when the 6-digit code matches the active invitation.

  const passwordHash = await hashPasswordUnsafe(input.password);
  const meta = extractRequestMeta(input.req);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: invite.userId },
      data: {
        passwordHash,
        mustSetPassword: false,
        passwordChangedAt: new Date(),
        emailVerifiedAt: invite.user.emailVerifiedAt ?? new Date(),
      },
    }),
    prisma.userInvitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  await writeAuditLog(
    { action: 'INVITE_ACCEPTED', module: 'AUTH', details: invite.inviteType },
    { userId: invite.userId, businessId: invite.businessId, ...meta }
  );

  return { success: true, message: 'Password set. You can sign in now.' };
}

export async function getOwnerOnboardingChecklist(businessId: string, userId: string) {
  const [productCount, staffCount, business] = await Promise.all([
    prisma.product.count({ where: { businessId, isActive: true } }),
    prisma.user.count({ where: { businessId, isActive: true } }),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { billingOwnerUserId: true, name: true },
    }),
  ]);

  const isOwner = business?.billingOwnerUserId === userId;
  const steps = [
    { id: 'account', label: 'Account ready', done: true },
    { id: 'products', label: 'Add your first product', done: productCount > 0, href: '/products' },
    { id: 'staff', label: 'Invite your team (optional)', done: staffCount > 1, href: '/employees' },
    { id: 'pos', label: 'Try a sale at the till', done: false, href: '/pos' },
  ];

  const subscription = await prisma.organizationSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });

  return {
    isOwner,
    businessName: business?.name,
    subscriptionStatus: subscription?.status ?? 'NONE',
    steps,
    completedCount: steps.filter((s) => s.done).length,
  };
}
