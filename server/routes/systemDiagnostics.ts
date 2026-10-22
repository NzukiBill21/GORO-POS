import { Router } from 'express';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { asyncHandler } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { getSqliteFilePath } from '../lib/databasePath.js';
import { runSqliteIntegrityCheck } from '../lib/sqliteInit.js';

export const systemDiagnosticsRouter = Router();
systemDiagnosticsRouter.use(authenticate);
systemDiagnosticsRouter.use(requirePermission('settings.view'));

systemDiagnosticsRouter.get(
  '/diagnostics',
  asyncHandler(async (req, res) => {
    const dbPath = getSqliteFilePath();
    const dbSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const integrity = await runSqliteIntegrityCheck();

    const lastBackup = await prisma.backup.findFirst({
      where: { businessId: req.user!.businessId },
      orderBy: { createdAt: 'desc' },
    });
    const backupCount = await prisma.backup.count({ where: { businessId: req.user!.businessId } });

    res.json({
      dbSizeBytes,
      dbPath: process.env.DESKTOP_MODE === 'true' ? dbPath : undefined,
      integrityOk: integrity.ok,
      lastBackupAt: lastBackup?.createdAt ?? null,
      lastBackupStatus: lastBackup?.status ?? null,
      backupCount,
      desktop: process.env.DESKTOP_MODE === 'true',
    });
  })
);
