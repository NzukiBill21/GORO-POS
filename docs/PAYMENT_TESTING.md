# Payment testing (dev)

## Quick mock M-Pesa (recommended first)

1. In `.env`:
   - `MPESA_MOCK=true`
   - `MPESA_MOCK_DELAY_MS=3000` (optional)
2. Restart API: stop `npm run dev:web`, start again.
3. Open **http://127.0.0.1:5173** (not localhost-only bookmarks if login 403s — both work in dev).
4. Log in as a user with POS access (e.g. seeded admin).
5. POS → add items → **Pay** → choose **M-Pesa** → phone e.g. `0712345678` → confirm.
6. Wait ~3s: UI polls until sale is **COMPLETED**, then receipt steps.
7. **Cash**: same flow, choose **Cash**, enter tender ≥ total.

No internet required for mock STK. Success only after server mock callback (not when STK is “sent”).

## Automated checks

```bash
npm test -- tests/pos-payments.test.ts tests/daraja-stk.test.ts
```

## Real Daraja sandbox (Lipa na M-Pesa)

1. In `.env` (server-only, never commit):

   | Variable | Example |
   |----------|---------|
   | `MPESA_ENV` | `sandbox` |
   | `MPESA_MOCK` | **`false`** (if `true`, Daraja is never called) |
   | `MPESA_CONSUMER_KEY` | from Safaricom developer portal |
   | `MPESA_CONSUMER_SECRET` | from portal |
   | `MPESA_PASSKEY` | STK passkey for sandbox app |
   | `MPESA_SHORTCODE` | `174379` (sandbox test paybill) |
   | `MPESA_POS_CALLBACK_URL` | public **HTTPS** URL (see below) |

2. Verify OAuth only: `npm run mpesa:verify`

3. Restart `npm run dev:web`.

4. POS → M-Pesa → phone **`254708374149`** (sandbox test MSISDN) or `0712345678` normalized to 2547…

5. **Callback:** Safaricom cannot POST to `127.0.0.1`. For dev, run ngrok (temporary):

   ```powershell
   ngrok http 3001
   ```

   Then in `.env`:

   ```env
   MPESA_POS_CALLBACK_URL=https://YOUR-SUBDOMAIN.ngrok-free.app/api/pos/webhooks/mpesa/stk
   ```

   Optional: `POS_WEBHOOK_SECRET=some-long-secret` (same on server; HMAC header if you add it on relay).

   Production-style: [MPESA_CALLBACK_ARCHITECTURE.md](./MPESA_CALLBACK_ARCHITECTURE.md) (Cloudflare relay).

6. If callback is missing, the till still **polls STK Query** while the checkout dialog is open — payment may complete without tunnel, but tunnel is recommended.

**Alternative:** store the same keys in **Settings → Payments** (encrypted in DB); env is used when tenant fields are empty (sandbox only).

## Manual M-Pesa

Uses **MANUAL_UNVERIFIED** — manager approval for amounts above threshold. Test from POS → manual code entry or **Manual payments** review screen.
