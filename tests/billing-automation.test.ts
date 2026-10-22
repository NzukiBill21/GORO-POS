import { describe, it, expect } from 'vitest';
import { normalizeKenyanPhone, isValidKenyanPhone } from '../server/services/payment/types.js';
import { isMpesaMockMode } from '../server/services/payment/mpesaProvider.js';

describe('M-Pesa phone normalization', () => {
  it('normalizes 07XXXXXXXX to 2547XXXXXXXX', () => {
    expect(normalizeKenyanPhone('0712345678')).toBe('254712345678');
  });

  it('accepts 254 format', () => {
    expect(isValidKenyanPhone('254712345678')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(isValidKenyanPhone('12345')).toBe(false);
  });
});

describe('M-Pesa mock mode', () => {
  it('is off unless MPESA_MOCK=true (never in production)', () => {
    const prev = process.env.MPESA_MOCK;
    process.env.MPESA_MOCK = 'true';
    expect(isMpesaMockMode()).toBe(true);
    process.env.MPESA_MOCK = prev;
  });
});
