import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { AppError } from './errors.js';

const RESET_CODE_MINUTES = 15;

let transporter: Mail | null | undefined;

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function getTransporter(): Mail {
  if (transporter !== undefined && transporter !== null) return transporter;

  if (!isSmtpConfigured()) {
    throw new AppError(
      'Password recovery email is not configured on this till. Contact your manager or Gorovian support.',
      503
    );
  }

  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!.trim(),
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

/** Clear cached transporter (tests). */
export function resetMailTransportCache() {
  transporter = undefined;
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured()) {
    return { ok: false, error: 'SMTP_USER and SMTP_PASS are not set' };
  }
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function mailFrom(): string {
  return (process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim())!;
}

export interface PasswordResetEmailParams {
  to: string;
  firstName: string;
  code: string;
  resetUrl?: string;
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const transport = getTransporter();
  const from = mailFrom();
  const appName = process.env.MAIL_APP_NAME?.trim() || 'Goro POS';

  const lines = [
    `Hello ${params.firstName},`,
    '',
    `We received a request to reset your ${appName} password.`,
    '',
    `Your verification code (valid ${RESET_CODE_MINUTES} minutes):`,
    '',
    `    ${params.code}`,
    '',
    'On the shop computer, open the login screen → Forgot password → enter this code with your new password.',
    'Do not share this code with anyone.',
  ];

  if (params.resetUrl) {
    lines.push('', 'If you are on a device that can open your hosted app, you may also use this link:', params.resetUrl);
  }

  lines.push('', 'If you did not request this, you can ignore this email.', '', `— ${appName}`);

  try {
    await transport.sendMail({
      from,
      to: params.to,
      subject: `${appName} password reset code`,
      text: lines.join('\n'),
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    const msg = err instanceof Error ? err.message : String(err);
    const offline =
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      /network|timeout|connect/i.test(msg);

    if (offline) {
      throw new AppError(
        'Password recovery email is temporarily unavailable (no internet or mail server unreachable). Try again when online.',
        503
      );
    }
    throw new AppError('Could not send password recovery email. Try again later or contact support.', 503);
  }
}

export const PASSWORD_RESET_EXPIRY_MINUTES = RESET_CODE_MINUTES;

export async function sendBusinessRegistrationEmail(params: {
  to: string;
  firstName: string;
  businessName: string;
  code: string;
  verifyUrl?: string;
}): Promise<void> {
  const transport = getTransporter();
  const from = mailFrom();
  const appName = process.env.MAIL_APP_NAME?.trim() || 'Goro POS';

  const lines = [
    `Hello ${params.firstName},`,
    '',
    `Thanks for registering ${params.businessName} on ${appName}.`,
    '',
    `Your email verification code (valid ${RESET_CODE_MINUTES} minutes):`,
    '',
    `    ${params.code}`,
    '',
    'Enter this code on the registration page to create your shop account.',
    'This does not charge you or activate a paid subscription — it only verifies your email.',
  ];
  if (params.verifyUrl) {
    lines.push('', 'You can also open this link on your device:', params.verifyUrl);
  }
  lines.push('', `— ${appName}`);

  await transport.sendMail({
    from,
    to: params.to,
    subject: `${appName} — verify your email`,
    text: lines.join('\n'),
  });
}

export async function sendAccountInvitationEmail(params: {
  to: string;
  firstName: string;
  businessName: string;
  inviteType: 'OWNER_SETUP' | 'EMPLOYEE';
  code: string;
  inviteUrl?: string;
}): Promise<void> {
  const transport = getTransporter();
  const from = mailFrom();
  const appName = process.env.MAIL_APP_NAME?.trim() || 'Goro POS';
  const roleLabel = params.inviteType === 'OWNER_SETUP' ? 'shop owner' : 'team member';

  const lines = [
    `Hello ${params.firstName},`,
    '',
    `You have been invited to join ${params.businessName} on ${appName} as a ${roleLabel}.`,
    '',
    `Set your password using this code (valid ${RESET_CODE_MINUTES} minutes):`,
    '',
    `    ${params.code}`,
    '',
    'Open the invitation link from your browser, enter the code, and choose a secure password.',
    'Do not share this code.',
  ];
  if (params.inviteUrl) {
    lines.push('', 'Invitation link:', params.inviteUrl);
  }
  lines.push('', `— ${appName}`);

  await transport.sendMail({
    from,
    to: params.to,
    subject: `${appName} — set up your account`,
    text: lines.join('\n'),
  });
}
