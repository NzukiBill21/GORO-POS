import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('relay auth helpers', () => {
  it('signs cursor for relay GET', () => {
    const cursor = '0';
    const sig = crypto.createHmac('sha256', 'test-token').update(cursor).digest('hex');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});
