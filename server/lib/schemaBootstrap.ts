import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getSqliteFilePath } from './databasePath.js';

const execFileAsync = promisify(execFile);

/** Ensure SQLite schema exists (desktop first run). Never seeds demo data. */
export async function ensureDatabaseSchema(projectRoot: string): Promise<void> {
  const dbPath = getSqliteFilePath();
  const marker = path.join(path.dirname(dbPath), '.schema-ready');
  if (fs.existsSync(marker) && fs.existsSync(dbPath)) return;

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(npx, ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
}
