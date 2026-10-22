import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveDatabaseUrl, getSqliteFilePath } from '../server/lib/databasePath.js';

describe('SQLite path resolution', () => {
  const prevDataDir = process.env.GOROVIAN_DATA_DIR;
  const prevDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (prevDataDir !== undefined) process.env.GOROVIAN_DATA_DIR = prevDataDir;
    else delete process.env.GOROVIAN_DATA_DIR;
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
    else delete process.env.DATABASE_URL;
  });

  it('uses pos.db under GOROVIAN_DATA_DIR for desktop layout', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goro-db-'));
    process.env.GOROVIAN_DATA_DIR = tmp;
    const url = resolveDatabaseUrl();
    expect(url).toContain('pos.db');
    expect(getSqliteFilePath()).toBe(path.join(tmp, 'pos.db'));
  });
});
