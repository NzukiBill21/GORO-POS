import { AppError } from './errors.js';

/** MPESA_MOCK must never be enabled in production */
export function assertMpesaMockAllowed(): void {
  if (process.env.NODE_ENV === 'production' && process.env.MPESA_MOCK === 'true') {
    throw new AppError('MPESA_MOCK cannot be enabled in production', 500);
  }
}

export function isPosMpesaMockMode(): boolean {
  assertMpesaMockAllowed();
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.MPESA_MOCK === 'true';
}
