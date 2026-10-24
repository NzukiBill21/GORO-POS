import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOP_IMPORT_TEST_DB = path.join(here, '..', '.tmp', 'shop-import.test.db');
const repoRoot = path.join(here, '..', '..');

let savedDatabaseUrl: string | undefined;

export async function resetShopImportTestDatabase(): Promise<void> {
  if (savedDatabaseUrl === undefined) {
    savedDatabaseUrl = process.env.DATABASE_URL;
  }
  fs.mkdirSync(path.dirname(SHOP_IMPORT_TEST_DB), { recursive: true });
  for (const f of [SHOP_IMPORT_TEST_DB, `${SHOP_IMPORT_TEST_DB}-wal`, `${SHOP_IMPORT_TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  process.env.DATABASE_URL = `file:${SHOP_IMPORT_TEST_DB.replace(/\\/g, '/')}`;

  const g = globalThis as { prisma?: { $disconnect: () => Promise<void> } };
  if (g.prisma) {
    await g.prisma.$disconnect().catch(() => {});
    delete g.prisma;
  }

  execSync('npx prisma db push --skip-generate', {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: 'pipe',
  });
}

export async function loadShopImportModules() {
  const { vi } = await import('vitest');
  vi.resetModules();
  const { prisma } = await import('../../server/lib/prisma.js');
  const shopImport = await import('../../server/services/shopImportService.js');
  const { productService } = await import('../../server/services/productService.js');
  const { findBarcodeOwner } = await import('../../server/lib/barcodeUnique.js');
  const { provisionBusinessWithOwner } = await import(
    '../../server/services/businessProvisioningService.js'
  );
  return { prisma, shopImport, productService, findBarcodeOwner, provisionBusinessWithOwner };
}

/** Restore dev DATABASE_URL after isolated shop-import tests (full vitest suite). */
export async function restoreDefaultTestDatabase(): Promise<void> {
  const g = globalThis as { prisma?: { $disconnect: () => Promise<void> } };
  if (g.prisma) {
    await g.prisma.$disconnect().catch(() => {});
    delete g.prisma;
  }
  if (savedDatabaseUrl !== undefined) {
    process.env.DATABASE_URL = savedDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
  const { vi } = await import('vitest');
  vi.resetModules();
  await import('../../server/lib/prisma.js');
}

export type ShopImportTestContext = Awaited<ReturnType<typeof seedShopImportTenant>>;

export async function seedShopImportTestCatalogue(
  prisma: Awaited<ReturnType<typeof loadShopImportModules>>['prisma']
) {
  const { seedPermissionsAndRoles, seedPlans } = await import('../../prisma/seedBilling.js');
  await seedPermissionsAndRoles(prisma);
  await seedPlans(prisma);
}

export async function seedShopImportTenant(
  prisma: Awaited<ReturnType<typeof loadShopImportModules>>['prisma']
) {
  await seedShopImportTestCatalogue(prisma);
  const { provisionBusinessWithOwner } = await import(
    '../../server/services/businessProvisioningService.js'
  );
  const { hashPasswordUnsafe } = await import('../../server/lib/password.js');

  const stamp = Date.now();
  const email = `shop-import-${stamp}@example.com`;
  const passwordHash = await hashPasswordUnsafe('ShopImportTest1!');

  const seeded = await prisma.$transaction(async (tx) =>
    provisionBusinessWithOwner(tx, {
      businessName: `Shop Import Test ${stamp}`,
      ownerEmail: email,
      ownerFirstName: 'Import',
      ownerLastName: 'Tester',
      ownerPasswordHash: passwordHash,
      emailVerified: true,
    })
  );

  const user = await prisma.user.findFirst({ where: { businessId: seeded.businessId } });
  const branch = await prisma.branch.findFirst({ where: { businessId: seeded.businessId } });
  const warehouse = await prisma.warehouse.findFirst({ where: { businessId: seeded.businessId } });
  if (!user || !branch || !warehouse) {
    throw new Error('Failed to seed shop import test tenant');
  }

  return {
    businessId: seeded.businessId,
    userId: user.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
  };
}
