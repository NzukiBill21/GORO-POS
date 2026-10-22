# Security — Goro Enterprise POS

This document is the operator-facing security model for the **local-first desktop till** and **dev web** stack. For the detailed audit scorecard, see [SECURITY_REPORT.md](./SECURITY_REPORT.md).

## Threat model (summary)

| Asset | Primary risks | Mitigations |
| --- | --- | --- |
| Shop LAN / Wi‑Fi | Another device calling the till API | Loopback bind (`127.0.0.1`), `desktopLocalOnly`, Host/Origin guard, optional `DESKTOP_API_SECRET` from Electron |
| Stolen laptop | Offline DB + secrets on disk | OS disk encryption, Windows user account, Argon2 passwords, session revocation via `tokenVersion` |
| Cashier fraud | Fake M-Pesa codes, void/refund abuse | Manual M-Pesa always `MANUAL_UNVERIFIED` until manager review; hash-chained audit log; rate limits on pay/refund |
| Supply chain | Vulnerable dependencies | `npm audit` in CI; pin lockfile; review before `electron-builder` releases |

## Authentication

- Passwords: minimum **12** characters, complexity rules, **zxcvbn** score ≥ 3, small blocklist (`server/lib/passwordPolicy.ts`).
- Progressive lockout on failed logins; managers notified on lockout.
- JWT access tokens include **`tokenVersion`**; password reset/change and role changes bump version and terminate sessions.

## Desktop API session secret

When `DESKTOP_MODE=true` and `DESKTOP_API_SECRET` is set (Electron generates and passes it to the API child process), every API call from the shell must send header **`X-Goro-Desktop-Secret`**. Health, setup, and payment webhooks are exempt.

## Payments

- **STK Push:** Daraja callback + optional **STK Query** poll while status is `WAITING`.
- **Manual M-Pesa:** Always creates **`MANUAL_UNVERIFIED`** payment; sale completes only after owner/manager verification workflow.
- **Webhooks:** Set `POS_WEBHOOK_SECRET` in production desktop builds if you use an HMAC-verified callback relay.

## Local backups (desktop)

- Scheduled and manual backups land in `%APPDATA%\<app>\backups` as **`.gbak`** files (AES-256-GCM, magic header `GOROBAK1`).
- Key material comes from the same **`ENCRYPTION_KEY`** in Electron `secrets.bin` (scrypt-derived with backup-specific salt). **Without that key, backups cannot be decrypted.**
- The database stores a **SHA-256 checksum of the plaintext SQLite** (before encryption) for integrity reference.
- Legacy plain `.db` backups still restore normally.
- Support / disaster recovery on another machine:

```bash
npm run backup:decrypt -- path\to\backup.gbak recovered.db
```

Set `ENCRYPTION_KEY` to the till’s key (from a secured export of `secrets.bin` metadata) when running the script off-device.

## Audit integrity

New audit rows store **`prevHash`** and **`entryHash`** (SHA-256 chain). Verify locally:

```bash
npm run audit:verify
```

## Incident response (shop)

1. **Suspected fake payment:** Freeze the sale, check M-Pesa verification queue, review audit log for `POS_MPESA_MANUAL`.
2. **Stolen till / lost laptop:** Revoke sessions (change passwords for all staff), restore from latest backup under `%APPDATA%\<app>\backups`.
3. **Malware on PC:** Reimage, reinstall signed Goro build, restore encrypted backup; rotate JWT secrets by deleting `secrets.bin` (forces new secrets — all users re-login).

## Reporting vulnerabilities

Email your Gorovian support contact (or the address in your license). Do **not** open public issues for exploit details.

## Release hardening (Electron)

- Sign Windows/macOS installers with your code-signing certificate (`electron-builder` config in `package.json`).
- Enable auto-update only from your verified update feed.
- Ship with `DESKTOP_MODE=true`, loopback bind, and no LAN exposure unless explicitly configured for lab use.

## CI expectations

GitHub Actions (`.github/workflows/ci.yml`) runs unit tests and production build on push/PR. Extend with SAST/DAST and SBOM generation as your release process matures.
