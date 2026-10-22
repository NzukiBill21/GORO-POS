# Production readiness stages

| Stage | Focus | Status |
|-------|--------|--------|
| 1 | Baseline tests, build, smoke | Run each session |
| 2 | Iman pilot | Done |
| 3 | POS checkout | Done |
| 4 | Inventory & shop ops | **Done (core)** — import, variants editor, partial PO receive, stock/branch fixes |
| 5 | Cash & reports | **Done (core)** — shift UI, Z-report print, COGS profit, payment labels |
| 6 | Security prod | **Done (core)** — WAL backups, restore doc, safe error logs, optional POS webhook HMAC, desktop backup cron |
| 7 | Local Electron | **Done (core)** — API spawn, static serve, userData DB, `build:electron` packaging |
| 8 | UX / performance | **Done (POS + checkout slice)** — manual smoke: [PILOT_SMOKE.md](./PILOT_SMOKE.md); rest of app UX later |
| 9 | Postgres runbook | Not started |

See also: [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md), [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).
