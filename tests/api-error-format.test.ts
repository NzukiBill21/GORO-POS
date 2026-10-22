import { describe, it, expect } from 'vitest';
import { formatApiErrorBody } from '../src/lib/apiError.js';

describe('formatApiErrorBody', () => {
  it('prefers error string', () => {
    expect(formatApiErrorBody({ error: 'No rows to import' }, 400)).toBe('No rows to import');
  });

  it('expands zod validation details', () => {
    expect(
      formatApiErrorBody(
        { error: 'Validation failed', details: [{ path: 'code', message: 'Invitation code must be exactly 6 digits' }] },
        400
      )
    ).toContain('6 digits');
  });

  it('includes first row validation error', () => {
    expect(
      formatApiErrorBody(
        {
          message: 'Validation failed',
          errors: [{ rowNumber: 3, message: 'Duplicate barcode' }],
        },
        400
      )
    ).toContain('row 3');
  });
});
