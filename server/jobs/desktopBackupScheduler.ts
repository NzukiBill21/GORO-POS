import { prisma } from '../lib/prisma.js';
import { securityService } from '../services/securityService.js';

let timer: ReturnType<typeof setInterval> | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;

async function runDailyBackups() {
  try {
    const businesses = await prisma.business.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const b of businesses) {
      await securityService.createBackup(b.id, 'DAILY');
    }
    if (businesses.length > 0) {
      console.log(`[desktop-backup] Created daily backup for ${businesses.length} business(es)`);
    }
  } catch (err) {
    console.error('[desktop-backup] Failed:', err instanceof Error ? err.message : err);
  }
}

export function startDesktopBackupScheduler() {
  if (process.env.DESKTOP_MODE !== 'true') return;
  if (process.env.DESKTOP_BACKUP_ENABLED === 'false') return;

  const delayMs = parseInt(process.env.DESKTOP_BACKUP_INITIAL_DELAY_MS ?? '120000', 10);
  console.log('[desktop-backup] Scheduled daily backups (local desktop mode)');

  setTimeout(() => void runDailyBackups(), delayMs);
  timer = setInterval(() => void runDailyBackups(), DAY_MS);
}

export function stopDesktopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
