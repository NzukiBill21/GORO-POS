import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import { prisma } from '../server/lib/prisma.js';
import { securityService } from '../server/services/securityService.js';
import { getBackupDirectory } from '../server/lib/databasePath.js';
import { shouldRunHostedBackups } from '../server/jobs/hostedBackupScheduler.js';

describe('hosted backups and restore guard', () => {
  const prevDesktop = process.env.DESKTOP_MODE;

  afterEach(() => {
    if (prevDesktop === undefined) delete process.env.DESKTOP_MODE;
    else process.env.DESKTOP_MODE = prevDesktop;
  });

  it('blocks in-app restore when not in desktop till mode', async () => {
    delete process.env.DESKTOP_MODE;
    const business = await prisma.business.findFirst({ where: { status: 'ACTIVE' } });
    expect(business).toBeTruthy();
    const backup = await prisma.backup.findFirst({ where: { businessId: business!.id } });
    const fakeReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as import('express').Request;
    const user = await prisma.user.findFirst({ where: { businessId: business!.id } });
    if (!backup || !user) return;
    await expect(
      securityService.restoreBackup(backup.id, business!.id, user.id, fakeReq)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('creates a server-wide backup file', async () => {
    const result = await securityService.createServerWideBackup();
    expect(fs.existsSync(result.filepath)).toBe(true);
    expect(result.filename).toMatch(/^server-wide-/);
    expect(result.size).toBeGreaterThan(0);
    const dir = getBackupDirectory();
    const onDisk = fs.readdirSync(dir).filter((f) => f.startsWith('server-wide-'));
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('enables hosted scheduler when SERVE_STATIC production and not desktop', () => {
    delete process.env.DESKTOP_MODE;
    delete process.env.HOSTED_BACKUP_ENABLED;
    const prevNode = process.env.NODE_ENV;
    const prevServe = process.env.SERVE_STATIC;
    process.env.NODE_ENV = 'production';
    process.env.SERVE_STATIC = 'true';
    expect(shouldRunHostedBackups()).toBe(true);
    process.env.HOSTED_BACKUP_ENABLED = 'false';
    expect(shouldRunHostedBackups()).toBe(false);
    process.env.NODE_ENV = prevNode;
    process.env.SERVE_STATIC = prevServe;
    delete process.env.HOSTED_BACKUP_ENABLED;
  });
});
