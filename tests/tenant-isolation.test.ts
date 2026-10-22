import { describe, it, expect } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { productService } from '../server/services/productService.js';
import { provisionBusinessWithOwner } from '../server/services/businessProvisioningService.js';
import { hashPasswordUnsafe } from '../server/lib/password.js';
import { generateSecureToken } from '../server/lib/crypto.js';

describe('tenant data isolation', () => {
  it('product in tenant A is not readable via tenant B product APIs', async () => {
    const placeholderHash = await hashPasswordUnsafe(generateSecureToken(32));
    const suffix = Date.now();

    const [tenantA, tenantB] = await prisma.$transaction(async (tx) => {
      const a = await provisionBusinessWithOwner(tx, {
        businessName: `Isolation A ${suffix}`,
        ownerEmail: `iso-a-${suffix}@example.com`,
        ownerFirstName: 'A',
        ownerLastName: 'Owner',
        ownerPasswordHash: placeholderHash,
        mustSetPassword: false,
        emailVerified: true,
      });
      const b = await provisionBusinessWithOwner(tx, {
        businessName: `Isolation B ${suffix}`,
        ownerEmail: `iso-b-${suffix}@example.com`,
        ownerFirstName: 'B',
        ownerLastName: 'Owner',
        ownerPasswordHash: placeholderHash,
        mustSetPassword: false,
        emailVerified: true,
      });
      return [a, b];
    });

    const product = await prisma.product.create({
      data: {
        businessId: tenantA.businessId,
        name: `Secret SKU ${suffix}`,
        sku: `ISO-A-${suffix}`,
        sellingPrice: 100,
        costPrice: 50,
        isActive: true,
      },
    });

    const visibleInA = await productService.getById(product.id, tenantA.businessId);
    expect(visibleInA.name).toContain('Secret SKU');

    await expect(productService.getById(product.id, tenantB.businessId)).rejects.toMatchObject({
      statusCode: 404,
    });

    const listB = await productService.list(tenantB.businessId, { page: 1, limit: 100 });
    expect(listB.data.some((p) => p.id === product.id)).toBe(false);

    await prisma.business.delete({ where: { id: tenantA.businessId } });
    await prisma.business.delete({ where: { id: tenantB.businessId } });
  });
});
