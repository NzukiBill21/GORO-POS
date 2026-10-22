# Local desktop deployment (Stage 7)

## Dev (web + API)

```bash
npm install
npm run db:push
npm run dev:web
```

Open **http://127.0.0.1:5173** only. The API listens on **3001** on loopback; Vite proxies `/api` — do not open 3001 in the browser during dev.

## Dev (Electron + separate API)

```bash
npm run dev:desktop
```

## Production-like desktop (single window)

Build UI, then run Electron (starts embedded API):

```bash
npm run start:desktop
```

Electron will:

1. Set `GOROVIAN_DATA_DIR` and `BACKUP_DIR` under `%APPDATA%`
2. Run `prisma db push` on first launch (empty DB — **no demo seed**)
3. Start Express on **127.0.0.1:3001** with `SERVE_STATIC=true`
4. Load **http://127.0.0.1:3001** in the window

## Installer

```bash
npm run build:electron
```

Output: `release/` (NSIS on Windows). Package includes `server/`, `prisma/schema.prisma`, `dist/`, and runtime deps (`tsx`, `prisma`, `@prisma/client`).

## Pilot shop setup (Iman)

On a **dev** machine with existing DB:

```bash
npm run db:seed-iman
```

On a **fresh desktop install**, create org/users via platform or a one-time setup script — do not copy `dev.db`.

## Environment (desktop)

| Variable | Purpose |
|----------|---------|
| `GOROVIAN_DATA_DIR` | SQLite folder (`pos.db`) |
| `BACKUP_DIR` | Backup files (desktop: encrypted `.gbak` via `ENCRYPTION_KEY`; optional `BACKUP_ENCRYPT=false` for plain `.db`) |
| `DESKTOP_MODE` | Schema bootstrap + daily backups |
| `BILLING_ENABLED` | Set `false` in desktop launcher — till never subscription-locked |
| `BILLING_CRON_ENABLED` | Default `false` in desktop launcher |
| `CLOUD_BACKUP_URL` / `CLOUD_BACKUP_KEY` | Optional encrypted off-site backup upload |
| `POS_WEBHOOK_SECRET` | Optional HMAC for STK callback |
| `HOST` | Desktop launcher sets `127.0.0.1` — do not expose API on LAN |
| `ALLOW_LAN_BIND` | **Dev only** — set `true` to bind non-loopback (not for shop tills) |
| `GOROVIAN_SHOP_ENV` | Path to `shop.env` (SMTP, M-Pesa, relay); auto-created from `shop.env.example` on first Electron launch |
| `MPESA_RELAY_URL` / `MPESA_RELAY_TILL_TOKEN` | Optional outbound callback poller — see [MPESA_CALLBACK_ARCHITECTURE.md](./MPESA_CALLBACK_ARCHITECTURE.md) |

## Shop Wi‑Fi (secure full-time use)

See **[WIFI_SECURE_HOSTING.md](./WIFI_SECURE_HOSTING.md)** — Iman pilot checklist, M‑Pesa on Wi‑Fi, optional Windows firewall script (`scripts/windows/Secure-PosDesktop.ps1`).
