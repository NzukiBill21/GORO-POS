import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { clearSubscriptionCache } from '../lib/entitlements.js';
import { notifySubscriptionPayment } from './notificationDispatchService.js';
import { writeAuditLog } from '../lib/audit.js';
import crypto from 'crypto';
import { getPaymentProvider, isMpesaMockMode } from './payment/index.js';
import { scheduleMockMpesaCallback } from './payment/mpesaCallbackService.js';
import { isValidKenyanPhone } from './payment/types.js';

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function periodEndFrom(start: Date, interval: string): Date {
  return interval === 'ANNUAL' ? addYears(start, 1) : addMonths(start, 1);
}

async function nextInvoiceNumber(businessId: string): Promise<string> {
  const count = await prisma.billingInvoice.count({ where: { businessId } });
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

export class BillingService {
  async getOrganizationBilling(businessId: string) {
    const [business, subscription, invoices, payments, contacts, userCount, branchCount, productCount] =
      await Promise.all([
        prisma.business.findUnique({ where: { id: businessId } }),
        prisma.organizationSubscription.findFirst({
          where: { businessId },
          orderBy: { createdAt: 'desc' },
          include: { plan: { include: { prices: true, features: true } } },
        }),
        prisma.billingInvoice.findMany({
          where: { businessId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.billingPayment.findMany({
          where: { businessId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.billingContact.findMany({
          where: { businessId, isActive: true },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
        prisma.user.count({ where: { businessId, isActive: true } }),
        prisma.branch.count({ where: { businessId, isActive: true } }),
        prisma.product.count({ where: { businessId, isActive: true } }),
      ]);

    if (!business) throw new AppError('Organization not found', 404);

    const features: Record<string, string> = {};
    subscription?.plan.features.forEach((f) => {
      features[f.feature] = f.value;
    });

    const interval = subscription?.billingInterval ?? 'MONTHLY';
    const price = subscription?.plan.prices.find((p) => p.billingInterval === interval);
    const amountCents = subscription?.customAmountCents ?? price?.amountCents ?? 0;

    return {
      organization: {
        id: business.id,
        name: business.name,
        status: business.status,
        billingOwnerUserId: business.billingOwnerUserId,
        billingPhone: business.billingPhone,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            planCode: subscription.plan.code,
            planName: subscription.plan.name,
            billingInterval: subscription.billingInterval,
            status: subscription.status,
            amountCents,
            currency: price?.currency ?? 'KES',
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            autoRenew: subscription.autoRenew,
          }
        : null,
      usage: {
        users: { current: userCount, limit: parseInt(features.max_users ?? '0', 10) || null },
        branches: { current: branchCount, limit: parseInt(features.max_branches ?? '0', 10) || null },
        products: { current: productCount, limit: parseInt(features.max_products ?? '0', 10) || null },
      },
      features,
      invoices,
      payments,
      billingContacts: contacts,
    };
  }

  async listPlans() {
    return prisma.plan.findMany({
      where: { isActive: true },
      include: { prices: { where: { isActive: true } }, features: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async initiatePayment(businessId: string, userId: string, invoiceId?: string, phoneNumber?: string) {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new AppError('Organization not found', 404);

    const phone = phoneNumber ?? business.billingPhone ?? business.phone;
    if (!phone) {
      throw new AppError('M-Pesa phone number required. Provide phoneNumber or set billing phone in settings.', 400);
    }
    if (!isValidKenyanPhone(phone)) {
      throw new AppError('Invalid M-Pesa phone number. Use 07XXXXXXXX or 2547XXXXXXXX', 400);
    }

    const sub = await prisma.organizationSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { plan: { include: { prices: true } } },
    });
    if (!sub) throw new AppError('No subscription found', 404);

    let invoice = invoiceId
      ? await prisma.billingInvoice.findFirst({ where: { id: invoiceId, businessId } })
      : null;

    if (!invoice) {
      const price = sub.plan.prices.find((p) => p.billingInterval === sub.billingInterval);
      const amountCents = sub.customAmountCents ?? price?.amountCents ?? 0;
      const now = new Date();
      invoice = await prisma.billingInvoice.create({
        data: {
          businessId,
          subscriptionId: sub.id,
          invoiceNumber: await nextInvoiceNumber(businessId),
          status: 'OPEN',
          subtotalCents: amountCents,
          totalCents: amountCents,
          currency: price?.currency ?? 'KES',
          periodStart: sub.currentPeriodStart ?? now,
          periodEnd: sub.currentPeriodEnd ?? periodEndFrom(now, sub.billingInterval),
          dueDate: now,
          items: {
            create: [{
              description: `${sub.plan.name} — ${sub.billingInterval}`,
              quantity: 1,
              unitCents: amountCents,
              totalCents: amountCents,
            }],
          },
        },
      });
    }

    const payment = await prisma.billingPayment.create({
      data: {
        businessId,
        invoiceId: invoice.id,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        status: 'PENDING',
        provider: 'MPESA',
      },
    });

    const provider = getPaymentProvider('MPESA');
    const stk = await provider.initiateStkPush({
      paymentId: payment.id,
      amountCents: payment.amountCents,
      currency: payment.currency,
      phoneNumber: phone,
      accountReference: invoice.invoiceNumber,
      description: `${sub.plan.name} subscription`,
    });

    await prisma.billingPayment.update({
      where: { id: payment.id },
      data: {
        providerCheckoutId: stk.checkoutRequestId ?? null,
        providerRef: stk.merchantRequestId ?? null,
      },
    });

    await prisma.billingPaymentAttempt.create({
      data: { paymentId: payment.id, status: 'INITIATED' },
    });

    if (stk.mock || isMpesaMockMode()) {
      scheduleMockMpesaCallback(payment.id, stk.checkoutRequestId ?? payment.id);
    }

    await writeAuditLog(
      { action: 'PAYMENT_INITIATED', module: 'BILLING', entityId: payment.id, details: `Invoice ${invoice.invoiceNumber} — STK to ${phone.slice(0, 6)}****` },
      { userId, businessId }
    );

    return {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amountCents: payment.amountCents,
      currency: payment.currency,
      provider: stk.provider,
      checkoutRequestId: stk.checkoutRequestId,
      customerMessage: stk.customerMessage,
      mock: stk.mock ?? false,
    };
  }

  /** Process provider webhook — idempotent source of truth */
  async processPaymentWebhook(payload: {
    provider: string;
    providerTransactionId: string;
    paymentId: string;
    status: 'SUCCEEDED' | 'FAILED';
    failureReason?: string;
    rawPayload?: string;
    signature?: string;
  }) {
    this.verifyWebhookSignature(payload);

    const existing = await prisma.paymentProviderTransaction.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: payload.provider,
          providerTransactionId: payload.providerTransactionId,
        },
      },
    });
    if (existing) {
      return { duplicate: true, processed: false };
    }

    const payment = await prisma.billingPayment.findUnique({
      where: { id: payload.paymentId },
      include: { invoice: true, business: true },
    });
    if (!payment) throw new AppError('Payment not found', 404);

    await prisma.paymentProviderTransaction.create({
      data: {
        paymentId: payment.id,
        provider: payload.provider,
        providerTransactionId: payload.providerTransactionId,
        status: payload.status,
        rawPayload: payload.rawPayload,
      },
    });

    if (payload.status === 'FAILED') {
      await prisma.billingPayment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: payload.failureReason },
      });
      await prisma.billingPaymentAttempt.create({
        data: { paymentId: payment.id, status: 'FAILED', failureReason: payload.failureReason },
      });

      const sub = await prisma.organizationSubscription.findFirst({ where: { businessId: payment.businessId } });
      if (sub) {
        await prisma.organizationSubscription.update({
          where: { id: sub.id },
          data: { status: 'PAST_DUE' },
        });
        await prisma.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            eventType: 'PAYMENT_FAILED',
            previousStatus: sub.status,
            newStatus: 'PAST_DUE',
          },
        });
      }

      const plan = sub
        ? await prisma.plan.findUnique({ where: { id: sub.planId } })
        : null;

      const admins = await prisma.platformUser.findMany({ where: { isActive: true }, select: { id: true } });
      await notifySubscriptionPayment({
        businessId: payment.businessId,
        businessName: payment.business.name,
        planName: plan?.name ?? 'Plan',
        amountCents: payment.amountCents,
        currency: payment.currency,
        providerRef: payload.providerTransactionId,
        success: false,
        failureReason: payload.failureReason,
        platformAdminUserIds: admins.map((a) => a.id),
      });

      clearSubscriptionCache(payment.businessId);
      return { duplicate: false, processed: true, status: 'FAILED' };
    }

    // SUCCESS
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.billingPayment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', providerRef: payload.providerTransactionId, paidAt: now },
      });
      if (payment.invoiceId) {
        await tx.billingInvoice.update({
          where: { id: payment.invoiceId },
          data: { status: 'PAID', paidAt: now },
        });
      }

      const sub = await tx.organizationSubscription.findFirst({
        where: { businessId: payment.businessId },
        include: { plan: true },
      });
      if (!sub) return;

      const periodStart = now;
      const periodEnd = periodEndFrom(periodStart, sub.billingInterval);

      await tx.organizationSubscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: null,
        },
      });
      await tx.business.update({
        where: { id: payment.businessId },
        data: { status: 'ACTIVE' },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: 'PAYMENT_SUCCEEDED',
          previousStatus: sub.status,
          newStatus: 'ACTIVE',
          metadata: JSON.stringify({ providerTransactionId: payload.providerTransactionId }),
        },
      });
    });

    const sub = await prisma.organizationSubscription.findFirst({
      where: { businessId: payment.businessId },
      include: { plan: true },
    });

    const admins = await prisma.platformUser.findMany({ where: { isActive: true }, select: { id: true } });
    await notifySubscriptionPayment({
      businessId: payment.businessId,
      businessName: payment.business.name,
      planName: sub?.plan.name ?? 'Plan',
      amountCents: payment.amountCents,
      currency: payment.currency,
      periodStart: sub?.currentPeriodStart ?? undefined,
      periodEnd: sub?.currentPeriodEnd ?? undefined,
      providerRef: payload.providerTransactionId,
      success: true,
      platformAdminUserIds: admins.map((a) => a.id),
    });

    clearSubscriptionCache(payment.businessId);
    return { duplicate: false, processed: true, status: 'SUCCEEDED' };
  }

  private verifyWebhookSignature(payload: { signature?: string; rawPayload?: string }) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Webhook secret not configured', 500);
      }
      return;
    }
    if (!payload.signature || !payload.rawPayload) {
      throw new AppError('Invalid webhook signature', 401);
    }
    const expected = crypto.createHmac('sha256', secret).update(payload.rawPayload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(payload.signature))) {
      throw new AppError('Invalid webhook signature', 401);
    }
  }

  async getPlatformBillingOverview() {
    const [orgs, subscriptions, payments, plans] = await Promise.all([
      prisma.business.count(),
      prisma.organizationSubscription.findMany({
        include: {
          plan: { include: { prices: true } },
          business: { select: { id: true, name: true } },
        },
      }),
      prisma.billingPayment.findMany({
        where: { status: 'SUCCEEDED' },
        orderBy: { paidAt: 'desc' },
        take: 50,
        include: { business: { select: { name: true } } },
      }),
      prisma.plan.findMany({ include: { prices: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    let mrrCents = 0;

    for (const s of subscriptions) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      const planCode = s.plan?.code ?? 'UNKNOWN';
      byPlan[planCode] = (byPlan[planCode] ?? 0) + 1;
      if ((s.status === 'ACTIVE' || s.status === 'TRIALING') && s.plan) {
        const price = s.plan.prices.find((p) => p.billingInterval === s.billingInterval);
        const cents = s.customAmountCents ?? price?.amountCents ?? 0;
        mrrCents += s.billingInterval === 'ANNUAL' ? Math.round(cents / 12) : cents;
      }
    }

    return {
      totalOrganizations: orgs,
      subscriptionsByStatus: byStatus,
      subscriptionsByPlan: byPlan,
      mrrCents,
      arrCents: mrrCents * 12,
      recentPayments: payments,
      plans,
    };
  }

  async changePlan(businessId: string, userId: string, planCode: string, billingInterval: 'MONTHLY' | 'ANNUAL') {
    const plan = await prisma.plan.findUnique({
      where: { code: planCode },
      include: { prices: true, features: true },
    });
    if (!plan || !plan.isActive) throw new AppError('Plan not found', 404);

    const price = plan.prices.find((p) => p.billingInterval === billingInterval && p.isActive);
    if (!price && planCode !== 'ENTERPRISE') throw new AppError('Price not available for interval', 400);

    const sub = await prisma.organizationSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new AppError('No subscription found', 404);

    const previousPlanId = sub.planId;
    const updated = await prisma.organizationSubscription.update({
      where: { id: sub.id },
      data: {
        planId: plan.id,
        billingInterval,
        customAmountCents: planCode === 'ENTERPRISE' ? sub.customAmountCents : null,
      },
      include: { plan: { include: { features: true, prices: true } } },
    });

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id,
        eventType: 'PLAN_CHANGED',
        previousStatus: sub.status,
        newStatus: updated.status,
        metadata: JSON.stringify({ fromPlanId: previousPlanId, toPlanId: plan.id, billingInterval }),
      },
    });

    await writeAuditLog(
      { action: 'PLAN_CHANGED', module: 'BILLING', entityId: sub.id, details: `Changed to ${plan.name} (${billingInterval})` },
      { userId, businessId }
    );

    clearSubscriptionCache(businessId);
    return updated;
  }

  async listBillingContacts(businessId: string) {
    return prisma.billingContact.findMany({
      where: { businessId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addBillingContact(businessId: string, userId: string, data: { userId: string; role?: 'PRIMARY' | 'SECONDARY' }) {
    const member = await prisma.user.findFirst({ where: { id: data.userId, businessId, isActive: true } });
    if (!member) throw new AppError('User must belong to this organization', 400);

    const role = data.role ?? 'SECONDARY';
    if (role === 'PRIMARY') {
      await prisma.billingContact.updateMany({ where: { businessId, role: 'PRIMARY' }, data: { role: 'SECONDARY' } });
      await prisma.business.update({ where: { id: businessId }, data: { billingOwnerUserId: data.userId } });
    }

    const contact = await prisma.billingContact.upsert({
      where: { businessId_userId: { businessId, userId: data.userId } },
      create: {
        businessId,
        userId: data.userId,
        role,
        isActive: true,
      },
      update: { role, isActive: true },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    await writeAuditLog(
      { action: 'BILLING_CONTACT_CHANGED', module: 'BILLING', entityId: contact.id, details: `Added billing contact ${member.email}` },
      { userId, businessId }
    );
    return contact;
  }

  async removeBillingContact(businessId: string, userId: string, contactUserId: string) {
    const contact = await prisma.billingContact.findFirst({ where: { businessId, userId: contactUserId } });
    if (!contact) throw new AppError('Billing contact not found', 404);

    await prisma.billingContact.update({ where: { id: contact.id }, data: { isActive: false } });

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (business?.billingOwnerUserId === contactUserId) {
      const nextPrimary = await prisma.billingContact.findFirst({
        where: { businessId, isActive: true, userId: { not: contactUserId }, role: 'PRIMARY' },
      });
      const fallback = nextPrimary ?? await prisma.billingContact.findFirst({
        where: { businessId, isActive: true, userId: { not: contactUserId } },
        orderBy: { createdAt: 'asc' },
      });
      await prisma.business.update({
        where: { id: businessId },
        data: { billingOwnerUserId: fallback?.userId ?? null },
      });
    }

    await writeAuditLog(
      { action: 'BILLING_CONTACT_CHANGED', module: 'BILLING', entityId: contact.id, details: 'Removed billing contact' },
      { userId, businessId }
    );
    return { removed: true };
  }

  async updateBillingSettings(
    businessId: string,
    userId: string,
    data: { billingPhone?: string; autoRenew?: boolean }
  ) {
    if (data.billingPhone !== undefined && data.billingPhone !== '' && !isValidKenyanPhone(data.billingPhone)) {
      throw new AppError('Invalid M-Pesa phone number', 400);
    }

    if (data.billingPhone !== undefined) {
      await prisma.business.update({
        where: { id: businessId },
        data: { billingPhone: data.billingPhone || null },
      });
    }

    if (data.autoRenew !== undefined) {
      const sub = await prisma.organizationSubscription.findFirst({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
      });
      if (sub) {
        await prisma.organizationSubscription.update({
          where: { id: sub.id },
          data: { autoRenew: data.autoRenew },
        });
      }
    }

    await writeAuditLog(
      { action: 'BILLING_SETTINGS_UPDATED', module: 'BILLING', details: JSON.stringify(data) },
      { userId, businessId }
    );

    return this.getOrganizationBilling(businessId);
  }
}

export const billingService = new BillingService();
