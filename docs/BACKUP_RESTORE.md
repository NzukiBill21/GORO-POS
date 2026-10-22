# Backup & restore (local / pilot)

## Automatic backups (desktop)

When `DESKTOP_MODE=true`, the API runs **daily backups** per active business into `BACKUP_DIR` (Electron: `%APPDATA%/<app>/backups`).

Disable with `DESKTOP_BACKUP_ENABLED=false`.

Backups use SQLite **`VACUUM INTO`** (consistent with WAL).

## Manual backup (tenant)

1. Sign in as manager → **Settings → Security → Backups**
2. **Create backup** — file stored under `BACKUP_DIR`, metadata in `Backup` table.

## Restore drill (staging)

1. Note current sale count / a known product stock level.
2. Create a **manual backup**.
3. Make a test change (e.g. adjust stock).
4. **Restore** the backup from Security → Backups.
5. **Restart the API** (required — SQLite file is replaced on disk).
6. Confirm stock/sales match pre-test state.

## Paths

| Mode | Database | Backups |
|------|----------|---------|
| Dev | `prisma/dev.db` (from `.env`) | `./backups` |
| Desktop | `%APPDATA%/…/data/pos.db` via `GOROVIAN_DATA_DIR` | `%APPDATA%/…/backups` |

Encrypted desktop backups use `.gbak` files. Decrypt locally with:

```bash
npm run backup:decrypt -- path\to\file.gbak path\to\output.db
```

Do not restore over a live till without closing the app and taking a fresh backup first.

Never ship `dev.db` or demo seed as the production shop database.
