/**
 * Verify hash chain integrity on AuditLog rows that have entryHash set.
 * Usage: npx tsx scripts/audit-verify.ts
 */
import crypto from 'crypto';
import { prisma } from '../server/lib/prisma.js';

const GENESIS_HASH = '0'.repeat(64);

function computeEntryHash(prevHash: string, payload: string): string {
  return crypto.createHash('sha256').update(`${prevHash}|${payload}`, 'utf8').digest('hex');
}

async function main() {
  const rows = await prisma.auditLog.findMany({
    where: { entryHash: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      prevHash: true,
      entryHash: true,
      action: true,
      module: true,
      entityId: true,
      details: true,
      userId: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) {
    console.log('No hash-chained audit entries yet (OK for legacy DB).');
    return;
  }

  let expectedPrev = GENESIS_HASH;
  let broken = 0;

  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      console.error(`Chain break at ${row.id}: expected prevHash ${expectedPrev}, got ${row.prevHash}`);
      broken += 1;
      expectedPrev = row.entryHash ?? expectedPrev;
      continue;
    }

    const payload = JSON.stringify({
      prevHash: row.prevHash,
      action: row.action,
      module: row.module,
      entityId: row.entityId ?? null,
      details: row.details ?? null,
      userId: row.userId ?? null,
      at: row.createdAt.toISOString(),
    });
    const expectedEntry = computeEntryHash(row.prevHash!, payload);
    if (expectedEntry !== row.entryHash) {
      console.error(`Hash mismatch at ${row.id}: stored ${row.entryHash}, computed ${expectedEntry}`);
      broken += 1;
    }
    expectedPrev = row.entryHash!;
  }

  if (broken > 0) {
    console.error(`FAILED: ${broken} issue(s) in ${rows.length} entries.`);
    process.exit(1);
  }
  console.log(`OK: ${rows.length} hash-chained audit entries verified.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
