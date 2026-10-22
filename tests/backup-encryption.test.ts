import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  decryptBackupFile,
  encryptBackupFile,
  isEncryptedBackupFile,
  materializePlainBackup,
  plaintextChecksum,
  shouldEncryptLocalBackups,
} from '../server/lib/backupEncryption.js';

describe('backup encryption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goro-backup-test-'));
  const plain = path.join(dir, 'sample.db');
  const enc = path.join(dir, 'sample.gbak');

  beforeAll(() => {
    fs.writeFileSync(plain, Buffer.from('SQLite format 3\x00fake-backup-bytes'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encrypts and decrypts round-trip', () => {
    const checksum = plaintextChecksum(plain);
    encryptBackupFile(plain, enc);
    expect(isEncryptedBackupFile(enc)).toBe(true);
    expect(fs.readFileSync(enc).subarray(0, 8).toString()).toBe('GOROBAK1');

    const out = path.join(dir, 'restored.db');
    decryptBackupFile(enc, out);
    expect(plaintextChecksum(out)).toBe(checksum);
  });

  it('materializePlainBackup decrypts .gbak', () => {
    const { path: materialized, cleanup } = materializePlainBackup(enc);
    try {
      expect(fs.existsSync(materialized)).toBe(true);
      expect(plaintextChecksum(materialized)).toBe(plaintextChecksum(plain));
    } finally {
      cleanup();
    }
  });

  it('defaults encryption off outside desktop mode', () => {
    const prevDesktop = process.env.DESKTOP_MODE;
    const prevFlag = process.env.BACKUP_ENCRYPT;
    delete process.env.DESKTOP_MODE;
    delete process.env.BACKUP_ENCRYPT;
    expect(shouldEncryptLocalBackups()).toBe(false);
    process.env.DESKTOP_MODE = 'true';
    expect(shouldEncryptLocalBackups()).toBe(true);
    process.env.BACKUP_ENCRYPT = 'false';
    expect(shouldEncryptLocalBackups()).toBe(false);
    if (prevDesktop !== undefined) process.env.DESKTOP_MODE = prevDesktop;
    else delete process.env.DESKTOP_MODE;
    if (prevFlag !== undefined) process.env.BACKUP_ENCRYPT = prevFlag;
    else delete process.env.BACKUP_ENCRYPT;
  });
});
