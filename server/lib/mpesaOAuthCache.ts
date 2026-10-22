import { AppError } from './errors.js';
import { resolveDarajaBaseUrl, type MpesaEnv } from './mpesaDarajaConfig.js';

type CacheEntry = { token: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function cacheKey(env: MpesaEnv, consumerKey: string): string {
  return `${env}:${consumerKey}`;
}

export function clearMpesaOAuthCacheForTests(): void {
  cache.clear();
}

export async function getDarajaOAuthToken(
  env: MpesaEnv,
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  const key = cacheKey(env, consumerKey);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now + 60_000) {
    return hit.token;
  }

  const baseUrl = resolveDarajaBaseUrl(env);
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new AppError('M-Pesa OAuth failed', 502);
  const data = (await res.json()) as { access_token: string; expires_in?: string | number };
  const expiresInSec = Number(data.expires_in ?? 3599);
  cache.set(key, {
    token: data.access_token,
    expiresAt: now + Math.max(60, expiresInSec) * 1000,
  });
  return data.access_token;
}
