# Stages 3–7 implementation report

Date: 2026-03-21

## Summary

Daraja STK sandbox integration was hardened (KES amounts, OAuth cache, env/tenant credentials, STK idempotency, failure handling). A Cloudflare Worker **reference relay** and outbound till poller were added. Desktop `shop.env` loading, barcode UX, and Electron printer selection were implemented. Automated tests expanded to **62 passing**.

## Files changed (high level)

| Area | Paths |
|------|--------|
| Daraja | `server/lib/mpesaDarajaConfig.ts`, `mpesaOAuthCache.ts`, `mpesaAmount.ts`, `server/services/pos/posMpesaStkService.ts`, `posCheckoutService.ts`, `posPricingService.ts` |
| Relay | `relay/`, `server/jobs/mpesaRelayPoller.ts`, `docs/MPESA_CALLBACK_ARCHITECTURE.md` |
| Desktop | `server/lib/loadEnv.ts`, `server/lib/prisma.ts`, `electron/serverLauncher.js`, `shop.env.example` |
| Barcode / print | `server/services/productService.ts`, `src/pages/POSPage.tsx`, `electron/main.js`, `electron/preload.js`, `src/components/settings/DesktopPrinterSettings.tsx` |
| UI / checkout | `src/components/pos/PosCheckoutDialog.tsx`, `src/lib/printReceipt.ts` |
| Schema | `prisma/schema.prisma` — `Payment.mpesaStkIdempotencyKey` |
| Tests | `tests/daraja-stk.test.ts`, `mpesa-relay.test.ts`, `barcode-print.test.ts`, `sqlite-persistence.test.ts`, updates to `pos-payments.test.ts`, `password-reset.test.ts` |
| Docs | `.env.example`, `docs/LOCAL_DEPLOYMENT.md`, `docs/BACKUP_RESTORE.md` |

## Database migrations

- `npx prisma db push` — adds nullable unique `Payment.mpesaStkIdempotencyKey`.
- Barcode uniqueness enforced in **application code** (dev seed had duplicate barcodes blocking a DB unique index).

## Environment variables (placeholders only)

| Variable | Purpose |
|----------|---------|
| `MPESA_ENV` | `sandbox` or `production` |
| `MPESA_MOCK` | `true` for mock STK (blocked in production) |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` / `MPESA_PASSKEY` / `MPESA_SHORTCODE` | Sandbox env fallback (server-only) |
| `MPESA_POS_CALLBACK_URL` | Public HTTPS STK callback URL |
| `MPESA_RELAY_URL` / `MPESA_RELAY_TILL_TOKEN` | Outbound relay poller |
| `POS_WEBHOOK_SECRET` | Optional HMAC for direct webhook |
| `SMTP_*` / `MAIL_FROM` | Password reset email |
| `GOROVIAN_DATA_DIR` / `GOROVIAN_SHOP_ENV` | Desktop DB and secrets file |
| `RECEIPT_WIDTH_MM` | Receipt CSS width (default 80) |

See [`shop.env.example`](../shop.env.example) and [`.env.example`](../.env.example).

## Run and package (Windows)

```bash
npm install
npm run db:push
npm run dev:web          # browser dev
npm run build:electron   # NSIS installer under release/
```

Desktop first launch creates `%APPDATA%\<app>\shop.env` from the template — edit SMTP and M-Pesa before live STK.

## How to test

### Gmail (password reset)

1. Set `SMTP_*` in `.env` or `shop.env`.
2. `npm run smtp:verify`
3. Forgot-password flow with **your own** email only.

### Daraja sandbox

1. `MPESA_MOCK=false`, sandbox keys in env or Settings → Payments.
2. Public callback: deploy [`relay/`](../relay/) or temporary ngrok (dev only — see architecture doc).
3. Sandbox test MSISDN: `254708374149`.
4. STK success requires **callback or STK Query** — not the initial `ResponseCode: 0` alone.

## Test / build results (this run)

| Command | Result |
|---------|--------|
| `npm test` | **62/62 passed** |
| `npm run build` | **Success** (Vite) |
| `npm run typecheck` | **Failed** — pre-existing project TS issues unrelated to this work; no new blocking errors in changed Daraja paths verified via tests |
| `npm run build:electron` | Not run in this session (requires electron-builder time + signing env) |

## Manual steps and prerequisites

- **Cloudflare**: account, D1, `wrangler deploy`, set `MPESA_RELAY_TILL_TOKEN` secret.
- **Hardware**: USB barcode scanner (keyboard wedge); Windows receipt printer configured in Settings → Receipt.
- **Shop PC**: Edit `shop.env` after install; restart till.

## Feature readiness matrix

| Feature | Implemented | Automated test | Production-ready |
|---------|-------------|----------------|------------------|
| Daraja STK (sandbox config, KES, OAuth cache) | Yes | Yes | Sandbox only until live creds + callback verified |
| STK callback validation / idempotency | Yes | Yes | Yes (logic); needs live callback path |
| Cloudflare relay + till poller | Yes (reference) | Partial (HMAC unit) | **No** — deploy and verify delivery |
| ngrok/cloudflared dev tunnel | Documented | N/A | **No** (dev only) |
| Desktop `shop.env` + loopback API | Yes | Partial | Yes for local-first |
| Barcode not-found UX + tenant lookup | Yes | Yes | Yes |
| Barcode DB unique index | App-level 409 | Partial | Yes (app); DB unique deferred due to seed dupes |
| Default receipt printer (Electron) | Yes | Sanitize only | Needs hardware smoke test |
| Password reset (Gmail) | Yes | Yes | Requires SMTP on shop PC |
| M-Pesa without internet → success | Prevented | Via mock/status tests | Yes (no success without verified callback) |

## Not claimed

- Live Daraja sandbox payment was **not** executed in CI (no credentials or public callback in this environment).
- Relay production reliability was **not** verified end-to-end.
- `npm run build:electron` installer was **not** produced in this session.
