import crypto from 'crypto';
import fs from 'fs';
import { AppError } from '../lib/errors.js';

/** Optional encrypted cloud upload when CLOUD_BACKUP_URL + CLOUD_BACKUP_KEY are set in Settings/env. */
export async function uploadEncryptedBackup(filepath: string, businessId: string): Promise<{ uploaded: boolean; reason?: string }> {
  const url = process.env.CLOUD_BACKUP_URL;
  const key = process.env.CLOUD_BACKUP_KEY;
  if (!url || !key) {
    return { uploaded: false, reason: 'Cloud backup not configured' };
  }

  const plain = fs.readFileSync(filepath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Business-Id': businessId,
      'X-Backup-Checksum': crypto.createHash('sha256').update(plain).digest('hex'),
      Authorization: `Bearer ${key}`,
    },
    body: encrypted,
  });

  if (!res.ok) {
    throw new AppError(`Cloud backup upload failed (${res.status})`, 502);
  }
  return { uploaded: true };
}
