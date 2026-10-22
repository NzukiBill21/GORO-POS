import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Load shop secrets before Prisma/env consumers run.
 * Packaged desktop: `%APPDATA%/<app>/shop.env` (see electron/serverLauncher.js).
 */
export function loadShopEnvironment(): void {
  const candidates: string[] = [];

  if (process.env.GOROVIAN_SHOP_ENV?.trim()) {
    candidates.push(process.env.GOROVIAN_SHOP_ENV.trim());
  }

  if (process.env.GOROVIAN_DATA_DIR) {
    candidates.push(path.join(process.env.GOROVIAN_DATA_DIR, 'shop.env'));
    candidates.push(path.join(path.dirname(process.env.GOROVIAN_DATA_DIR), 'shop.env'));
  }

  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'enterprise-pos', 'shop.env'));
    candidates.push(path.join(process.env.APPDATA, 'Gorovian POS', 'shop.env'));
  }

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const devEnv = path.join(process.cwd(), '.env');
    if (fs.existsSync(devEnv)) {
      dotenv.config({ path: devEnv, override: false });
    }
  }
}
