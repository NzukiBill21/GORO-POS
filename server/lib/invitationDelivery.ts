/** Safe invitation API payload — never includes tokens, codes, or magic links. */
export type InvitationDeliveryStatus = 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DEV_LOGGED';

export function buildInvitationDeliveryResponse(params: {
  inviteId: string;
  expiresAt: Date;
  status: InvitationDeliveryStatus;
  emailSentAt?: Date | null;
  emailDeliveryError?: string | null;
}) {
  const devHint =
    params.status === 'DEV_LOGGED'
      ? 'Development: invitation details were written to the server log (REGISTRATION_DEV_LOG=true). They are not shown in this UI.'
      : undefined;

  return {
    inviteId: params.inviteId,
    expiresAt: params.expiresAt,
    deliveryStatus: params.status,
    emailSentAt: params.emailSentAt ?? null,
    emailDeliveryError: params.emailDeliveryError ?? null,
    devHint,
  };
}

export function canLogInvitationSecretsInDev(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.REGISTRATION_DEV_LOG === 'true';
}
