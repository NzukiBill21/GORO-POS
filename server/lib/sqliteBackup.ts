import fs from 'fs';
import path from 'path';
import { prisma } from './prisma.js';
import { getSqliteFilePath } from './databasePath.js';

function sqlEscapePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "''");
}

/** Consistent SQLite backup (WAL-safe) via VACUUM INTO. */
export async function backupSqliteDatabase(destinationPath: string): Promise<void> {
  const dir = path.dirname(destinationPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);

  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL)');
  const dest = sqlEscapePath(path.resolve(destinationPath));
  await prisma.$executeRawUnsafe(`VACUUM INTO '${dest}'`);
}

export function resolveLiveDatabasePath(): string {
  return getSqliteFilePath();
}
