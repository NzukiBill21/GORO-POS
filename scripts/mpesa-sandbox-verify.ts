/**
 * Verify Daraja sandbox OAuth (no STK charge, no customer SMS).
 * Usage: npm run mpesa:verify
 */
import { loadShopEnvironment } from '../server/lib/loadEnv.js';
import { resolveMpesaEnv, resolveDarajaBaseUrl } from '../server/lib/mpesaDarajaConfig.js';
import { getDarajaOAuthToken, clearMpesaOAuthCacheForTests } from '../server/lib/mpesaOAuthCache.js';

loadShopEnvironment();

async function main() {
  const key = process.env.MPESA_CONSUMER_KEY?.trim();
  const secret = process.env.MPESA_CONSUMER_SECRET?.trim();
  const passkey = process.env.MPESA_PASSKEY?.trim();
  const shortcode = process.env.MPESA_SHORTCODE?.trim() || '174379';

  if (!key || !secret) {
    console.error('Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in .env (then restart dev:web).');
    process.exit(1);
  }
  if (!passkey) {
    console.warn('MPESA_PASSKEY is empty — STK push will fail until passkey is set.');
  }

  const mock = process.env.MPESA_MOCK === 'true';
  if (mock) {
    console.warn('MPESA_MOCK=true — POS will NOT call Daraja until you set MPESA_MOCK=false.');
  }

  const callback = process.env.MPESA_POS_CALLBACK_URL?.trim();
  if (!callback || callback.includes('127.0.0.1') || callback.includes('localhost')) {
    console.warn(
      'MPESA_POS_CALLBACK_URL should be public HTTPS (ngrok/cloudflared or Cloudflare relay).\n' +
        'Without it, STK may still send but payment completion relies on STK Query polling.'
    );
  } else {
    console.log('Callback URL configured (host hidden):', new URL(callback).origin + '…');
  }

  clearMpesaOAuthCacheForTests();
  const env = resolveMpesaEnv();
  const base = resolveDarajaBaseUrl(env);

  try {
    const token = await getDarajaOAuthToken(env, key, secret);
    console.log(`Daraja OAuth OK (${env}, ${base}). Token length: ${token.length}.`);
    console.log(`Shortcode: ${shortcode}, passkey: ${passkey ? 'set' : 'MISSING'}`);
    console.log('Next: restart npm run dev:web, POS → M-Pesa, sandbox phone 254708374149.');
  } catch (e) {
    console.error('Daraja OAuth failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
