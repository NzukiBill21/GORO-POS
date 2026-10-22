import { mpesaProvider } from './mpesaProvider.js';
import type { PaymentProvider } from './types.js';

const providers: Record<string, PaymentProvider> = {
  MPESA: mpesaProvider,
};

export function getPaymentProvider(name = 'MPESA'): PaymentProvider {
  const provider = providers[name.toUpperCase()];
  if (!provider) throw new Error(`Unknown payment provider: ${name}`);
  return provider;
}

export { mpesaProvider, isMpesaMockMode } from './mpesaProvider.js';
export { normalizeKenyanPhone, isValidKenyanPhone } from './types.js';
export type { InitiatePaymentInput, InitiatePaymentResult } from './types.js';
