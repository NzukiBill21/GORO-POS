import { securityService } from '../services/securityService.js';

let timer: ReturnType<typeof setInterval> | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldRunHostedBackups(): boolean {
  if (process.env.DESKTOP_MODE === 'true') return false;
  if (process.env.HOSTED_BACKUP_ENABLED === 'false') return false;
  if (process.env.HOSTED_BACKUP_ENABLED === 'true') return true;
  return process.env.SERVE_STATIC === 'true' && process.env.NODE_ENV === 'production';
}

async function runHostedBackup() {
  try {
    const result = await securityService.createServerWideBackup();
    console.log(`[hosted-backup] Created ${result.filename} (${result.size} bytes)`);
  } catch (err) {
    console.error('[hosted-backup] Failed:', err instanceof Error ? err.message : err);
  }
}

export function startHostedBackupScheduler() {
  if (!shouldRunHostedBackups()) return;

  const delayMs = parseInt(process.env.HOSTED_BACKUP_INITIAL_DELAY_MS ?? '300000', 10);
  console.log('[hosted-backup] Scheduled daily server-wide SQLite backups');

  setTimeout(() => void runHostedBackup(), delayMs);
  timer = setInterval(() => void runHostedBackup(), DAY_MS);
}

export function stopHostedBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
