import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AppError } from './errors.js';

const MAGIC = Buffer.from('GOROBAK1', 'ascii');
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + IV_LEN + TAG_LEN;

function deriveBackupKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    if (process.env.NODE_ENV === 'production' && process.env.DESKTOP_MODE === 'true') {
      throw new AppError('ENCRYPTION_KEY must be set for encrypted desktop backups', 500);
    }
    return crypto.scryptSync('dev-encryption-key-change-me!!', 'pos-backup-salt', 32);
  }
  return crypto.scryptSync(key, 'pos-backup-salt', 32);
}

/** Desktop till: encrypt at rest by default; override with BACKUP_ENCRYPT=true|false. */
export function shouldEncryptLocalBackups(): boolean {
  if (process.env.BACKUP_ENCRYPT === 'false') return false;
  if (process.env.BACKUP_ENCRYPT === 'true') return true;
  return process.env.DESKTOP_MODE === 'true';
}

export function isEncryptedBackupFile(filepath: string): boolean {
  return filepath.endsWith('.gbak');
}

export function plaintextChecksum(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

export function encryptBackupFile(plainPath: string, outPath: string): void {
  const plain = fs.readFileSync(plainPath);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveBackupKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext]);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, payload);
}

export function decryptBackupFile(encPath: string, plainPath: string): void {
  const data = fs.readFileSync(encPath);
  if (data.length < HEADER_LEN || data.subarray(0, MAGIC.length).compare(MAGIC) !== 0) {
    throw new AppError('Not a Goro encrypted backup file', 400);
  }
  const version = data[MAGIC.length];
  if (version !== VERSION) {
    throw new AppError(`Unsupported backup format version ${version}`, 400);
  }
  const iv = data.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_LEN);
  const tag = data.subarray(MAGIC.length + 1 + IV_LEN, HEADER_LEN);
  const ciphertext = data.subarray(HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveBackupKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(plainPath, plain);
}

/** Decrypt `.gbak` to a temp SQLite file for restore/verify; plain `.db` passes through. */
export function materializePlainBackup(filepath: string): { path: string; cleanup: () => void } {
  if (!isEncryptedBackupFile(filepath)) {
    return { path: filepath, cleanup: () => undefined };
  }
  const tempPath = path.join(
    path.dirname(filepath),
    `.restore-plain-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  decryptBackupFile(filepath, tempPath);
  return {
    path: tempPath,
    cleanup: () => {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    },
  };
}
