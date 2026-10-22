import { prisma } from '../../lib/prisma.js';

interface MpesaCallbackBody {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: {
        Item?: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

function metadataValue(items: Array<{ Name: string; Value?: string | number }> | undefined, name: string): string | undefined {
  const item = items?.find((i) => i.Name === name);
  return item?.Value != null ? String(item.Value) : undefined;
}

/** Handle Safaricom STK Push callback — maps to billing webhook processor */
export async function processMpesaStkCallback(rawBody: MpesaCallbackBody) {
  const { billingService } = await import('../billingService.js');
  const cb = rawBody.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) {
    return { processed: false, reason: 'Missing CheckoutRequestID' };
  }

  const payment = await prisma.billingPayment.findFirst({
    where: { providerCheckoutId: cb.CheckoutRequestID },
  });
  if (!payment) {
    return { processed: false, reason: 'Payment not found for checkout ID' };
  }

  const success = cb.ResultCode === 0;
  const mpesaReceipt = metadataValue(cb.CallbackMetadata?.Item, 'MpesaReceiptNumber');
  const providerTransactionId = mpesaReceipt ?? `MPESA-${cb.CheckoutRequestID}`;

  return billingService.processPaymentWebhook({
    provider: 'MPESA',
    providerTransactionId,
    paymentId: payment.id,
    status: success ? 'SUCCEEDED' : 'FAILED',
    failureReason: success ? undefined : cb.ResultDesc,
    rawPayload: JSON.stringify(rawBody),
  });
}

/** Dev mock: simulate successful/failed M-Pesa callback after STK push */
export function scheduleMockMpesaCallback(paymentId: string, checkoutRequestId: string, succeed = true) {
  const delayMs = parseInt(process.env.MPESA_MOCK_DELAY_MS ?? '4000', 10);
  setTimeout(async () => {
    try {
      const { billingService } = await import('../billingService.js');
      await billingService.processPaymentWebhook({
        provider: 'MPESA',
        providerTransactionId: `MOCK-${checkoutRequestId}-${Date.now()}`,
        paymentId,
        status: succeed ? 'SUCCEEDED' : 'FAILED',
        failureReason: succeed ? undefined : 'Mock payment declined',
        rawPayload: JSON.stringify({ mock: true, checkoutRequestId }),
      });
      console.log(`[billing] Mock M-Pesa ${succeed ? 'success' : 'failure'} processed for payment ${paymentId}`);
    } catch (err) {
      console.error('[billing] Mock M-Pesa callback failed:', err);
    }
  }, delayMs);
}
