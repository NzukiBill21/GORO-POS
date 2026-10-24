/** When true, platform may create tenant owners with a temp password (no email invite). */
export function isLocalTenantProvisioningEnabled(): boolean {
  return (
    process.env.ALLOW_LOCAL_TENANT_PROVISION === 'true' || process.env.DESKTOP_MODE === 'true'
  );
}
