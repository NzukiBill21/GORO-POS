const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ensureSecrets } = require('./secrets.js');

function resolveAppRoot(app) {
  if (!app.isPackaged) return path.join(__dirname, '..');
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked');
  if (fs.existsSync(path.join(unpacked, 'server', 'index.ts'))) return unpacked;
  return path.join(process.resourcesPath, 'app');
}

/** %APPDATA%\<app>\data — never OneDrive project folder */
function ensureShopEnv(app, userData) {
  const shopEnv = path.join(userData, 'shop.env');
  if (fs.existsSync(shopEnv)) return shopEnv;
  const root = resolveAppRoot(app);
  const example = path.join(root, 'shop.env.example');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, shopEnv);
    console.log('[electron] Created shop.env template — edit SMTP/M-Pesa settings:', shopEnv);
  }
  return shopEnv;
}

function ensureDirs(app) {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const backupDir = path.join(userData, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const shopEnvPath = ensureShopEnv(app, userData);
  return { dataDir, backupDir, userData, shopEnvPath };
}

function startApiProcess(app, onExit) {
  const root = resolveAppRoot(app);
  const { dataDir, backupDir, shopEnvPath } = ensureDirs(app);
  const secrets = ensureSecrets(app);

  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(root, 'server', 'index.ts');

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: process.env.PORT || '3001',
    HOST: '127.0.0.1',
    GOROVIAN_DATA_DIR: dataDir,
    GOROVIAN_SHOP_ENV: shopEnvPath,
    BACKUP_DIR: backupDir,
    SERVE_STATIC: 'true',
    DESKTOP_MODE: 'true',
    BILLING_ENABLED: 'false',
    BILLING_CRON_ENABLED: 'false',
    JWT_SECRET: secrets.jwtSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    DESKTOP_API_SECRET: secrets.desktopApiSecret,
    ELECTRON_RUN_AS_NODE: '1',
  };

  const child = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (err) => {
    console.error('[electron] API process error:', err);
  });

  child.on('exit', (code, signal) => {
    if (typeof onExit === 'function') onExit(code, signal);
  });

  return child;
}

function waitForHealth(port, attempts = 60, intervalMs = 500) {
  const url = `http://127.0.0.1:${port}/api/health`;
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else if (tries >= attempts) reject(new Error(`Health check failed: ${res.statusCode}`));
        else setTimeout(tick, intervalMs);
      });
      req.on('error', () => {
        if (tries >= attempts) reject(new Error('API did not become ready'));
        else setTimeout(tick, intervalMs);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (tries >= attempts) reject(new Error('Health check timeout'));
        else setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

module.exports = { startApiProcess, waitForHealth, resolveAppRoot };
