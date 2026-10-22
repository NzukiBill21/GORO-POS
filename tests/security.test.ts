import { describe, it, expect } from 'vitest';
import { safeOrderBy } from '../server/lib/tenant.ts';
import { hasPermission, normalizeRole } from '../server/lib/permissions.ts';
import { parsePagination, paginateResult } from '../server/lib/pagination.ts';
import { validatePasswordComplexity } from '../server/lib/password.ts';

describe('safeOrderBy', () => {
  it('whitelists valid sort fields', () => {
    expect(safeOrderBy('sale', 'total', 'desc')).toEqual({ total: 'desc' });
  });

  it('falls back for invalid sort fields', () => {
    expect(safeOrderBy('sale', 'DROP TABLE', 'asc')).toEqual({ createdAt: 'asc' });
  });
});

describe('RBAC permissions', () => {
  it('normalizes role aliases to manager', () => {
    expect(normalizeRole('Admin')).toBe('manager');
    expect(normalizeRole('owner')).toBe('manager');
  });

  it('grants billing to manager', () => {
    expect(hasPermission('manager', 'billing.view')).toBe(true);
  });

  it('denies cashier billing access', () => {
    expect(hasPermission('cashier', 'billing.view')).toBe(false);
  });

  it('denies cashier financials access', () => {
    expect(hasPermission('cashier', 'financials.view')).toBe(false);
  });
});

describe('pagination', () => {
  it('parses query params safely', () => {
    expect(parsePagination({ page: '2', limit: '50', sortOrder: 'desc' })).toEqual({
      page: 2,
      limit: 50,
      search: undefined,
      sortBy: undefined,
      sortOrder: 'desc',
    });
  });

  it('caps limit at 100', () => {
    expect(parsePagination({ limit: '500' }).limit).toBe(100);
  });

  it('paginates results', () => {
    const result = paginateResult([1, 2], 10, 1, 2);
    expect(result.pagination.totalPages).toBe(5);
    expect(result.data).toHaveLength(2);
  });
});

describe('password complexity', () => {
  it('rejects weak passwords', () => {
    const r = validatePasswordComplexity('password');
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('accepts strong passwords', () => {
    expect(validatePasswordComplexity('DemostoreAdmin1!').valid).toBe(true);
  });
});

describe('sanitizePrintHtml', () => {
  it('strips script tags', async () => {
    const { sanitizePrintHtml } = await import('../server/lib/sanitize.ts');
    const out = sanitizePrintHtml('<div>OK</div><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('OK');
  });
});
