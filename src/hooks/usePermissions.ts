import { useAuthStore } from '@/stores/authStore';
import { hasPermission } from '@/lib/permissions';

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? '';
  const permissions = user?.permissions;
  return {
    can: (permission: string) => hasPermission(role, permission, permissions),
    role,
    permissions: permissions ?? [],
  };
}
