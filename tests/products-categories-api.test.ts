import { describe, it, expect } from 'vitest';
import { prisma } from '../server/lib/prisma.js';
import { productService } from '../server/services/productService.js';

describe('products and categories API data layer', () => {
  it('lists products with whitelisted sort fields', async () => {
    const result = await productService.list('demo-business', {
      page: 1,
      limit: 5,
      sortBy: 'sellingPrice',
      sortOrder: 'asc',
    });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.pagination.total).toBeGreaterThan(0);
  });

  it('falls back safely for invalid product sortBy', async () => {
    await expect(
      productService.list('demo-business', {
        page: 1,
        limit: 5,
        sortBy: 'DROP TABLE',
        sortOrder: 'asc',
      })
    ).resolves.toMatchObject({ data: expect.any(Array) });
  });

  it('loads category tree for tenant', async () => {
    const businessId = 'demo-business';
    const categories = await prisma.category.findMany({
      where: { businessId, isActive: true, parentId: null },
      include: {
        _count: { select: { products: true } },
        children: {
          where: { isActive: true },
          include: { _count: { select: { products: true } } },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    expect(Array.isArray(categories)).toBe(true);
  });
});
