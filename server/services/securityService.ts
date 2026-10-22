import fs from 'fs';

import path from 'path';

import { prisma } from '../lib/prisma.js';

import { writeAuditLog, extractRequestMeta } from '../lib/audit.js';

import { AppError } from '../lib/errors.js';

import { getBusinessUserIds } from '../lib/tenant.js';

import { inventoryService } from './inventoryService.js';

import type { Request } from 'express';



import { getBackupDirectory, getSqliteFilePath } from '../lib/databasePath.js';
import { backupSqliteDatabase } from '../lib/sqliteBackup.js';
import {
  encryptBackupFile,
  materializePlainBackup,
  plaintextChecksum,
  shouldEncryptLocalBackups,
} from '../lib/backupEncryption.js';

const BACKUP_DIR = getBackupDirectory();



function ensureBackupDir() {

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

}



export class SecurityService {

  async getAuditLogs(businessId: string, params: { page?: number; limit?: number; module?: string; userId?: string }) {

    const { page = 1, limit = 50, module, userId } = params;

    const skip = (page - 1) * limit;

    const businessUserIds = await getBusinessUserIds(businessId);



    const where = {

      userId: userId && businessUserIds.includes(userId) ? userId : { in: businessUserIds },

      ...(module && { module }),

    };



    const [logs, total] = await Promise.all([

      prisma.auditLog.findMany({

        where,

        include: { user: { select: { firstName: true, lastName: true, email: true } } },

        orderBy: { createdAt: 'desc' },

        skip,

        take: limit,

      }),

      prisma.auditLog.count({ where }),

    ]);



    return { data: logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };

  }



  async getLoginHistory(businessId: string, params: { page?: number; limit?: number }) {

    const { page = 1, limit = 50 } = params;

    const skip = (page - 1) * limit;



    const users = await prisma.user.findMany({ where: { businessId }, select: { email: true } });

    const emails = users.map((u) => u.email);



    const [history, total] = await Promise.all([

      prisma.loginHistory.findMany({

        where: { email: { in: emails } },

        orderBy: { createdAt: 'desc' },

        skip,

        take: limit,

      }),

      prisma.loginHistory.count({ where: { email: { in: emails } } }),

    ]);



    return { data: history, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };

  }



  async getSecurityEvents(businessId: string, params: { page?: number; limit?: number; type?: string }) {

    const { page = 1, limit = 50, type } = params;

    const skip = (page - 1) * limit;



    const [events, total] = await Promise.all([

      prisma.securityEvent.findMany({

        where: { businessId, ...(type && { type }) },

        orderBy: { createdAt: 'desc' },

        skip,

        take: limit,

      }),

      prisma.securityEvent.count({ where: { businessId, ...(type && { type }) } }),

    ]);



    return { data: events, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };

  }



  async createBackup(businessId: string, type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'MANUAL', userId?: string, req?: Request) {

    ensureBackupDir();

    const dbPath = getSqliteFilePath();

    if (!fs.existsSync(dbPath)) throw new AppError('Database file not found', 500);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `backup-${businessId}-${type.toLowerCase()}-${timestamp}`;
    const encryptLocal = shouldEncryptLocalBackups();
    const filename = encryptLocal ? `${baseName}.gbak` : `${baseName}.db`;
    const filepath = path.join(BACKUP_DIR, filename);
    const plainTemp = path.join(BACKUP_DIR, `${baseName}.tmp.db`);

    await backupSqliteDatabase(plainTemp);
    const checksum = plaintextChecksum(plainTemp);

    try {
      const { uploadEncryptedBackup } = await import('./cloudBackupService.js');
      await uploadEncryptedBackup(plainTemp, businessId);
    } catch (err) {
      console.error('[cloud-backup]', err instanceof Error ? err.message : err);
    }

    if (encryptLocal) {
      encryptBackupFile(plainTemp, filepath);
      fs.unlinkSync(plainTemp);
    } else {
      fs.renameSync(plainTemp, filepath);
    }

    const stats = fs.statSync(filepath);



    const backup = await prisma.backup.create({

      data: { businessId, filename, filepath, size: stats.size, type, checksum, status: 'COMPLETED' },

    });



    if (userId && req) {

      const meta = extractRequestMeta(req);

      await writeAuditLog(

        { action: 'BACKUP', module: 'SECURITY', entityId: backup.id, details: `Created ${type} backup` },

        { userId, ...meta }

      );

    }



    await this.rotateBackups(businessId);

    return backup;

  }



  async rotateBackups(businessId: string) {

    const dailyKeep = process.env.DESKTOP_MODE === 'true' ? 30 : 7;
    const limits = { DAILY: dailyKeep, WEEKLY: 4, MONTHLY: 12 };

    for (const [type, keep] of Object.entries(limits)) {

      const backups = await prisma.backup.findMany({

        where: { businessId, type },

        orderBy: { createdAt: 'desc' },

        skip: keep,

      });

      for (const b of backups) {

        if (b.filepath && fs.existsSync(b.filepath)) fs.unlinkSync(b.filepath);

        await prisma.backup.delete({ where: { id: b.id } });

      }

    }

  }



  async listBackups(businessId: string) {

    return prisma.backup.findMany({

      where: { businessId },

      orderBy: { createdAt: 'desc' },

      take: 50,

    });

  }



  async restoreBackup(backupId: string, businessId: string, userId: string, req: Request) {
    if (process.env.DESKTOP_MODE !== 'true') {
      throw new AppError(
        'In-app restore replaces the entire database and is only allowed on desktop till installs. Hosted deployments: use server backup files and a controlled maintenance restore (see docs/FIRST_CLIENT_ONBOARDING.md).',
        403
      );
    }

    const backup = await prisma.backup.findFirst({ where: { id: backupId, businessId } });

    if (!backup || !backup.filepath) throw new AppError('Backup not found', 404);

    if (!fs.existsSync(backup.filepath)) throw new AppError('Backup file missing', 404);



    const dbPath = getSqliteFilePath();
    ensureBackupDir();

    if (fs.existsSync(dbPath)) {
      const stamp = Date.now();
      const prePlain = path.join(BACKUP_DIR, `pre-restore-${stamp}.tmp.db`);
      await backupSqliteDatabase(prePlain);
      const prePath = shouldEncryptLocalBackups()
        ? path.join(BACKUP_DIR, `pre-restore-${stamp}.gbak`)
        : path.join(BACKUP_DIR, `pre-restore-${stamp}.db`);
      if (shouldEncryptLocalBackups()) {
        encryptBackupFile(prePlain, prePath);
        fs.unlinkSync(prePlain);
      } else {
        fs.renameSync(prePlain, prePath);
      }
    }

    const { path: plainBackup, cleanup } = materializePlainBackup(backup.filepath);
    try {
      fs.copyFileSync(plainBackup, dbPath);
    } finally {
      cleanup();
    }



    const meta = extractRequestMeta(req);

    await writeAuditLog(

      { action: 'RESTORE', module: 'SECURITY', entityId: backupId, details: `Restored from ${backup.filename}` },

      { userId, ...meta }

    );



    return { success: true, message: 'Database restored. Restart the server to apply changes.' };

  }



  async getPendingApprovals(businessId: string) {

    return prisma.inventoryApproval.findMany({

      where: { businessId, status: 'PENDING' },

      include: {

        requester: { select: { firstName: true, lastName: true } },

      },

      orderBy: { createdAt: 'desc' },

    });

  }



  async reviewApproval(id: string, reviewerId: string, approved: boolean, notes: string, businessId: string, req: Request) {

    const approval = await prisma.inventoryApproval.findFirst({ where: { id, businessId, status: 'PENDING' } });

    if (!approval) throw new AppError('Approval request not found', 404);



    const updated = await prisma.inventoryApproval.update({

      where: { id },

      data: {

        status: approved ? 'APPROVED' : 'REJECTED',

        reviewerId,

        reviewNotes: notes,

        reviewedAt: new Date(),

      },

    });



    if (approved) {

      await inventoryService.executeApproval(approval);

    }



    const meta = extractRequestMeta(req);

    await writeAuditLog(

      { action: approved ? 'APPROVE' : 'REJECT', module: 'INVENTORY', entityId: id, details: notes },

      { userId: reviewerId, ...meta }

    );



    return updated;

  }

  async getBackupStatus(businessId: string) {
    const last = await prisma.backup.findFirst({
      where: { businessId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    const count = await prisma.backup.count({ where: { businessId, status: 'COMPLETED' } });
    return {
      lastBackupAt: last?.createdAt ?? null,
      lastBackupFilename: last?.filename ?? null,
      backupCount: count,
      backupDir: process.env.DESKTOP_MODE === 'true' ? BACKUP_DIR : undefined,
      encryptedAtRest: shouldEncryptLocalBackups(),
    };
  }

  /** Server-wide SQLite backup for centrally hosted deployments (all tenants in one file). */
  async createServerWideBackup() {
    ensureBackupDir();
    const dbPath = getSqliteFilePath();
    if (!fs.existsSync(dbPath)) throw new AppError('Database file not found', 500);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `server-wide-${timestamp}`;
    const encryptLocal = shouldEncryptLocalBackups();
    const filename = encryptLocal ? `${baseName}.gbak` : `${baseName}.db`;
    const filepath = path.join(BACKUP_DIR, filename);
    const plainTemp = path.join(BACKUP_DIR, `${baseName}.tmp.db`);

    await backupSqliteDatabase(plainTemp);
    const checksum = plaintextChecksum(plainTemp);

    if (encryptLocal) {
      encryptBackupFile(plainTemp, filepath);
      fs.unlinkSync(plainTemp);
    } else {
      fs.renameSync(plainTemp, filepath);
    }

    const stats = fs.statSync(filepath);
    const registryBusinessId =
      process.env.HOSTED_BACKUP_BUSINESS_ID?.trim() ||
      (
        await prisma.business.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;

    if (registryBusinessId) {
      await prisma.backup.create({
        data: {
          businessId: registryBusinessId,
          filename,
          filepath,
          size: stats.size,
          type: 'SERVER',
          checksum,
          status: 'COMPLETED',
        },
      });
    }

    await this.rotateServerWideBackups();
    return { filename, filepath, size: stats.size, checksum };
  }

  async rotateServerWideBackups() {
    const keep = parseInt(process.env.HOSTED_BACKUP_RETAIN ?? '14', 10);
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('server-wide-') && (f.endsWith('.db') || f.endsWith('.gbak')))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(keep)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
    }
    const staleRows = await prisma.backup.findMany({
      where: { type: 'SERVER' },
      orderBy: { createdAt: 'desc' },
      skip: keep,
    });
    for (const row of staleRows) {
      if (row.filepath && fs.existsSync(row.filepath)) fs.unlinkSync(row.filepath);
      await prisma.backup.delete({ where: { id: row.id } });
    }
  }

  /** Copy backup to temp file and run SQLite integrity_check (restore drill, no overwrite). */
  async verifyBackupFile(backupId: string, businessId: string) {
    const backup = await prisma.backup.findFirst({ where: { id: backupId, businessId } });
    if (!backup?.filepath || !fs.existsSync(backup.filepath)) {
      throw new AppError('Backup file not found', 404);
    }
    const { path: tempPath, cleanup } = materializePlainBackup(backup.filepath);
    try {
      const { PrismaClient } = await import('@prisma/client');
      const verifyUrl = `file:${tempPath.replace(/\\/g, '/')}`;
      const client = new PrismaClient({ datasources: { db: { url: verifyUrl } } });
      await client.$connect();
      const rows = await client.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
      await client.$disconnect();
      const ok = rows[0]?.integrity_check === 'ok';
      return { ok, detail: rows[0]?.integrity_check ?? 'unknown', filename: backup.filename };
    } finally {
      cleanup();
    }
  }

}



export const securityService = new SecurityService();


