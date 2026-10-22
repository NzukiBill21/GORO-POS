# M-Pesa callback architecture (local-first till)

## Constraint

The shop till runs **Express on `127.0.0.1`** with **SQLite on the PC**. Safaricom Daraja must POST STK callbacks to a **public HTTPS URL**. The local API must **never** be exposed directly to the internet.

## Production-oriented path (recommended)

Use the reference **Cloudflare Worker relay** in [`relay/`](../relay/):

1. Safaricom → `POST https://<worker>/v1/mpesa/stk-callback?tenant=<businessId>`
2. Worker persists the raw JSON in **D1** (idempotent on `checkout_request_id`).
3. The till **polls outbound** (`GET /v1/events`) with `MPESA_RELAY_URL` + `MPESA_RELAY_TILL_TOKEN`.
4. The local API applies each event via `processPosStkCallback` (same idempotency as direct webhook).
5. Till sends `POST /v1/events/ack` after successful processing.

This is **not** a reverse proxy and cannot reach the shop LAN.

### Prerequisites

- Cloudflare account (Workers + D1 free tier has limits — verify for your volume)
- `wrangler` CLI, D1 database created, `database_id` in [`relay/wrangler.toml`](../relay/wrangler.toml)
- Run [`relay/schema.sql`](../relay/schema.sql) against D1
- Secrets in Cloudflare: `MPESA_RELAY_TILL_TOKEN` (long random string; same value on till `shop.env`)
- Daraja **CallBackURL** = Worker URL (or tenant override in Settings → Payments)

### Till environment

```env
MPESA_ENV=sandbox
MPESA_RELAY_URL=https://your-worker.workers.dev
MPESA_RELAY_TILL_TOKEN=your-long-random-token
MPESA_POS_CALLBACK_URL=https://your-worker.workers.dev/v1/mpesa/stk-callback?tenant=YOUR_BUSINESS_UUID
```

Optional: `POS_WEBHOOK_SECRET` if you also tunnel direct webhooks in dev (HMAC on `/api/pos/webhooks/mpesa/stk`).

## Temporary dev/sandbox only

**ngrok** or **cloudflared** can tunnel to `http://127.0.0.1:3001/api/pos/webhooks/mpesa/stk` for sandbox testing.

- Label this **non-production** in runbooks.
- Rotate tunnel URLs when they change.
- Prefer the Worker relay for anything resembling a pilot shop.

## Reconciliation

1. **STK Query** — till polls Safaricom while status is `WAITING`/`SENT` (`refreshWaitingStkFromDaraja`).
2. **Relay backlog** — outbound poller when `MPESA_RELAY_*` is set.
3. **Manual CSV** — existing M-Pesa reconcile in POS settings.

## Production readiness

Do **not** claim production M-Pesa readiness until callback delivery, relay auth, missed-event recovery, and reconciliation have been verified on your infrastructure.
