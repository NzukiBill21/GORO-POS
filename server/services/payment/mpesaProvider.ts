import crypto from 'crypto';
import { AppError } from '../../lib/errors.js';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider } from './types.js';
import { isValidKenyanPhone, normalizeKenyanPhone } from './types.js';

function mpesaConfig() {
  if (process.env.NODE_ENV === 'production' && process.env.MPESA_MOCK === 'true') {
    throw new Error('MPESA_MOCK cannot be enabled in production');
  }
  const env = process.env.MPESA_ENV ?? 'sandbox';
  const baseUrl =
    env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  return {
    env,
    baseUrl,
    consumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
    shortcode: process.env.MPESA_SHORTCODE ?? '174379',
    passkey: process.env.MPESA_PASSKEY ?? '',
    callbackUrl:
      process.env.MPESA_CALLBACK_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3001}/api/billing/webhooks/mpesa`,
    mock: process.env.NODE_ENV !== 'production' && process.env.MPESA_MOCK === 'true',
  };
}

function mpesaTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function mpesaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function getAccessToken(): Promise<string> {
  const cfg = mpesaConfig();
  if (!cfg.consumerKey || !cfg.consumerSecret) {
    throw new AppError('M-Pesa credentials not configured', 503);
  }

  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const res = await fetch(
    `${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`M-Pesa OAuth failed: ${text}`, 502);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export class MpesaProvider implements PaymentProvider {
  readonly name = 'MPESA';

  async initiateStkPush(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!isValidKenyanPhone(input.phoneNumber)) {
      throw new AppError('Invalid M-Pesa phone number. Use 07XXXXXXXX or 2547XXXXXXXX', 400);
    }
    const phone = normalizeKenyanPhone(input.phoneNumber);
    const cfg = mpesaConfig();

    if (cfg.mock || !cfg.consumerKey || !cfg.passkey) {
      const checkoutRequestId = `MOCK-${input.paymentId}-${Date.now()}`;
      return {
        provider: this.name,
        checkoutRequestId,
        merchantRequestId: `MRQ-${crypto.randomBytes(4).toString('hex')}`,
        customerMessage: `STK push sent to ${phone} (development mock). Approve on your phone.`,
        mock: true,
      };
    }

    const token = await getAccessToken();
    const timestamp = mpesaTimestamp();
    const password = mpesaPassword(cfg.shortcode, cfg.passkey, timestamp);

    const body = {
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: input.amountCents,
      PartyA: phone,
      PartyB: cfg.shortcode,
      PhoneNumber: phone,
      CallBackURL: cfg.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    };

    const res = await fetch(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      ResponseCode?: string;
      CustomerMessage?: string;
      errorMessage?: string;
    };

    if (!res.ok || data.ResponseCode !== '0') {
      throw new AppError(data.errorMessage ?? data.CustomerMessage ?? 'M-Pesa STK push failed', 502);
    }

    return {
      provider: this.name,
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      customerMessage: data.CustomerMessage ?? 'STK push sent. Check your phone to approve.',
    };
  }
}

export const mpesaProvider = new MpesaProvider();

export function isMpesaMockMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.MPESA_MOCK === 'true';
}

export { mpesaConfig };
