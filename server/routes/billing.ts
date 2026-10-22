import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';

import { requirePermission } from '../middleware/permissions.js';

import { asyncHandler } from '../lib/errors.js';

import { billingService } from '../services/billingService.js';

import { processMpesaStkCallback } from '../services/payment/mpesaCallbackService.js';

import { PERMISSIONS } from '../lib/permissionRegistry.js';



export const billingRouter = Router();



/** M-Pesa STK callback — no session auth (Safaricom server-to-server) */

billingRouter.post(

  '/webhooks/mpesa',

  asyncHandler(async (req, res) => {

    const result = await processMpesaStkCallback(req.body);

    res.json({ ResultCode: 0, ResultDesc: 'Accepted', ...result });

  })

);



/** Payment provider webhook — no session auth, signature verified inside service */

billingRouter.post(

  '/webhooks/payment',

  asyncHandler(async (req, res) => {

    const signature = req.headers['x-webhook-signature'] as string | undefined;

    const result = await billingService.processPaymentWebhook({

      provider: req.body.provider ?? 'MPESA',

      providerTransactionId: req.body.providerTransactionId,

      paymentId: req.body.paymentId,

      status: req.body.status,

      failureReason: req.body.failureReason,

      rawPayload: JSON.stringify(req.body),

      signature,

    });

    res.json(result);

  })

);



billingRouter.use(authenticate);



billingRouter.get(

  '/overview',

  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.SUBSCRIPTION_VIEW),

  asyncHandler(async (req, res) => {

    res.json(await billingService.getOrganizationBilling(req.user!.businessId));

  })

);



billingRouter.get(

  '/plans',

  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.SUBSCRIPTION_VIEW),

  asyncHandler(async (_req, res) => {

    res.json(await billingService.listPlans());

  })

);



billingRouter.post(

  '/pay',

  requirePermission(PERMISSIONS.BILLING_PAY, PERMISSIONS.BILLING_MANAGE),

  asyncHandler(async (req, res) => {

    const { invoiceId, phoneNumber } = req.body;

    res.json(await billingService.initiatePayment(req.user!.businessId, req.user!.userId, invoiceId, phoneNumber));

  })

);



billingRouter.patch(

  '/settings',

  requirePermission(PERMISSIONS.BILLING_MANAGE),

  asyncHandler(async (req, res) => {

    res.json(await billingService.updateBillingSettings(req.user!.businessId, req.user!.userId, req.body));

  })

);



billingRouter.post(

  '/change-plan',

  requirePermission(PERMISSIONS.BILLING_MANAGE, PERMISSIONS.SUBSCRIPTION_MANAGE),

  asyncHandler(async (req, res) => {

    const { planCode, billingInterval } = req.body;

    res.json(await billingService.changePlan(req.user!.businessId, req.user!.userId, planCode, billingInterval));

  })

);



billingRouter.get(

  '/contacts',

  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE),

  asyncHandler(async (req, res) => {

    res.json(await billingService.listBillingContacts(req.user!.businessId));

  })

);



billingRouter.post(

  '/contacts',

  requirePermission(PERMISSIONS.BILLING_MANAGE),

  asyncHandler(async (req, res) => {

    res.status(201).json(await billingService.addBillingContact(req.user!.businessId, req.user!.userId, req.body));

  })

);



billingRouter.delete(

  '/contacts/:userId',

  requirePermission(PERMISSIONS.BILLING_MANAGE),

  asyncHandler(async (req, res) => {

    res.json(await billingService.removeBillingContact(req.user!.businessId, req.user!.userId, req.params.userId));

  })

);


