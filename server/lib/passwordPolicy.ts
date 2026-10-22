import zxcvbn from 'zxcvbn';

const MIN_LENGTH = 12;
const MIN_ZXCVBN_SCORE = 3;

/** Common weak passwords (breached-style blocklist subset). */
const BLOCKLIST = new Set(
  [
    'password123!',
    'admin123!@#',
    'qwerty123!@#',
    'imanshop123!',
    'demostore123!',
    'gorovian123!',
  ].map((s) => s.toLowerCase())
);

export function assessPassword(password: string, userInputs: string[] = []): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters`);
  }
  if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain a special character');

  if (BLOCKLIST.has(password.toLowerCase())) {
    errors.push('This password is too common and not allowed');
  }

  const result = zxcvbn(password, userInputs.filter(Boolean));
  if (result.score < MIN_ZXCVBN_SCORE) {
    errors.push('Password is too weak — use a longer unique passphrase');
  }

  return { valid: errors.length === 0, errors };
}
