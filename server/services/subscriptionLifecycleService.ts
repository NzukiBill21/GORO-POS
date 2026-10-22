import { prisma } from '../lib/prisma.js';
import { clearSubscriptionCache } from '../lib/entitlements.js';
import { dispatchNotification, getBillingNotificationRecipients } from './notificationDispatchService.js';
import { billingService } from '../services/billingService.js';
import { isPilotSponsored } from './pilotService.js';

const RENEWAL_REMINDER_DAYS = [7, 3, 1, 0];
const GRACE_PERIOD_DAYS = 7;

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function reminderEventType(day: number): string {
  return `RENEWAL_REMINDER_${day}D`;
}

async function alreadySentEvent(subscriptionId: string, eventType: string): Promise<boolean> {
  const existing = await prisma.subscriptionEvent.findFirst({
    where: { subscriptionId, eventType },
  });
  return !!existing;
}

async function resolveBillingPhone(businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { billingPhone: true, phone: true, billingOwnerUserId: true },
  });
  if (!business) return null;
  if (business.billingPhone) return business.billingPhone;
  if (business.phone) return business.phone;
  if (business.billingOwnerUserId) {
    const owner = await prisma.user.findUnique({
      where: { id: business.billingOwnerUserId },
      select: { phone: true },
    });
    if (owner?.phone) return owner.phone;
  }
  return null;
}

/** Process subscription renewal reminders, auto-renewal STK, grace-period and suspension */
export async function processSubscriptionLifecycle() {
  const subscriptions = await prisma.organizationSubscription.findMany({
    where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'GRACE_PERIOD'] } },
    include: { plan: { include: { prices: true } }, business: { select: { id: true, name: true } } },
  });

  let processed = 0;

  for (const sub of subscriptions) {
    if (await isPilotSponsored(sub.businessId)) continue;
    if (!sub.currentPeriodEnd) continue;
    const days = daysUntil(sub.currentPeriodEnd);

    // Renewal reminders (deduplicated via subscription events)
    for (const reminderDay of RENEWAL_REMINDER_DAYS) {
      const eventType = reminderEventType(reminderDay);
      if (days === reminderDay && (sub.status === 'ACTIVE' || sub.status === 'TRIALING')) {
        if (await alreadySentEvent(sub.id, eventType)) continue;

        const recipients = await getBillingNotificationRecipients(sub.businessId);
        const title =
          reminderDay === 0
            ? 'Subscription renews today'
            : `Subscription renews in ${reminderDay} day${reminderDay === 1 ? '' : 's'}`;
        const message = `${sub.business.name}: ${sub.plan.name} renews on ${sub.currentPeriodEnd.toLocaleDateString()}.`;

        for (const userId of recipients) {
          await dispatchNotification({
            businessId: sub.businessId,
            recipientUserId: userId,
            type: 'SUBSCRIPTION_RENEWAL_UPCOMING',
            title,
            message,
            severity: reminderDay <= 1 ? 'WARNING' : 'INFO',
            entityType: 'subscription',
            entityId: sub.id,
          });
        }

        await prisma.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            eventType,
            previousStatus: sub.status,
            newStatus: sub.status,
          },
        });
        processed++;
      }
    }

    // Auto-renewal: on renewal day, auto-create invoice + STK push if enabled
    if (
      days <= 0 &&
      sub.autoRenew &&
      (sub.status === 'ACTIVE' || sub.status === 'TRIALING') &&
      !(await alreadySentEvent(sub.id, 'AUTO_RENEW_INITIATED'))
    ) {
      const phone = await resolveBillingPhone(sub.businessId);
      if (phone) {
        try {
          const owner = await prisma.business.findUnique({
            where: { id: sub.businessId },
            select: { billingOwnerUserId: true },
          });
          const actorId =
            owner?.billingOwnerUserId ??
            (await prisma.user.findFirst({ where: { businessId: sub.businessId }, select: { id: true } }))?.id;
          if (actorId) {
            await billingService.initiatePayment(sub.businessId, actorId, undefined, phone);
            await prisma.subscriptionEvent.create({
              data: {
                subscriptionId: sub.id,
                eventType: 'AUTO_RENEW_INITIATED',
                previousStatus: sub.status,
                newStatus: sub.status,
                metadata: JSON.stringify({ phone: phone.slice(0, 6) + '****' }),
              },
            });
            processed++;
          }
        } catch (err) {
          console.error(`[billing] Auto-renew failed for ${sub.businessId}:`, err);
        }
      }
    }

    // Period ended without payment → PAST_DUE
    if (days < 0 && (sub.status === 'ACTIVE' || sub.status === 'TRIALING') && !(await alreadySentEvent(sub.id, 'PERIOD_ENDED_UNPAID'))) {
      await prisma.organizationSubscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' },
      });
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: 'PERIOD_ENDED_UNPAID',
          previousStatus: sub.status,
          newStatus: 'PAST_DUE',
        },
      });
      clearSubscriptionCache(sub.businessId);
      processed++;
      continue;
    }

    if (sub.status === 'PAST_DUE' && days < 0 && !sub.gracePeriodEndsAt && !(await alreadySentEvent(sub.id, 'GRACE_PERIOD_STARTED'))) {
      const graceEnd = addDays(new Date(), GRACE_PERIOD_DAYS);
      await prisma.organizationSubscription.update({
        where: { id: sub.id },
        data: { status: 'GRACE_PERIOD', gracePeriodEndsAt: graceEnd },
      });
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: 'GRACE_PERIOD_STARTED',
          previousStatus: 'PAST_DUE',
          newStatus: 'GRACE_PERIOD',
        },
      });

      const recipients = await getBillingNotificationRecipients(sub.businessId);
      for (const userId of recipients) {
        await dispatchNotification({
          businessId: sub.businessId,
          recipientUserId: userId,
          type: 'SUBSCRIPTION_EXPIRING',
          title: 'Subscription in grace period',
          message: `Payment overdue for ${sub.business.name}. Grace period until ${graceEnd.toLocaleDateString()}.`,
          severity: 'WARNING',
          entityType: 'subscription',
          entityId: sub.id,
        });
      }
      clearSubscriptionCache(sub.businessId);
      processed++;
    }

    if (
      sub.status === 'GRACE_PERIOD' &&
      sub.gracePeriodEndsAt &&
      sub.gracePeriodEndsAt < new Date() &&
      !(await alreadySentEvent(sub.id, 'SUBSCRIPTION_SUSPENDED'))
    ) {
      await prisma.organizationSubscription.update({
        where: { id: sub.id },
        data: { status: 'SUSPENDED' },
      });
      await prisma.business.update({
        where: { id: sub.businessId },
        data: { status: 'SUSPENDED' },
      });
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: 'SUBSCRIPTION_SUSPENDED',
          previousStatus: 'GRACE_PERIOD',
          newStatus: 'SUSPENDED',
        },
      });

      const recipients = await getBillingNotificationRecipients(sub.businessId);
      for (const userId of recipients) {
        await dispatchNotification({
          businessId: sub.businessId,
          recipientUserId: userId,
          type: 'SUBSCRIPTION_SUSPENDED',
          title: 'Subscription suspended',
          message: `${sub.business.name} has been suspended due to non-payment. Pay to restore access.`,
          severity: 'CRITICAL',
          entityType: 'subscription',
          entityId: sub.id,
        });
      }
      clearSubscriptionCache(sub.businessId);
      processed++;
    }
  }

  return { processed };
}
