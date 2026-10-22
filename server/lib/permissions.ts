import { prisma } from './prisma.js';
import { ROLE_PERMISSION_MAP, PLATFORM_ADMIN_PERMISSIONS, permissionMatches } from './permissionRegistry.js';

const ROLE_ALIASES: Record<string, string> = {
  owner: 'manager',
  admin: 'manager',
  administrator: 'manager',
  manager: 'manager',
  cashier: 'cashier',
  supervisor: 'supervisor',
};

const permissionCache = new Map<string, { perms: string[]; expires: number }>();
const CACHE_TTL = 60_000;

export function normalizeRole(role: string): string {
  const key = role.toLowerCase();
  return ROLE_ALIASES[key] || key;
}

export async function getPermissionsForRole(roleName: string): Promise<string[]> {
  const normalized = normalizeRole(roleName);
  const cached = permissionCache.get(`role:${normalized}`);
  if (cached && cached.expires > Date.now()) return cached.perms;

  try {
    const role = await prisma.role.findUnique({
      where: { name: normalized },
      include: { permissions: { include: { permission: true } } },
    });

    if (role && role.permissions.length > 0) {
      const perms = role.permissions.map((rp) => rp.permission.name);
      permissionCache.set(`role:${normalized}`, { perms, expires: Date.now() + CACHE_TTL });
      return perms;
    }
  } catch {
    // fall through
  }

  const perms = ROLE_PERMISSION_MAP[normalized] || ROLE_PERMISSION_MAP.cashier;
  permissionCache.set(`role:${normalized}`, { perms, expires: Date.now() + CACHE_TTL });
  return perms;
}

/** Role permissions + user-specific grants (Supervisor billing.view etc.) */
export async function getPermissionsForUser(userId: string, roleName: string): Promise<string[]> {
  const cacheKey = `user:${userId}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.perms;

  const rolePerms = await getPermissionsForRole(roleName);
  const grants = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: true },
  });
  const grantNames = grants.map((g) => g.permission.name);
  const merged = [...new Set([...rolePerms, ...grantNames])];

  permissionCache.set(cacheKey, { perms: merged, expires: Date.now() + CACHE_TTL });
  return merged;
}

export function getPlatformPermissions(): string[] {
  return [...PLATFORM_ADMIN_PERMISSIONS];
}

export function hasPermission(role: string, permission: string, permissions?: string[]): boolean {
  const perms = permissions || ROLE_PERMISSION_MAP[normalizeRole(role)] || [];
  return permissionMatches(perms, permission);
}

export function clearPermissionCache(userId?: string) {
  if (userId) {
    for (const key of permissionCache.keys()) {
      if (key === `user:${userId}` || key.startsWith('role:')) permissionCache.delete(key);
    }
  } else {
    permissionCache.clear();
  }
}

export const MANAGER_ROLES = ['manager', 'supervisor', 'owner', 'admin', 'administrator'];

export function requiresManagerApproval(role: string): boolean {
  return !MANAGER_ROLES.includes(normalizeRole(role));
}
