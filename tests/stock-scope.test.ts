import { describe, it, expect } from 'vitest';
import { stockAvailabilityWhere } from '../server/lib/stockScope.js';

describe('stockAvailabilityWhere', () => {
  it('includes null branch rows when branch is set', () => {
    const where = stockAvailabilityWhere({
      productId: 'p1',
      branchId: 'b1',
    });
    expect(where).toEqual({
      productId: 'p1',
      OR: [{ branchId: 'b1' }, { branchId: null }],
    });
  });

  it('scopes variant when provided', () => {
    const where = stockAvailabilityWhere({
      productId: 'p1',
      variantId: 'v1',
      branchId: 'b1',
    });
    expect(where.variantId).toBe('v1');
  });
});
