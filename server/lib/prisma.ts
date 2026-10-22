import { PrismaClient } from '@prisma/client';
import { loadShopEnvironment } from './loadEnv.js';
import { resolveDatabaseUrl } from './databasePath.js';

loadShopEnvironment();
resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
