import { prisma } from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export type PosPaymentMethodKey = 'cash' | 'mpesa_stk' | 'mpesa_manual' | 'card' | 'split';

export interface EnabledMethods {
  cash: boolean;
  mpesa_stk: boolean;
  mpesa_manual: boolean;
  card: boolean;
  split: boolean;
}

const DEFAULT_METHODS: EnabledMethods = {
  cash: true,
  mpesa_stk: true,
  mpesa_manual: true,
  card: true,
  split: true,
};

export interface PublicPaymentConfig {
  enabledMethods: EnabledMethods;
  mpesaCallbackUrl: string | null;
  mpesaTillConfigured: boolean;
  mpesaStkConfigured: boolean;
  manualApprovalThresholdCents: number;
  defaultTillFloatCents: number;
}

export interface SavePaymentConfigInput {
  enabledMethods?: EnabledMethods;
  mpesaShortcode?: string;
  mpesaTill?: string;
  mpesaConsumerKey?: string;
  mpesaConsumerSecret?: string;
  mpesaPasskey?: string;
  mpesaCallbackUrl?: string;
  manualApprovalThresholdCents?: number;
  defaultTillFloatCents?: number;
}

function parseMethods(json: string): EnabledMethods {
  try {
    return { ...DEFAULT_METHODS, ...JSON.parse(json) };
  } catch {
    return DEFAULT_METHODS;
  }
}

export async function getPublicPaymentConfig(businessId: string): Promise<PublicPaymentConfig> {
  const row = await prisma.tenantPosPaymentConfig.findUnique({ where: { businessId } });
  if (!row) {
    return {
      enabledMethods: DEFAULT_METHODS,
      mpesaCallbackUrl: null,
      mpesaTillConfigured: false,
      mpesaStkConfigured: false,
      manualApprovalThresholdCents: 50000,
      defaultTillFloatCents: 500000,
    };
  }
  return {
    enabledMethods: parseMethods(row.enabledMethodsJson),
    mpesaCallbackUrl: row.mpesaCallbackUrl,
    mpesaTillConfigured: !!row.mpesaTillEncrypted,
    mpesaStkConfigured: !!(row.mpesaConsumerKeyEncrypted && row.mpesaPasskeyEncrypted),
    manualApprovalThresholdCents: row.manualApprovalThresholdCents,
    defaultTillFloatCents: row.defaultTillFloatCents,
  };
}

/** Decrypted Daraja credentials — server-only, never expose via API */
export async function getTenantMpesaCredentials(businessId: string) {
  const row = await prisma.tenantPosPaymentConfig.findUnique({ where: { businessId } });
  if (!row) return null;
  return {
    shortcode: row.mpesaShortcodeEncrypted ? decrypt(row.mpesaShortcodeEncrypted) : '',
    till: row.mpesaTillEncrypted ? decrypt(row.mpesaTillEncrypted) : '',
    consumerKey: row.mpesaConsumerKeyEncrypted ? decrypt(row.mpesaConsumerKeyEncrypted) : '',
    consumerSecret: row.mpesaConsumerSecretEncrypted ? decrypt(row.mpesaConsumerSecretEncrypted) : '',
    passkey: row.mpesaPasskeyEncrypted ? decrypt(row.mpesaPasskeyEncrypted) : '',
    /** Only when explicitly saved in Settings; otherwise Daraja config uses env / relay. */
    callbackUrl: row.mpesaCallbackUrl?.trim() || undefined,
  };
}

export async function savePaymentConfig(businessId: string, input: SavePaymentConfigInput) {
  const data: Record<string, unknown> = {};
  if (input.enabledMethods) data.enabledMethodsJson = JSON.stringify(input.enabledMethods);
  if (input.mpesaShortcode !== undefined) {
    data.mpesaShortcodeEncrypted = input.mpesaShortcode ? encrypt(input.mpesaShortcode) : null;
  }
  if (input.mpesaTill !== undefined) {
    data.mpesaTillEncrypted = input.mpesaTill ? encrypt(input.mpesaTill) : null;
  }
  if (input.mpesaConsumerKey !== undefined) {
    data.mpesaConsumerKeyEncrypted = input.mpesaConsumerKey ? encrypt(input.mpesaConsumerKey) : null;
  }
  if (input.mpesaConsumerSecret !== undefined) {
    data.mpesaConsumerSecretEncrypted = input.mpesaConsumerSecret ? encrypt(input.mpesaConsumerSecret) : null;
  }
  if (input.mpesaPasskey !== undefined) {
    data.mpesaPasskeyEncrypted = input.mpesaPasskey ? encrypt(input.mpesaPasskey) : null;
  }
  if (input.mpesaCallbackUrl !== undefined) data.mpesaCallbackUrl = input.mpesaCallbackUrl || null;
  if (input.manualApprovalThresholdCents !== undefined) {
    data.manualApprovalThresholdCents = input.manualApprovalThresholdCents;
  }
  if (input.defaultTillFloatCents !== undefined) data.defaultTillFloatCents = input.defaultTillFloatCents;

  await prisma.tenantPosPaymentConfig.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
  });

  return getPublicPaymentConfig(businessId);
}

export async function requireMethodEnabled(businessId: string, method: PosPaymentMethodKey) {
  const cfg = await getPublicPaymentConfig(businessId);
  if (!cfg.enabledMethods[method]) {
    throw new AppError(`Payment method ${method} is disabled for this store`, 403);
  }
}
