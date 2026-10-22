/**
 * Manual server-wide SQLite backup (hosted / multi-tenant).
 * Usage: npx tsx scripts/server-backup.ts
 */
import { prisma } from '../server/lib/prisma.js';
import { securityService } from '../server/services/securityService.js';

async function main() {
  const result = await securityService.createServerWideBackup();
  console.log('Server backup created:');
  console.log('  file:', result.filepath);
  console.log('  size:', result.size);
  console.log('  checksum:', result.checksum);
  console.log('');
  console.log('Verify (optional): npm run backup:decrypt -- <file>  then inspect with sqlite3');
  console.log('Restore: stop API, replace DATABASE_URL file from decrypted backup, restart (maintenance window only).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
