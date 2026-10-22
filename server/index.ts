import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './lib/prisma.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { productsRouter } from './routes/products.js';
import { shopImportRouter } from './routes/shopImport.js';
import { categoriesRouter } from './routes/categories.js';
import { customersRouter } from './routes/customers.js';
import { salesRouter } from './routes/sales.js';
import { inventoryRouter } from './routes/inventory.js';
import { purchasesRouter } from './routes/purchases.js';
import { financialsRouter } from './routes/financials.js';
import { employeesRouter } from './routes/employees.js';
import { notificationsRouter, settingsRouter, reportsRouter } from './routes/system.js';
import { securityRouter } from './routes/security.js';
import { billingRouter } from './routes/billing.js';
import { platformRouter } from './routes/platform.js';
import { posPaymentsRouter } from './routes/posPayments.js';
import { posWebhooksRouter } from './routes/posWebhooks.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalRateLimit } from './middleware/rateLimit.js';
import { authenticate } from './middleware/auth.js';
import { subscriptionGate } from './middleware/subscriptionGate.js';
import { startBillingScheduler } from './jobs/billingScheduler.js';
import { assertMpesaMockAllowed } from './lib/mpesaMockGuard.js';
import { ensureDatabaseSchema } from './lib/schemaBootstrap.js';
import { startDesktopBackupScheduler } from './jobs/desktopBackupScheduler.js';
import { startHostedBackupScheduler } from './jobs/hostedBackupScheduler.js';
import { startMpesaRelayPoller, stopMpesaRelayPoller } from './jobs/mpesaRelayPoller.js';
import { getSqliteFilePath } from './lib/databasePath.js';
import { setupRouter } from './routes/setup.js';
import { onboardingRouter } from './routes/onboarding.js';
import { systemDiagnosticsRouter } from './routes/systemDiagnostics.js';
import { applySqlitePragmas, runSqliteIntegrityCheck } from './lib/sqliteInit.js';
import {
  API_PORT,
  resolveListenHost,
  resolveCorsOrigins,
  resolveHelmetConnectSrc,
  isDesktopStaticUi,
} from './lib/listenHost.js';
import { desktopLocalOnly } from './middleware/desktopLocalOnly.js';
import { hostOriginGuard } from './middleware/hostOriginGuard.js';
import { desktopApiSecret } from './middleware/desktopApiSecret.js';

const app = express();
const PORT = API_PORT;
const listenHost = resolveListenHost();
const isDesktop = process.env.DESKTOP_MODE === 'true';

app.set('trust proxy', isDesktop ? 0 : 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: resolveHelmetConnectSrc(),
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: resolveCorsOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Goro-Desktop-Secret'],
}));

app.use(hostOriginGuard());
app.use(desktopApiSecret());
app.use(desktopLocalOnly());
app.use(globalRateLimit);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: true,
      desktop: isDesktop,
      port: PORT,
      uiOnApiPort: isDesktopStaticUi(),
      bindHost: listenHost,
      localOnly: isDesktop && process.env.ALLOW_LAN_BIND !== 'true',
      dataDir: process.env.GOROVIAN_DATA_DIR ?? null,
      dbFile: process.env.NODE_ENV === 'development' ? getSqliteFilePath() : undefined,
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: false, timestamp: new Date().toISOString() });
  }
});

app.use('/api/setup', setupRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/auth', authRouter);
app.use('/api/platform', platformRouter);
app.use('/api/billing', billingRouter);
app.use('/api/pos/webhooks', posWebhooksRouter);

app.use(authenticate);
app.use(subscriptionGate());

app.use('/api/pos', posPaymentsRouter);

app.use('/api/dashboard', dashboardRouter);
app.use('/api/products', productsRouter);
app.use('/api/shop-import', shopImportRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/sales', salesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/financials', financialsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/security', securityRouter);
app.use('/api/system', systemDiagnosticsRouter);

if (process.env.SERVE_STATIC === 'true') {
  const distDir = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'), (err) => (err ? next(err) : undefined));
  });
}

app.use(errorHandler);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function start() {
  try {
    if (process.env.DESKTOP_MODE === 'true') {
      await ensureDatabaseSchema(projectRoot);
    }
    await prisma.$connect();
    if (process.env.DATABASE_URL?.includes('file:') || process.env.GOROVIAN_DATA_DIR) {
      await applySqlitePragmas();
      if (process.env.DESKTOP_MODE === 'true') {
        const integrity = await runSqliteIntegrityCheck();
        if (!integrity.ok) {
          console.error('[sqlite] integrity_check failed:', integrity.detail);
          process.exit(1);
        }
        console.log('[sqlite] WAL enabled, integrity OK');
      }
    }
    assertMpesaMockAllowed();
    if (
      process.env.DESKTOP_MODE === 'true' &&
      process.env.NODE_ENV === 'production' &&
      !process.env.POS_WEBHOOK_SECRET
    ) {
      console.warn(
        '[security] POS_WEBHOOK_SECRET is not set — STK webhook HMAC is disabled. Set it if you use a callback relay.'
      );
    }
    console.log('Database connected');
    const server = app.listen(Number(PORT), listenHost, () => {
      console.log(`Server running on http://${listenHost}:${PORT}`);
      if (isDesktop) {
        console.log('[security] Desktop till: API not exposed on shop Wi‑Fi (loopback bind + local-only middleware)');
      }
      startBillingScheduler();
      startDesktopBackupScheduler();
      startHostedBackupScheduler();
      startMpesaRelayPoller();
    });

    const shutdown = async (signal: string) => {
      console.log(`[server] ${signal} — shutting down`);
      stopMpesaRelayPoller();
      server.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other process:`);
        console.error(`  Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
        process.exit(1);
      }
      throw err;
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;
