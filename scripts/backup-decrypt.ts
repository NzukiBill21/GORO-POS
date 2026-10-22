/**
 * Decrypt a Goro `.gbak` file to a plain SQLite `.db` (disaster recovery / support).
 * Requires the same ENCRYPTION_KEY as the till that created the backup.
 *
 * Usage: npx tsx scripts/backup-decrypt.ts path/to/backup.gbak path/to/out.db
 */
import fs from 'fs';
import { decryptBackupFile, isEncryptedBackupFile } from '../server/lib/backupEncryption.js';

const [encPath, outPath] = process.argv.slice(2);
if (!encPath || !outPath) {
  console.error('Usage: tsx scripts/backup-decrypt.ts <input.gbak> <output.db>');
  process.exit(1);
}
if (!fs.existsSync(encPath)) {
  console.error('Input file not found:', encPath);
  process.exit(1);
}
if (!isEncryptedBackupFile(encPath)) {
  console.error('Input must be a .gbak encrypted backup');
  process.exit(1);
}

decryptBackupFile(encPath, outPath);
console.log('Wrote', outPath);
