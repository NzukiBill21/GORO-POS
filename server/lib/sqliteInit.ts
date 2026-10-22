import { prisma } from './prisma.js';

export async function applySqlitePragmas(): Promise<void> {
  // PRAGMA journal_mode returns a row — must use queryRaw, not executeRaw (Prisma/SQLite).
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await prisma.$queryRawUnsafe('PRAGMA synchronous=FULL');
}

export async function runSqliteIntegrityCheck(): Promise<{ ok: boolean; detail: string }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
  const detail = rows[0]?.integrity_check ?? 'unknown';
  return { ok: detail === 'ok', detail };
}
