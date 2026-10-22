# Secure hosting on shop Wi‑Fi (Iman pilot & desktop tills)

Goal: **full-time POS on Wi‑Fi** without exposing the till or customer data to other devices on the network.

## How security works (desktop build)

| Layer | What it does |
|--------|----------------|
| **127.0.0.1 bind** | API and UI served only on the till PC — not reachable from phones/laptops on the same Wi‑Fi |
| **Electron shell** | Single app window; no browsing to random sites |
| **Auth + RBAC** | Every API call after login; manager/cashier permissions |
| **Rate limits** | Login and global request limits reduce brute force |
| **SQLite WAL + backups** | Local data; shift-close and nightly copies under `%APPDATA%` |
| **Secrets** | JWT/encryption keys generated at install (`electron/secrets.js` + safeStorage) |
| **M‑Pesa STK** | **Outbound** push + **polling** — till works without a public URL on the shop router |
| **Optional relay** | STK callbacks via `POST /api/pos/webhooks/mpesa/relay` + `POS_WEBHOOK_SECRET` if you add cloud relay later |

Cash sales and product/stock data **do not require internet**. M‑Pesa needs Safaricom API reachability (shop internet); if Wi‑Fi drops briefly, **cash still works**.

## Before go‑live checklist (Iman)

### 1. Install the desktop app (not dev server)

```powershell
npm run build:electron
# Install from release/*.exe
```

- First run: **Setup wizard** (owner account, strong password — no demo passwords).
- Data: `%APPDATA%\enterprise-pos\data\pos.db` (not OneDrive project folder).

### 2. Wi‑Fi and router

- [ ] Shop Wi‑Fi uses **WPA2‑PSK or WPA3** (not open/guest for the till).
- [ ] Router admin password changed from default.
- [ ] Till PC uses **Private** network profile in Windows (Settings → Network).
- [ ] Optional: run `scripts\windows\Secure-PosDesktop.ps1` **as Admin** to block inbound TCP 3001 on Private/Public profiles.

### 3. Windows till PC

- [ ] Windows Update enabled; standard user for daily login; owner password only for admin tasks.
- [ ] **BitLocker** or full-disk encryption if laptop (recommended).
- [ ] USB autoplay disabled for untrusted drives.
- [ ] Receipt printer and scanner tested after install.

### 4. Application settings

- [ ] Settings → Receipt: logo path, terms, bank footer.
- [ ] Settings → Payments: real M‑Pesa credentials (not `MPESA_MOCK`).
- [ ] Diagnostics page: DB integrity OK, backup status green after first shift close.

### 5. Staff

- [ ] Cashier: own login — no shared passwords.
- [ ] Manager: reviews dashboard, backups, M‑Pesa reconciliation.
- [ ] Train: Pay flow → OK steps → Print; cash when internet down.

### 6. Backups

- [ ] Confirm `%APPDATA%\enterprise-pos\backups` has `.db` files after shift close.
- [ ] Optional: configure `CLOUD_BACKUP_URL` + `CLOUD_BACKUP_KEY` for encrypted off-site copy.
- [ ] Once: Settings/Security → restore **verify** on latest backup (no production overwrite).

## Dev vs shop till (ports — do not mix)

| | Dev (`npm run dev:web`) | Shop desktop install |
|--|-------------------------|----------------------|
| **URL you open** | `http://127.0.0.1:5173` | `http://127.0.0.1:3001` |
| API | 3001 loopback, proxied by Vite | 3001 loopback, same window |
| Use on live shop | **No** | **Yes** |

On the till there is **one port, one URL: 3001**. Port **5173 is dev-only** (Vite). Do not run `npm run dev:web` on a live shop PC.

## M‑Pesa on Wi‑Fi

1. Configure Safaricom credentials in Settings → Payments.
2. STK uses **status polling** on the till — no port forwarding required.
3. If you later use a **cloud relay** for callbacks, set `POS_WEBHOOK_SECRET` and point Safaricom to the relay URL, not the shop PC.

## Monitoring

- **Diagnostics** (manager): DB size, last backup, version.
- **Dashboard**: sales, stock; aligns with receipt line items (SKU/barcode).
- `/api/health`: `desktop: true`, local bind confirmed in server log: `Server running on http://127.0.0.1:3001`.

## Related docs

- [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md)
- [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)
- [PRODUCTION_STAGES.md](./PRODUCTION_STAGES.md)
- [SECURITY_REPORT.md](../SECURITY_REPORT.md)
