import { prisma } from './prisma.js';

const cache = new Map<string, { value: string | null; expires: number }>();
const TTL_MS = 30_000;

export async function getBusinessSetting(businessId: string, key: string): Promise<string | null> {
  const cacheKey = `${businessId}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const row = await prisma.settings.findUnique({
    where: { businessId_key: { businessId, key } },
  });
  const value = row?.value ?? null;
  cache.set(cacheKey, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function clearBusinessSettingsCache(businessId?: string) {
  if (!businessId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${businessId}:`)) cache.delete(key);
  }
}

export async function allowsNegativeStock(businessId: string): Promise<boolean> {
  const v = await getBusinessSetting(businessId, 'inventory.allowNegativeStock');
  return v === 'true' || v === '1';
}
