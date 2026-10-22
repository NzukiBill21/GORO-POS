import { describe, it, expect, afterEach } from 'vitest';
import { resolveCorsOrigin, resolveCorsOrigins, resolveHelmetConnectSrc, API_PORT } from '../server/lib/listenHost.js';

describe('listenHost (one URL per mode)', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('desktop packaged UI uses API port only for CORS', () => {
    process.env.DESKTOP_MODE = 'true';
    process.env.SERVE_STATIC = 'true';
    delete process.env.CORS_ORIGIN;
    expect(resolveCorsOrigin()).toBe(`http://127.0.0.1:${API_PORT}`);
  });

  it('dev web uses Vite port only for CORS (not API port)', () => {
    delete process.env.DESKTOP_MODE;
    delete process.env.SERVE_STATIC;
    delete process.env.CORS_ORIGIN;
    expect(resolveCorsOrigin()).toBe('http://127.0.0.1:5173');
  });

  it('helmet connect-src is same-origin only (no mixed ports)', () => {
    expect(resolveHelmetConnectSrc()).toEqual(["'self'"]);
  });

  it('dev CORS allows localhost and 127.0.0.1 when env names only one', () => {
    delete process.env.DESKTOP_MODE;
    delete process.env.SERVE_STATIC;
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    const origins = resolveCorsOrigins();
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://127.0.0.1:5173');
  });
});
