import { prisma } from '../lib/prisma.js';

export type NotificationType =
  | 'SUBSCRIPTION_PAYMENT_SUCCESS'
  | 'SUBSCRIPTION_PAYMENT_FAILED'
  | 'SUBSCRIPTION_RENEWAL_UPCOMING'
  | 'SUBSCRIPTION_EXPIRING'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'SUBSCRIPTION_REACTIVATED'
  | 'LOW_STOCK'
  | 'LARGE_EXPENSE'
  | 'SALE_REFUND'
  | 'SHIFT_CLOSED'
  | 'CASH_VARIANCE'
  | 'NEW_USER'
  | 'SECURITY_ALERT'
  | 'SYSTEM';

interface DispatchInput {
  businessId?: string;
  recipientUserId?: string;
  type: NotificationType;
  title: string;
  message: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/** Critical billing types — billing owner cannot fully suppress */
const CRITICAL_BILLING_TYPES = new Set<NotificationType>([
  'SUBSCRIPTION_PAYMENT_FAILED',
  'SUBSCRIPTION_EXPIRING',
  'SUBSCRIPTION_SUSPENDED',
]);

export async function dispatchNotification(input: DispatchInput) {
  const prefs = input.recipientUserId
    ? await prisma.notificationPreference.findUnique({
        where: {
          userId_notificationType: {
            userId: input.recipientUserId,
            notificationType: input.type,
          },
        },
      })
    : null;

  if (prefs && !prefs.inAppEnabled && !CRITICAL_BILLING_TYPES.has(input.type)) {
    return null;
  }

  return prisma.notification.create({
    data: {
      businessId: input.businessId,
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? 'INFO',
      entityType: input.entityType,
      entityId: input.entityId,
      data: input.data ? JSON.stringify(input.data) : undefined,
    },
  });
}

/** Resolve billing notification recipients for an organization */
export async function getBillingNotificationRecipients(businessId: string): Promise<string[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { billingOwnerUserId: true },
  });
  if (!business) return [];

  const recipientIds = new Set<string>();
  if (business.billingOwnerUserId) {
    recipientIds.add(business.billingOwnerUserId);
  }

  const contacts = await prisma.billingContact.findMany({
    where: { businessId, isActive: true },
    select: { userId: true },
  });
  for (const c of contacts) recipientIds.add(c.userId);

  return [...recipientIds];
}

/** Subscription payment success/failure — never notify cashiers by default */
export async function notifySubscriptionPayment(params: {
  businessId: string;
  businessName: string;
  planName: string;
  amountCents: number;
  currency: string;
  periodStart?: Date;
  periodEnd?: Date;
  providerRef?: string;
  success: boolean;
  failureReason?: string;
  platformAdminUserIds: string[];
}) {
  const amount = (params.amountCents / 1).toLocaleString('en-KE');
  const period =
    params.periodStart && params.periodEnd
      ? `${params.periodStart.toLocaleDateString()} - ${params.periodEnd.toLocaleDateString()}`
      : '';

  const recipients = await getBillingNotificationRecipients(params.businessId);

  const type: NotificationType = params.success
    ? 'SUBSCRIPTION_PAYMENT_SUCCESS'
    : 'SUBSCRIPTION_PAYMENT_FAILED';

  const title = params.success ? 'Subscription payment received' : 'Subscription payment failed';
  const message = params.success
    ? `Payment received for ${params.businessName}. Plan: ${params.planName}. Amount: ${params.currency} ${amount}. ${period ? `Period: ${period}. ` : ''}${params.providerRef ? `Ref: ${params.providerRef}` : ''}`
    : `Subscription payment failed for ${params.businessName}. Plan: ${params.planName}. Amount: ${params.currency} ${amount}. ${params.failureReason ?? 'Payment declined'}. Please update payment method or retry.`;

  const severity = params.success ? 'INFO' : 'WARNING';

  for (const userId of recipients) {
    await dispatchNotification({
      businessId: params.businessId,
      recipientUserId: userId,
      type,
      title,
      message,
      severity,
      entityType: 'subscription_payment',
    });
  }

  // Platform admin notifications (stored without business scoping on recipient — platform users use separate table)
  // For org-scoped audit, create notifications with businessId only for platform visibility via admin API
  for (const _adminId of params.platformAdminUserIds) {
    await dispatchNotification({
      businessId: params.businessId,
      type,
      title: `[Platform] ${title}`,
      message: `[${params.businessName}] ${message}`,
      severity,
      entityType: 'subscription_payment',
    });
  }
}
