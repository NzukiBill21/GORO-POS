import { AppError } from './errors.js';
import { getTenantMpesaCredentials } from '../services/pos/posPaymentConfigService.js';

export type MpesaEnv = 'sandbox' | 'production';

export function resolveMpesaEnv(): MpesaEnv {
  return process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
}

export function resolveDarajaBaseUrl(env: MpesaEnv = resolveMpesaEnv()): string {
  return env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

export interface PosMpesaCredentials {
  shortcode: string;
  till: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  callbackUrl: string;
}

function envSandboxCredentials(): Partial<PosMpesaCredentials> {
  if (resolveMpesaEnv() === 'production') return {};
  return {
    consumerKey: process.env.MPESA_CONSUMER_KEY?.trim() || undefined,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET?.trim() || undefined,
    passkey: process.env.MPESA_PASSKEY?.trim() || undefined,
    shortcode: process.env.MPESA_SHORTCODE?.trim() || undefined,
    till: process.env.MPESA_TILL?.trim() || undefined,
  };
}

/** Daraja rejects loopback callbacks; STK will fail with an opaque provider error. */
export function validateStkCallbackUrlForLiveStk(callbackUrl: string): void {
  const u = callbackUrl.trim();
  if (/127\.0\.0\.1|localhost/i.test(u)) {
    throw new AppError(
      'M-Pesa STK needs a public HTTPS callback (ngrok, cloudflared, or Cloudflare relay). Set MPESA_POS_CALLBACK_URL, or use MPESA_MOCK=true for local testing without Daraja.',
      400
    );
  }
  if (!u.startsWith('https://')) {
    throw new AppError('M-Pesa callback URL must use HTTPS.', 400);
  }
}

function isLoopbackCallbackUrl(url: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(url);
}

export async function resolveStkCallbackUrl(businessId: string, tenantUrl?: string | null): Promise<string> {
  const envUrl = process.env.MPESA_POS_CALLBACK_URL?.trim();
  const tenant = tenantUrl?.trim();
  if (envUrl && (!tenant || isLoopbackCallbackUrl(tenant))) return envUrl;
  if (tenant) return tenant;
  if (envUrl) return envUrl;
  const relay = process.env.MPESA_RELAY_URL?.trim();
  if (relay) {
    const base = relay.replace(/\/$/, '');
    return `${base}/v1/mpesa/stk-callback?tenant=${encodeURIComponent(businessId)}`;
  }
  return `http://127.0.0.1:${process.env.PORT ?? 3001}/api/pos/webhooks/mpesa/stk`;
}

/** Server-only Daraja credentials (tenant first; sandbox env fallback). */
export async function resolvePosMpesaCredentials(businessId: string): Promise<PosMpesaCredentials | null> {
  const tenant = await getTenantMpesaCredentials(businessId);
  const envFill = envSandboxCredentials();
  const env = resolveMpesaEnv();

  const consumerKey = tenant?.consumerKey || envFill.consumerKey || '';
  const consumerSecret = tenant?.consumerSecret || envFill.consumerSecret || '';
  const passkey = tenant?.passkey || envFill.passkey || '';
  const shortcode = tenant?.shortcode || envFill.shortcode || '';
  const till = tenant?.till || envFill.till || '';

  if (!consumerKey) return null;

  if (env === 'production' && (!tenant?.consumerKey || !tenant?.passkey)) {
    throw new AppError('M-Pesa production credentials must be configured in Settings → Payments', 400);
  }

  const callbackUrl = await resolveStkCallbackUrl(businessId, tenant?.callbackUrl);

  return {
    shortcode,
    till,
    consumerKey,
    consumerSecret,
    passkey,
    callbackUrl,
  };
}
