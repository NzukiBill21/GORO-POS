import { AppError } from './errors.js';
import { assertPosStkDarajaAmount } from './mpesaAmount.js';

/** Validate POS payment units before reserving balance or calling Daraja. */
export function requirePosStkDarajaKes(posAmountUnits: number): number {
  try {
    return assertPosStkDarajaAmount(posAmountUnits);
  } catch {
    throw new AppError(
      'This sale amount is too small for M-Pesa STK (minimum 1 KES). Use cash or increase the sale total.',
      400
    );
  }
}
