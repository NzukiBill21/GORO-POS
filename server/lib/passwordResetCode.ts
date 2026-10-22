import crypto from 'crypto';

/** Six-digit code for till-side entry (email → phone → type on shop PC). */
export function generatePasswordResetCode(): string {
  return String(crypto.randomInt(100_000, 1_000_000));
}
