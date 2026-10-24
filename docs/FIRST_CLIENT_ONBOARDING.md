# First retail client — onboarding & deployment

Use this with the **platform console** for tenant creation and the **tenant app** for catalogue/stock/POS. Do not import demo seed data into the client tenant.

## Stage 1 — Create tenant and owner (platform admin)

### URLs (development)

| Step | URL |
|------|-----|
| Platform sign-in | `http://127.0.0.1:5173/platform/login` (dev) or your hosted `/platform/login` |
| Platform console | `/platform/billing` |

Production: use your hosted origin only; set `PLATFORM_ADMIN_*` in server env and run `npm run db:seed` once on the **host** (not on the shop PC).

### Steps

1. Sign in as platform admin (`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` from server env, or seed defaults — change in production).
2. **Tenant directory** → **Create tenant** — business name, owner name, owner email, plan code (e.g. `REGULAR`).
3. Owner receives an **email invitation** (SMTP must be configured on the server). No temporary password is shown in the console.
4. Owner opens **`/accept-invite`** (link in email), enters the 6-digit code and a strong password, then signs in at **`/login`**.
5. In platform **Details** on the tenant: confirm subscription `TRIALING`, owner “password setup pending” cleared after accept, and **Platform audit** shows `TENANT_CREATE` / `OWNER_INVITE_RESEND` if used.
6. If email fails: **Details** → **Resend owner invitation** (does not create a duplicate business).

### Security (verified in code/tests)

- Invitation tokens/codes are **hashed** in DB; API responses do **not** include magic links or codes (dev: `REGISTRATION_DEV_LOG=true` logs server-side only).
- **`acceptInvitation`** binds to one `userId` / `businessId`; login/API use JWT `businessId` — no cross-tenant access from another invite.
- Pending invites **expire** (72h); accepting sets `acceptedAt` (single use).
- Platform admin accounts are **not** creatable via public registration.

---

## Stage 2 — Windows deployment architecture

### What the codebase supports today

| Mode | Database | Windows client | Status |
|------|-----------|----------------|--------|
| **Dev web** | `dev.db` on dev machine | Browser `http://127.0.0.1:5173` → API proxy 3001 | For development only |
| **Desktop till** | SQLite under `%APPDATA%` | Electron, `127.0.0.1:3001`, local-only | Documented in `docs/WIFI_SECURE_HOSTING.md` — **one DB per till** |
| **Central hosted** | Single SQLite (or future Postgres) on **server** | Browser to **HTTPS** app URL; API same origin if `SERVE_STATIC=true` | **Supported in code**; **you must deploy** (TLS, env, backups) — not verified in this repo |

**Preferred for first hosted client:** one production server running Node API + built UI (`npm run build`, `SERVE_STATIC=true`), single `DATABASE_URL`, tenants isolated by `businessId`. Shop PCs use **Edge/Chrome** to `https://pos.yourdomain.com` — **do not** copy `dev.db` to the client PC.

### Production env (minimum on host)

See `.env.example` section “Centrally hosted production”. Required:

- `NODE_ENV=production`, strong `JWT_SECRET`, `ENCRYPTION_KEY`
- `INVITE_BASE_URL` and `CORS_ORIGIN` = public app URL
- `SMTP_*` for owner invitations
- `MPESA_MOCK=false`; real Daraja credentials per tenant or global as configured
- `PUBLIC_REGISTRATION_ENABLED=false` unless you intentionally allow self-signup
- **Do not** set `REGISTRATION_DEV_LOG` or `PASSWORD_RESET_DEV_LOG` in production

### Blockers before paid go-live (not auto-verified here)

- [ ] HTTPS reverse proxy (nginx/Caddy/IIS) — Node does not terminate TLS by itself
- [ ] Hosted server provisioned and `.env` applied (not localhost)
- [ ] `npm run smtp:verify` succeeds on **production** host
- [ ] M-Pesa production credentials and callback/relay tested on a real sale
- [ ] Server backups scheduled or cron `npm run backup:server` (see **Backups** below)
- [ ] Excel template present: `docs/templates/GOROVIAN_Shop_Product_and_Stock_Template.xlsx` (mirrored under `public/templates/` for in-app download)

---

## Server database backups (hosted / multi-tenant)

Each backup is a **full SQLite file** containing **all tenants**. Tenant **Settings → Restore** in the app is **disabled** unless `DESKTOP_MODE=true` (single till); hosted restores must be a **controlled maintenance** procedure.

| Action | Command / setting |
|--------|-------------------|
| Manual backup | `npm run backup:server` on the host (writes `server-wide-*.db` or `.gbak` under the backup directory) |
| Scheduled | Set `HOSTED_BACKUP_ENABLED=true`, or rely on auto when `SERVE_STATIC=true` and `NODE_ENV=production` (daily job in API process) |
| Retention | `HOSTED_BACKUP_RETAIN` (default 14) |
| Encrypted at rest | Same as desktop: `BACKUP_ENCRYPTION_KEY` → `.gbak` files; decrypt with `npm run backup:decrypt -- <file>` |
| Verify without restore | Platform/owner can use backup **verify** (integrity check on a copy) where exposed in Security UI |
| **Restore (maintenance)** | 1) Stop API. 2) Copy current `pos.db` aside. 3) Decrypt backup if needed. 4) Replace DB file at `DATABASE_URL`. 5) Start API. 6) Spot-check both tenants if multi-tenant. **Never** use tenant UI restore on hosted. |

Document the backup directory path on your host (from server logs or `getBackupDirectory()` in code) and test restore on a **copy** of production before go-live.

---

## Stage 3 — Product catalogue & opening stock

### Where in the app

1. Sign in as **owner/manager** on the client tenant.
2. Sidebar → **Products**.
3. Button: **Import Excel workbook** (`ShopExcelImportDialog`).

### Workflow

1. **Download template** from the import dialog (or use your filled copy of `GOROVIAN_Shop_Product_and_Stock_Template.xlsx`).
2. **Step 1 — Products catalogue** — upload → choose **Create only** (first import) or **Create and update** (refresh existing SKUs) → **Preview import** → fix errors (CSV report available) → **Confirm import**, or partial import if only some rows are valid.
3. **Step 2 — Opening stock** — same workbook → preview ( heed double-stock warnings) → confirm. Re-confirming with the same confirmation id does not double-apply.

Detailed columns, modes, and limits: `docs/SHOP_ONBOARDING.md`.

### Parser accepts (PRODUCTS sheet headers, case-insensitive)

- **Product name** (required), **Selling price** (required)
- **Product SKU**, **Variant SKU**, **Size**, **Color** / **Colour**, **Variant name**
- **Cost price**, **Category**, **Brand**, **Barcode**, **Min stock**, **Track stock**

Opening stock: **Product SKU** or **Variant SKU** or name + size/color, **Quantity**, optional **Branch**.

### Rules

- Preview shows **row-level errors** before commit; warnings (e.g. empty category, zero price) do not block import.
- **Create only** skips existing SKUs without failing the batch; **Create and update** requires `products.edit` and updates matched lines.
- Partial import commits only rows that passed validation; fix rejected rows in Excel and preview again.
- Use the client’s **real** workbook only; keep `GOROVIAN_POS_Mock_*` files for dev/test tenants only.

---

## Stage 4 — Acceptance checklist

- [ ] Platform: create tenant; owner invitation **SENT** (or documented resend).
- [ ] Owner: accept invite, sign in on **client Windows PC** (hosted URL or approved desktop build).
- [ ] Dashboard/banner: correct **business name**; subscription shows **TRIALING** (not “paid”).
- [ ] Products → Import Excel → preview clean → products + variants visible.
- [ ] Opening stock import → inventory balances match expected.
- [ ] POS: scan/type barcode → correct item.
- [ ] Cash sale with **change** (tendered amount) → receipt/totals correct.
- [ ] Stock decreases **once** per sold line (check Inventory / product qty).
- [ ] M-Pesa: **callback verified** payment succeeds; failed/cancel does **not** mark sale paid.
- [ ] Print receipt (Settings → Receipt configured).
- [ ] Owner: **Employees** → invite manager/supervisor/cashier; invitee sets password; permissions match role.
- [ ] Second tenant login cannot see first tenant products/sales (separate owner account smoke test).
- [ ] Server backup taken and restore **tested on non-production** copy.

---

## Commands (operator)

```powershell
npx prisma db push
npx prisma generate
npm run db:seed
npm run build
# Production host: SERVE_STATIC=true node dist-server or tsx server/index.ts with env file
npm run test
npm run backup:server
```

Vitest onboarding tests disable SMTP to avoid timeouts; your `.env` SMTP is for manual `smtp:verify` only until run on the host.
