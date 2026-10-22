import path from 'path';
import fs from 'fs';

/**
 * Resolves SQLite DATABASE_URL for dev vs packaged desktop.
 * Packaged Electron should set GOROVIAN_DATA_DIR to a folder outside OneDrive/install dir.
 */
export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL && !process.env.GOROVIAN_DATA_DIR) {
    return process.env.DATABASE_URL;
  }
  const dataDir =
    process.env.GOROVIAN_DATA_DIR ||
    path.join(process.cwd(), 'prisma');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbFile = path.join(dataDir, 'pos.db');
  const url = `file:${dbFile.replace(/\\/g, '/')}`;
  process.env.DATABASE_URL = url;
  return url;
}

/** Absolute path to the active SQLite file (dev `dev.db` or packaged `pos.db`). */
export function getSqliteFilePath(): string {
  const url = resolveDatabaseUrl();
  if (url.startsWith('file:')) {
    let p = url.slice('file:'.length);
    if (p.startsWith('//')) p = p.slice(2);
    if (!path.isAbsolute(p)) {
      // Prisma resolves relative SQLite paths from the schema directory (prisma/).
      p = path.join(process.cwd(), 'prisma', p.replace(/^\.\//, ''));
    }
    return path.normalize(p);
  }
  return path.join(process.cwd(), 'prisma', 'dev.db');
}

export function getBackupDirectory(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
}
