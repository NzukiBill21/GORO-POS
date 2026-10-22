const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

function secretsPath(app) {
  return path.join(app.getPath('userData'), 'secrets.bin');
}

function loadSecrets(app) {
  const file = secretsPath(app);
  if (!fs.existsSync(file)) return null;
  const payload = fs.readFileSync(file);
  if (!safeStorage.isEncryptionAvailable()) {
    return JSON.parse(payload.toString('utf8'));
  }
  return JSON.parse(safeStorage.decryptString(payload));
}

function ensureSecrets(app) {
  const existing = loadSecrets(app);
  if (existing?.jwtSecret && existing?.encryptionKey && existing?.desktopApiSecret) return existing;

  const generated = {
    jwtSecret: existing?.jwtSecret ?? crypto.randomBytes(48).toString('hex'),
    encryptionKey: existing?.encryptionKey ?? crypto.randomBytes(32).toString('hex'),
    desktopApiSecret: existing?.desktopApiSecret ?? crypto.randomBytes(32).toString('hex'),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    upgradedAt: existing?.desktopApiSecret ? undefined : new Date().toISOString(),
  };

  const file = secretsPath(app);
  const serialized = JSON.stringify(generated);
  const toWrite = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(serialized)
    : Buffer.from(serialized, 'utf8');
  fs.writeFileSync(file, toWrite);
  return generated;
}

module.exports = { ensureSecrets, loadSecrets };
