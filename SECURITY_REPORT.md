# Security Audit Report — Enterprise POS

**Audit date:** July 28, 2026  
**Scope:** Full codebase (Electron, Express API, React frontend, Prisma/SQLite)  
**Status:** Findings remediated in this pass

---

## Executive Summary

A comprehensive security review identified **28 issues** across authentication, multi-tenant isolation, race conditions, input validation, Electron IPC, and frontend token handling. **All critical and high-severity items were fixed** in code. Medium/low items are documented with residual risk notes.

| Severity | Found | Fixed |
|----------|-------|-------|
| Critical | 8     | 8     |
| High     | 12    | 12    |
| Medium   | 6     | 4     |
| Low      | 2     | 1     |

---

## Critical Findings (Fixed)

### C1 — Multi-tenant IDOR: Audit logs exposed cross-tenant data
- **Location:** `server/services/securityService.ts` → `getAuditLogs()`
- **Issue:** `businessId` parameter was ignored; any authenticated admin could read all tenants' audit logs.
- **Fix:** Filter audit logs to `userId IN (business user IDs)`.

### C2 — Multi-tenant IDOR: Activity logs exposed cross-tenant data
- **Location:** `server/services/employeeService.ts` → `getActivityLogs()`
- **Issue:** No business scoping on activity log queries.
- **Fix:** Require `businessId` and scope to tenant user IDs.

### C3 — Session termination IDOR
- **Location:** `server/services/authService.ts` → `forceLogoutSession()`
- **Issue:** Any admin could terminate sessions from other businesses by UUID.
- **Fix:** Verify `session.businessId === admin.businessId`.

### C4 — Stock race conditions / overselling
- **Location:** `server/services/salesService.ts`, `inventoryService.ts`
- **Issue:** Read-modify-write stock updates outside atomic guards; no insufficient-stock check.
- **Fix:** New `server/lib/stock.ts` with conditional `updateMany` + `decrement`; pre-check available quantity.

### C5 — Idempotency race on sales
- **Location:** `server/services/salesService.ts` → `create()`
- **Issue:** Idempotency check occurred outside the transaction.
- **Fix:** Moved check inside `$transaction`.

### C6 — Approved inventory changes never executed
- **Location:** `server/services/securityService.ts` → `reviewApproval()`
- **Issue:** Approvals marked APPROVED but stock never adjusted.
- **Fix:** Call `inventoryService.executeApproval()` on approval.

### C7 — Void sales did not restore inventory
- **Location:** `server/services/salesService.ts` → `voidSale()`
- **Issue:** Completed sales voided without returning stock.
- **Fix:** Restore stock via `restoreStock()` inside transaction when voiding COMPLETED sales.

### C8 — JWT algorithm confusion
- **Location:** `server/services/authService.ts`
- **Issue:** `jwt.verify()` did not pin algorithm; `jwt.sign()` did not specify HS256.
- **Fix:** Explicit `{ algorithms: ['HS256'] }` on verify; `algorithm: 'HS256'` on sign.

---

## High Findings (Fixed)

### H1 — Auth middleware trusted JWT claims over DB
- **Location:** `server/middleware/auth.ts`
- **Issue:** Role/permissions taken from token payload without DB validation.
- **Fix:** Reload user + role from DB; validate `session.businessId` and `user.businessId` match token.

### H2 — Refresh tokens not rotated
- **Location:** `server/services/authService.ts` → `refreshAccessToken()`
- **Fix:** Issue new refresh token on each refresh; update hash in session.

### H3 — Employee PIN stored in plaintext
- **Location:** `server/services/employeeService.ts`
- **Fix:** Hash PINs with Argon2id on create/update.

### H4 — Mass assignment on employee update
- **Location:** `server/services/employeeService.ts` → `update()`
- **Fix:** Whitelist allowed fields; Zod schema on route.

### H5 — Mass assignment on categories
- **Location:** `server/routes/categories.ts`
- **Fix:** Zod `categoryCreateSchema`; no raw `req.body` spread of unknown fields.

### H6 — Mass assignment on business settings
- **Location:** `server/services/systemService.ts` → `updateBusiness()`
- **Fix:** Field whitelist for business updates.

### H7 — Notification mark-read IDOR
- **Location:** `server/services/systemService.ts` → `markRead()`
- **Fix:** Verify notification belongs to requesting user (or is broadcast).

### H8 — Inventory movements IDOR
- **Location:** `server/services/inventoryService.ts` → `getMovements()`
- **Fix:** `assertProductInBusiness()` before returning movements.

### H9 — Report branch IDOR
- **Location:** `server/services/systemService.ts` → `salesReport()`, `profitReport()`
- **Fix:** `assertBranchInBusiness()` when `branchId` query param provided.

### H10 — Purchase receive double-submit race
- **Location:** `server/services/purchaseService.ts` → `receive()`
- **Fix:** Entire receive flow in transaction with conditional status update.

### H11 — `changePassword()` skipped complexity rules
- **Location:** `server/services/authService.ts`
- **Fix:** Call `validatePasswordComplexity()` before update.

### H12 — Protected route checked wrong token field
- **Location:** `src/App.tsx` → `ProtectedRoute`
- **Issue:** Checked undefined `token` instead of `accessToken`.
- **Fix:** Guard on `isAuthenticated && accessToken`.

---

## Medium Findings

### M1 — Tokens in localStorage (XSS exfiltration risk)
- **Location:** `src/stores/authStore.ts`
- **Fix:** Moved token persistence to `sessionStorage` (reduced persistence window).
- **Residual risk:** XSS can still steal session tokens during active session. Mitigate with strict CSP (Helmet + Electron CSP), input sanitization, and future httpOnly cookie strategy.

### M2 — Print IPC loaded unsanitized HTML
- **Location:** `electron/main.js` → `print:receipt`
- **Fix:** Strip scripts, event handlers, iframes, dangerous `data:` URIs before loading in hidden BrowserWindow.

### M3 — Electron navigation not restricted
- **Location:** `electron/main.js`
- **Fix:** `will-navigate` handler blocks unexpected URLs; `setWindowOpenHandler` denies popups.

### M4 — Dynamic ORDER BY injection
- **Location:** Multiple list services
- **Fix:** `safeOrderBy()` whitelist in `server/lib/tenant.ts` applied to sales, inventory, employees.

### M5 — Incomplete Zod validation on all routes
- **Status:** Partially addressed (auth, sales, inventory, employees, categories). Remaining mutating routes (customers, purchases, financials) should adopt schemas incrementally.
- **Risk:** Medium — routes still require authentication + RBAC.

### M6 — Account lockout timing disclosure
- **Location:** `server/services/authService.ts`
- **Fix:** Generic lockout message (no exact unlock time leaked).

---

## Low Findings

### L1 — Dev JWT fallback when secrets unset
- **Location:** `server/services/authService.ts`
- **Fix:** Warning logged when `JWT_SECRET` missing and `NODE_ENV` is not `development`; production throws on startup path.

### L2 — Prisma/SQLite parameterized queries
- **Status:** No raw SQL injection vectors found. Prisma ORM used throughout.

---

## Electron Security Posture

| Control | Status |
|---------|--------|
| `contextIsolation: true` | ✅ |
| `nodeIntegration: false` | ✅ |
| `sandbox: true` | ✅ |
| IPC channel allowlist (preload + main) | ✅ |
| External URL prefix validation | ✅ |
| CSP headers | ✅ |
| Print HTML sanitization | ✅ (fixed) |
| Navigation hardening | ✅ (fixed) |

---

## Authentication & Session Security

| Control | Status |
|---------|--------|
| Argon2id password hashing | ✅ |
| Account lockout (5 attempts / 15 min) | ✅ |
| Refresh token rotation | ✅ (fixed) |
| Session invalidation on password change | ✅ |
| JWT algorithm pinning (HS256) | ✅ (fixed) |
| DB-backed permission reload per request | ✅ (fixed) |
| Rate limiting on auth endpoints | ✅ |
| Helmet security headers | ✅ |

---

## RBAC & Permissions

Four roles: **Cashier**, **Supervisor**, **Manager**, **Administrator**.  
Permission checks via `requirePermission()` on all API routes.  
Session terminate requires `security.manage` (elevated from `security.view`).

---

## Files Changed in Remediation

```
server/lib/stock.ts                    (new — atomic stock ops)
server/lib/tenant.ts                   (tenant helpers, sort whitelist)
server/lib/sanitize.ts                 (HTML sanitization utilities)
server/lib/schemas.ts                  (+ category, employee update schemas)
server/middleware/auth.ts              (DB session/user validation)
server/services/authService.ts         (JWT, refresh rotation, imports)
server/services/salesService.ts        (atomic stock, void restore, idempotency)
server/services/inventoryService.ts    (atomic ops, tenant checks, approvals)
server/services/securityService.ts     (tenant audit logs, execute approvals)
server/services/employeeService.ts     (PIN hash, mass-assignment fix, logs)
server/services/systemService.ts       (notification IDOR, reports, settings)
server/services/purchaseService.ts     (receive race fix)
server/routes/categories.ts            (Zod validation)
server/routes/employees.ts             (Zod validation)
server/routes/auth.ts                  (session terminate permission)
electron/main.js                       (print sanitize, navigation)
src/App.tsx                            (ProtectedRoute fix)
src/stores/authStore.ts                (sessionStorage, refresh sync)
src/lib/api.ts                         (refresh token rotation sync)
```

---

## Residual Recommendations

1. **httpOnly cookies** for refresh tokens in browser deployments (eliminates JS token access).
2. **Complete Zod coverage** on customers, purchases, financials, and settings routes.
3. **CSRF tokens** if moving to cookie-based auth.
4. **Automated security tests** for IDOR and race-condition scenarios.
5. **Dependency audit:** run `npm audit` regularly; pin Electron and Express versions.
6. **Production secrets:** enforce `JWT_SECRET`, `ENCRYPTION_KEY` via env validation at startup.
7. **SQLite → PostgreSQL** for production multi-tenant concurrency.
8. **WAF / reverse proxy** rate limiting in production deployments.

---

## Shop Wi‑Fi / desktop till (post-audit)

For **Iman-style local installs** on shop Wi‑Fi (not cloud hosting):

- API **binds loopback only** in desktop mode (`server/lib/listenHost.ts`; Electron sets `HOST=127.0.0.1`).
- **Local-only middleware** rejects non-loopback clients when `DESKTOP_MODE=true` (unless `ALLOW_LAN_BIND=true` for lab use).
- **Trust proxy disabled** on desktop so rate limits cannot be bypassed via forged `X-Forwarded-For`.
- Optional Windows firewall: `scripts/windows/Secure-PosDesktop.ps1`.
- Pilot runbook: `docs/WIFI_SECURE_HOSTING.md`.

---

## Verification

After applying fixes:

```bash
npm run db:push
npm run db:seed
npm run build
npm run dev:server   # API on :3001
npm run dev          # Vite on :5173
```

**Demo credentials:** `admin@demostore.com` / `Admin123!`

---

*Report generated as part of automated security remediation. Re-audit recommended after major feature changes.*
