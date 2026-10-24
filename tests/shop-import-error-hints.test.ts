import { describe, it, expect } from 'vitest';
import { shopImportFixHint } from '../src/lib/shopImportErrorHints.js';

describe('shopImportFixHint', () => {
  it('maps common product validation messages', () => {
    expect(shopImportFixHint('Product name is required', 'products')).toMatch(/Product name/i);
    expect(shopImportFixHint('Barcode already exists in catalogue', 'products')).toMatch(
      /Create and update/i
    );
  });

  it('maps opening stock messages', () => {
    expect(
      shopImportFixHint('No matching product/variant — import products first', 'opening-stock')
    ).toMatch(/PRODUCTS/i);
  });
});
