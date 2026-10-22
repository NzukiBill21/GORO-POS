# GOROVIAN POS — Project Handoff & Development Status

**Last updated:** October 2026  
**Workspace:** `c:\Users\billn\OneDrive\Desktop\DEV\POS`  
**Product name in UI:** Enterprise POS (GOROVIAN platform billing layer)

---

## 1. What this system is

Multi-tenant **Point of Sale + inventory + financials** for retail businesses, with a separate **SaaS subscription/billing layer** (GOROVIAN). Tenant users run the store; platform admins manage organizations and billing.

**Not the same thing:**
- **POS `Payment`** — customer pays for goods at checkout
- **`BillingPayment`** — organization pays GOROVIAN for subscription (M-Pesa STK, webhooks)

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Language | **TypeScript** (ES modules) |
| Frontend | React 18, Vite, React Router, TanStack Query, Zustand, Tailwind, Radix/shadcn-style UI |
| Backend | Node.js, **Express** on `127.0.0.1:3001` (shop: same port serves UI; dev: use **5173** in browser only) |
| ORM | **Prisma** — schema in `prisma/schema.prisma`, client `@prisma/client` |
| Database | **SQLite** (`prisma/dev.db`) — production can target Postgres with same schema |
| Desktop | Electron (optional); primary dev path is **web** |
| Tests | Vitest (`tests/*.test.ts`) — 27+ tests including RBAC/billing |

**Run locally (Windows):**
```bash
npm install
npm run db:push
npm run db:seed
npm run dev:web   # API + Vite at http://127.0.0.1:5173
```
Use **127.0.0.1**, not `localhost`, on Windows to avoid stale IPv6 listeners on port 3001.

---

## 3. Architecture (authorization)

```
USER → ORG MEMBERSHIP (businessId) → ROLE → PERMISSIONS (+ UserPermission grants)
     → PLAN ENTITLEMENTS (PlanFeature) → API access
```

- **Platform ADMIN:** `PlatformUser` table — `admin@gorovian.com` — NOT a tenant employee
- **Tenant roles:** `manager`, `supervisor`, `cashier` (legacy `administrator` → manager)
- **Never trust client `organization_id`** — use `req.user.businessId` from JWT/session
- **Subscription gate:** After login, most `/api/*` routes require subscription status in `TRIALING | ACTIVE | GRACE_PERIOD` or return **402** `SUBSCRIPTION_INACTIVE`

Exempt from subscription gate: `/api/auth`, `/api/billing`, `/api/platform`, `/api/health`, `/api/settings`, `/api/notifications`

---

## 4. Demo accounts (seed)

| Email | Password | Role |
|-------|----------|------|
| admin@demostore.com | Admin123! | Manager (billing owner) |
| manager@demostore.com | Admin123! | Manager |
| supervisor@demostore.com | Admin123! | Supervisor |
| cashier@demostore.com | Admin123! | Cashier |
| admin@gorovian.com | GorovianAdmin123! | Platform admin |

Platform UI: `/platform/login` → `/platform/billing`

---

## 5. RBAC & permissions (backend source of truth)

- Registry: `server/lib/permissionRegistry.ts` — `ROLE_PERMISSION_MAP`, `PERMISSION_ALIASES`
- Resolution: `server/lib/permissions.ts` — `getPermissionsForUser()`, merged with `UserPermission` grants
- Middleware: `server/middleware/permissions.ts` — `requirePermission(...)`
- Examples: `billing.view`, `staff.create`, `pos.access` (alias `pos.view`)

Manager: full org + billing. Supervisor: operational, no billing by default (can grant `billing.view`). Cashier: POS minimal, no billing.

---

## 6. Subscription & billing (implemented)

**Plans (KES, seeded):** REGULAR, BUSINESS, PRO, ENTERPRISE — prices in `Plan` / `PlanPrice`, not hard-coded in UI.

**Models:** `Plan`, `PlanPrice`, `PlanFeature`, `OrganizationSubscription`, `SubscriptionEvent`, `BillingInvoice`, `BillingInvoiceItem`, `BillingPayment`, `BillingPaymentAttempt`, `PaymentProviderTransaction`, `BillingContact`, `UsageCounter`, `Notification`, `NotificationPreference`

**Services:**
- `server/services/billingService.ts` — overview, pay, webhooks, plan change, contacts
- `server/services/payment/mpesaProvider.ts` — M-Pesa STK (Daraja); **MPESA_MOCK=true** in dev auto-confirms ~4s
- `server/services/subscriptionLifecycleService.ts` — reminders, auto-renew STK, PAST_DUE → grace → suspend
- `server/jobs/billingScheduler.ts` — hourly cron on server start (`BILLING_CRON_ENABLED`)

**Routes:** `server/routes/billing.ts`, `server/routes/platform.ts`

**Frontend:** `src/pages/BillingPage.tsx`, platform billing page, sidebar gated by permissions

---

## 7. Core POS modules (operational)

Routes under `server/routes/`: auth, dashboard, products, categories, customers, sales, inventory, purchases, financials, employees, notifications, settings, reports, security.

Services in `server/services/`: sales, inventory, products, customers, purchases, financials, employees, system, security, auth.

Multi-tenant: queries scoped by `businessId` from authenticated user (`server/lib/tenant.ts`).

---

## 8. Security posture

See `SECURITY_REPORT.md` — IDOR fixes, stock atomicity, JWT HS256, session rotation, PIN hashing, audit logs, rate limits, Helmet, webhook idempotency for billing.

Residual: full MFA for tenant users not complete; production M-Pesa credentials required for real STK.

---

## 9. Known dev issues & fixes

### 402 Payment Required on dashboard / stats
**Cause:** Demo subscription moved to `PAST_DUE` or `SUSPENDED` after period end (lifecycle scheduler or unpaid period).

**Fix:**
```bash
npx tsx scripts/reactivate-demo-sub.ts
```
Or log in as Manager → **Billing** → **Pay with M-Pesa** (mock completes in ~4s).

Check status: `npx tsx scripts/check-sub.ts`

### API 500 / proxy errors
Server crash (e.g. wrong `asyncHandler` import) or port 3001 not running. Restart `npm run dev:web`.

### BillingPage Skeleton error
Ensure `Skeleton` is imported from `@/components/ui/skeleton`.

---

## 10. Development status (~summary)

| Area | Status |
|------|--------|
| POS core (sales, inventory, products, customers, purchases, financials) | **Working** — dev fixes for 500s, stock, tenant isolation |
| Auth, sessions, RBAC permissions | **Working** — registry + middleware + frontend `user.permissions` |
| Multi-tenancy | **Enforced** on backend |
| Subscription schema + seed plans | **Done** |
| Billing UI (manager) + platform billing UI | **Basic / usable** |
| M-Pesa STK + mock webhook | **Done** for dev |
| Lifecycle scheduler (reminders, auto-renew, suspend) | **Done** — can flip demo to PAST_DUE over time |
| Entitlements (`hasFeature`, `withinLimit`) | **Done** — used on e.g. staff create |
| Billing contacts CRUD API | **Done** — limited UI |
| Supervisor permission grants API | **Done** — `POST /api/employees/:id/permissions` |
| Graceful downgrade UX (over-limit branches) | **Partial** — policy described, not full UI |
| Automated tests | **27 tests** — RBAC, webhook idempotency, tenancy sample |
| README | **Outdated** (wrong demo password) |
| Production deployment (Postgres, HTTPS, real M-Pesa callback URL) | **Not done** |

---

## 11. Key files index

```
prisma/schema.prisma          — all models
prisma/seed.ts, seedBilling.ts
server/index.ts               — mounts routes, subscriptionGate, billingScheduler
server/lib/permissionRegistry.ts, permissions.ts, entitlements.ts
server/services/billingService.ts, subscriptionLifecycleService.ts
server/services/payment/*
server/middleware/auth.ts, subscriptionGate.ts, platformAuth.ts
server/routes/billing.ts, platform.ts, employees.ts
src/App.tsx, Sidebar.tsx, pages/BillingPage.tsx
src/lib/permissions.ts        — client checks API permission list only
tests/rbac-billing.test.ts, security.test.ts, billing-automation.test.ts
```

---

## 12. Environment (.env.example)

Important vars: `DATABASE_URL`, `JWT_SECRET`, `BILLING_CRON_ENABLED`, `MPESA_MOCK`, `MPESA_*` for production, `PAYMENT_WEBHOOK_SECRET`.

**In-store POS M-Pesa (separate from SaaS billing):** STK callback URL is `/api/pos/webhooks/mpesa/stk` (public; authenticated POS routes are behind subscription gate). Set tenant Daraja keys under **Settings → Payments**. `MPESA_MOCK=true` only works when `NODE_ENV` is not `production` (server refuses to start otherwise).

---

## 13. Shop Wi‑Fi / desktop hosting (Iman pilot)

- **Production till:** Electron installer only — not `npm run dev:web` on the shop PC.
- **Network:** API binds **`127.0.0.1`** (`server/lib/listenHost.ts`); desktop mode adds **local-only middleware** so the till is not reachable from other devices on the same Wi‑Fi.
- **M‑Pesa:** STK uses outbound API + polling — no router port-forward required for basic use.
- **Runbook:** `docs/WIFI_SECURE_HOSTING.md` + optional `scripts/windows/Secure-PosDesktop.ps1` (Admin).

---

## 14. For the next developer / Claude session

1. Read this file + `SECURITY_REPORT.md` + `docs/WIFI_SECURE_HOSTING.md`
2. Run `npm run dev:web`, verify `/api/health`
3. If 402 everywhere, run `scripts/reactivate-demo-sub.ts`
4. Do not conflate POS payments with billing payments
5. Do not add tenant `ADMIN` role — use platform `PlatformUser` for GOROVIAN staff
6. Permission changes: update `permissionRegistry.ts`, seed, and rely on API permissions in frontend (not hardcoded role maps in `src/lib/permissions.ts`)

---

*End of handoff.*
