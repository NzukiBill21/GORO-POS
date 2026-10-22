import argon2 from 'argon2';
import { AppError } from './errors.js';
import { assessPassword } from './passwordPolicy.js';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordComplexity(password: string, userInputs: string[] = []): PasswordValidationResult {
  return assessPassword(password, userInputs);
}

export async function hashPassword(password: string, userInputs: string[] = []): Promise<string> {
  const validation = validatePasswordComplexity(password, userInputs);
  if (!validation.valid) {
    throw new AppError(validation.errors.join('. '), 400);
  }
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function hashPasswordUnsafe(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function needsRehash(hash: string): Promise<boolean> {
  return argon2.needsRehash(hash, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
}
