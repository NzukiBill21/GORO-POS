export function isPublicRegistrationEnabled(): boolean {
  if (process.env.PUBLIC_REGISTRATION_ENABLED === 'false') return false;
  if (process.env.PUBLIC_REGISTRATION_ENABLED === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export function inviteBaseUrl(): string | undefined {
  const base =
    process.env.INVITE_BASE_URL?.trim().replace(/\/$/, '') ||
    process.env.PASSWORD_RESET_BASE_URL?.trim().replace(/\/$/, '');
  return base || undefined;
}
